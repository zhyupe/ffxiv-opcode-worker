import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { mergeOpcodes } from '../../lib/ffxiv-opcodes.mjs'
import { loadPackets, parsePackets } from '../../lib/packets.mjs'
import { generateJson } from './index.mjs'
import { mergeHistory } from './merge-history.mjs'

const upstream = (entries, region = 'Global') => [
  {
    region,
    version: '7.56h',
    lists: { ServerZoneIpcType: entries },
  },
]
const matching = upstream([
  { name: 'ActorCast', opcode: 10 },
  { name: 'Extra', opcode: 255 },
])
const conflicting = upstream([
  { name: 'Extra', opcode: 255 },
  { name: 'ActorCast', opcode: 11 },
])
const logger = { log() {}, warn() {} }

function serverPackets(source) {
  return 'ServerZoneIpc:\n  direction: server-to-client\n  packets:\n' + source.replace(/^/gm, '    ')
}


function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ffxiv-opcodes-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const inputFile = join(dir, 'input.csv')
  writeFileSync(inputFile, 'Name,7.55,7.56a\nActorCast,0x0001,0x000a\n')
  const write = (name, value) =>
    writeFileSync(join(dir, name), JSON.stringify(value))
  const read = (name) => JSON.parse(readFileSync(join(dir, name), 'utf-8'))
  write('version.json', ['7.55', '7.56a'])
  write('7.55.json', { ActorCast: '0x0001', HistoricalExtra: '0x0010' })
  write('7.56a.json', { ActorCast: '0x000a', PreviousExtra: '0x0020' })
  write('current.json', read('7.56a.json'))
  return { dir, inputFile, write, read }
}

test('merges Global numerically, keeps original formatting, ignores other regions', () => {
  const base = { ActorCast: '0x000a' }
  const result = mergeOpcodes(base, [
    ...matching,
    ...conflicting.map((e) => ({ ...e, region: 'CN' })),
  ])
  assert.deepEqual(result.opcodes, { ActorCast: '0x000a', Extra: '0x00FF' })
  assert.equal(result.added, 1)
  assert.deepEqual(base, { ActorCast: '0x000a' })
  assert.throws(() => mergeOpcodes(base, conflicting), /conflict/)
  assert.deepEqual(base, { ActorCast: '0x000a' })
  assert.equal(
    mergeOpcodes(
      base,
      upstream([{ name: 'ActorCast', opcode: '0xA' }], 'CN'),
      'CN',
    ).added,
    0,
  )
})

test('rejects incompatible or malformed sources, including conflicts between scopes', () => {
  const base = { ActorCast: '0x000a' }
  for (const source of [
    {},
    [],
    matching.concat(matching),
    upstream([{ name: 'Unrelated', opcode: 1 }]),
    upstream([{ name: 'ActorCast', opcode: null }]),
    upstream([
      { name: 'ActorCast', opcode: 10 },
      { name: 'Invalid', opcode: 65536 },
    ]),
    [{ region: 'Global', lists: { ServerZoneIpcType: null } }],
  ])
    assert.throws(() => mergeOpcodes(base, source))
  const source = structuredClone(matching)
  source[0].lists.ClientZoneIpcType = [{ name: 'Extra', opcode: 1 }]
  assert.throws(() => mergeOpcodes(base, source), /conflict for Extra/)
})

test('below 50% conflicts, additions merge and local values win', () => {
  const base = {
    ActorCast: '0x000a',
    ActorControl: '0x000b',
    ActorMove: '0x000c',
  }
  const result = mergeOpcodes(
    base,
    upstream([
      { name: 'ActorCast', opcode: 999 },
      { name: 'ActorControl', opcode: 11 },
      { name: 'ActorMove', opcode: 12 },
      { name: 'Extra', opcode: 255 },
    ]),
  )
  assert.deepEqual(result.opcodes, { ...base, Extra: '0x00FF' })
  assert.equal(result.conflicts, 1)
  assert.equal(result.overlap, 3)
  assert.equal(result.added, 1)
  assert.equal(base.ActorCast, '0x000a')
  assert.equal(Object.hasOwn(base, 'Extra'), false)
})

test('50% and higher conflicts reject all additions; new names and duplicates do not dilute the rate', () => {
  const base = { ActorCast: '0x000a', ActorControl: '0x000b' }
  const source = upstream([
    { name: 'Extra', opcode: 255 },
    { name: 'Extra2', opcode: 256 },
    { name: 'ActorCast', opcode: 999 },
    { name: 'ActorControl', opcode: 11 },
    { name: 'ActorControl', opcode: 11 },
  ])
  assert.throws(() => mergeOpcodes(base, source), /1\/2.*50% or more/)
  const higher = structuredClone(source)
  higher[0].lists.ServerZoneIpcType.push({ name: 'ActorMove', opcode: 999 })
  assert.throws(
    () => mergeOpcodes({ ...base, ActorMove: '0x000c' }, higher),
    /2\/3.*50% or more/,
  )
  assert.deepEqual(base, { ActorCast: '0x000a', ActorControl: '0x000b' })
})

test('generation uses CSV values on accepted conflicts and preserves historical entries', async (t) => {
  const f = fixture(t)
  writeFileSync(
    f.inputFile,
    'Name,7.55,7.56a\nActorCast,0x0001,0x000a\nActorControl,,0x000b\nActorMove,,0x000c\n',
  )
  f.write('7.56a.json', { ActorCast: '0xFFFF', PreviousExtra: '0x0020' })
  const warnings = []
  await generateJson({
    inputFile: f.inputFile,
    outputDir: f.dir,
    logger: {
      log() {},
      warn(message) {
        warnings.push(message)
      },
    },
    loadUpstream: async () =>
      upstream([
        { name: 'ActorCast', opcode: 999 },
        { name: 'ActorControl', opcode: 11 },
        { name: 'ActorMove', opcode: 12 },
        { name: 'Extra', opcode: 255 },
      ]),
  })
  assert.deepEqual(warnings, [])
  assert.deepEqual(f.read('current.json'), {
    ActorCast: '0x000a',
    ActorControl: '0x000b',
    ActorMove: '0x000c',
    Extra: '0x00FF',
    PreviousExtra: '0x0020',
  })
  assert.deepEqual(f.read('current.json'), f.read('7.56a.json'))
  assert.equal(f.read('7.55.json').HistoricalExtra, '0x0010')
})

test('historical backfill accepts minority conflicts and keeps existing target values', async (t) => {
  const f = fixture(t)
  const base = {
    ActorCast: '0x0001',
    ActorControl: '0x0002',
    ActorMove: '0x0003',
  }
  f.write('7.55.json', base)
  const current = f.read('current.json')
  const result = await mergeHistory({
    version: '7.55',
    ref: 'commit-sha',
    outputDir: f.dir,
    loadUpstream: async () =>
      upstream([
        { name: 'ActorCast', opcode: 999 },
        { name: 'ActorControl', opcode: 2 },
        { name: 'ActorMove', opcode: 3 },
        { name: 'Backfilled', opcode: 42 },
      ]),
  })
  assert.equal(result.conflicts, 1)
  assert.equal(result.overlap, 3)
  assert.deepEqual(f.read('7.55.json'), { ...base, Backfilled: '0x002A' })
  assert.deepEqual(f.read('current.json'), current)
})

test('generation preserves historical additions and merges only the latest version', async (t) => {
  const f = fixture(t)
  let calls = 0
  await generateJson({
    inputFile: f.inputFile,
    outputDir: f.dir,
    logger,
    loadUpstream: async () => {
      calls++
      return matching
    },
  })
  assert.equal(calls, 1)
  assert.deepEqual(f.read('7.55.json'), {
    ActorCast: '0x0001',
    HistoricalExtra: '0x0010',
  })
  assert.deepEqual(f.read('7.56a.json'), {
    ActorCast: '0x000a',
    Extra: '0x00FF',
    PreviousExtra: '0x0020',
  })
  assert.deepEqual(f.read('current.json'), f.read('7.56a.json'))
  // Moving the latest version into history must not remove its merged entries.
  writeFileSync(
    f.inputFile,
    'Name,7.55,7.56a,7.57\nActorCast,0x0001,0x000a,0x000b\n',
  )
  await generateJson({
    inputFile: f.inputFile,
    outputDir: f.dir,
    logger,
    loadUpstream: async () => conflicting,
  })
  assert.equal(f.read('7.56a.json').Extra, '0x00FF')
  assert.equal(f.read('7.57.json').ActorCast, '0x000b')
  assert.deepEqual(f.read('current.json'), f.read('7.57.json'))
})

test('excessive conflicts or network failure skip the entire merge and still generate CSV output', async (t) => {
  const f = fixture(t)
  for (const loadUpstream of [
    async () => conflicting,
    async () => {
      throw new Error('offline')
    },
  ]) {
    const warnings = []
    await generateJson({
      inputFile: f.inputFile,
      outputDir: f.dir,
      loadUpstream,
      logger: {
        log() {},
        warn(message) {
          warnings.push(message)
        },
      },
    })
    assert.equal(warnings.length, 1)
    assert.deepEqual(f.read('current.json'), {
      ActorCast: '0x000a',
      PreviousExtra: '0x0020',
    })
    assert.equal(f.read('7.55.json').HistoricalExtra, '0x0010')
  }
})

test('CSV corrections win while existing additions survive; invalid input does not erase files', async (t) => {
  const f = fixture(t)
  f.write('7.55.json', { ActorCast: '0xFFFF', HistoricalExtra: '0x0010' })
  await generateJson({
    inputFile: f.inputFile,
    outputDir: f.dir,
    logger,
    loadUpstream: async () => matching,
  })
  assert.equal(f.read('7.55.json').ActorCast, '0x0001')
  writeFileSync(f.inputFile, '')
  await assert.rejects(
    generateJson({ inputFile: f.inputFile, outputDir: f.dir }),
    /No opcode versions/,
  )
  assert.equal(f.read('7.55.json').HistoricalExtra, '0x0010')
})

test('historical backfill uses the requested ref and survives regeneration', async (t) => {
  const f = fixture(t)
  const beforeCurrent = f.read('current.json')
  await mergeHistory({
    version: '7.55',
    ref: 'commit-sha',
    outputDir: f.dir,
    loadUpstream: async (ref) => {
      assert.equal(ref, 'commit-sha')
      return upstream([
        { name: 'ActorCast', opcode: 1 },
        { name: 'Backfilled', opcode: 42 },
      ])
    },
  })
  assert.equal(f.read('7.55.json').Backfilled, '0x002A')
  assert.deepEqual(f.read('current.json'), beforeCurrent)
  await generateJson({
    inputFile: f.inputFile,
    outputDir: f.dir,
    logger,
    loadUpstream: async () => matching,
  })
  assert.equal(f.read('7.55.json').Backfilled, '0x002A')
})

test('backfill updates current only for the latest version and supports dry-run', async (t) => {
  const f = fixture(t)
  const options = {
    version: '7.56a',
    ref: 'tag',
    outputDir: f.dir,
    loadUpstream: async () => matching,
  }
  const before = readFileSync(join(f.dir, '7.56a.json'), 'utf-8')
  const result = await mergeHistory({ ...options, dryRun: true })
  assert.equal(result.added, 1)
  assert.equal(readFileSync(join(f.dir, '7.56a.json'), 'utf-8'), before)
  await mergeHistory(options)
  assert.equal(f.read('current.json').Extra, '0x00FF')
  assert.deepEqual(f.read('current.json'), f.read('7.56a.json'))
})

test('failed backfill leaves every output untouched', async (t) => {
  const f = fixture(t)
  const files = ['version.json', '7.55.json', '7.56a.json', 'current.json']
  const before = files.map((file) => readFileSync(join(f.dir, file), 'utf-8'))
  for (const loadUpstream of [
    async () => conflicting,
    async () => {
      throw new Error('HTTP 404')
    },
  ]) {
    await assert.rejects(
      mergeHistory({
        version: '7.56a',
        ref: 'tag',
        outputDir: f.dir,
        loadUpstream,
      }),
    )
    assert.deepEqual(
      files.map((file) => readFileSync(join(f.dir, file), 'utf-8')),
      before,
    )
  }
  await assert.rejects(
    mergeHistory({ version: '../invalid', ref: 'tag', outputDir: f.dir }),
  )
  await assert.rejects(
    mergeHistory({ version: '0.0', ref: 'tag', outputDir: f.dir }),
    /Unknown target/,
  )
})

test('upstream aliases count as project-name overlaps and never survive output', () => {
  const result = mergeOpcodes(
    { CompanyAirshipStatus: '0x000A' },
    upstream([
      { name: 'AirshipTimers', opcode: 10 },
      { name: 'SubmarineTimers', opcode: 11 },
      { name: 'UnmappedPacket', opcode: 12 },
    ]),
  )
  assert.deepEqual(result.opcodes, {
    CompanyAirshipStatus: '0x000A',
    CompanySubmersibleStatus: '0x000B',
    UnmappedPacket: '0x000C',
  })
  assert.equal(result.overlap, 1)
  assert.equal(result.added, 2)
  assert.throws(
    () =>
      mergeOpcodes(
        { CompanyAirshipStatus: 10, ActorCast: 20 },
        upstream([
          { name: 'AirshipTimers', opcode: 99 },
          { name: 'ActorCast', opcode: 20 },
        ]),
      ),
    /1\/2.*50% or more/,
  )
})

test('event parameter variants retain their distinct names and opcodes', () => {
  const entries = [
    { name: 'EventPlay32', opcode: 413 },
    { name: 'EventPlay64', opcode: 849 },
    { name: 'ActorCast', opcode: 10 },
  ]
  for (const packets of [entries, entries.toReversed()]) {
    const result = mergeOpcodes({ ActorCast: 10 }, upstream(packets))
    assert.deepEqual(result.opcodes, {
      ActorCast: 10,
      EventPlay32: '0x019D',
      EventPlay64: '0x0351',
    })
    assert.equal(result.added, 2)
  }
  const result = mergeOpcodes(
    { ActorCast: 10 },
    upstream(entries.filter((entry) => entry.name !== 'EventPlay64')),
  )
  assert.deepEqual(result.opcodes, { ActorCast: 10, EventPlay32: '0x019D' })
})

test('aliases and project-spelled upstream entries are deduplicated or rejected on conflict', () => {
  const entries = [
    { name: 'ActorCast', opcode: 10 },
    { name: 'AirshipTimers', opcode: 11 },
    { name: 'CompanyAirshipStatus', opcode: 11 },
  ]
  const result = mergeOpcodes({ ActorCast: 10 }, upstream(entries))
  assert.deepEqual(result.opcodes, {
    ActorCast: 10,
    CompanyAirshipStatus: '0x000B',
  })
  assert.equal(result.added, 1)
  entries[2].opcode = 12
  assert.throws(
    () => mergeOpcodes({ ActorCast: 10 }, upstream(entries)),
    /conflict for CompanyAirshipStatus/,
  )
})

test('retained local aliases collapse to project names with canonical values taking precedence', () => {
  for (const base of [
    { ActorCast: 10, AirshipTimers: 99, CompanyAirshipStatus: 11 },
    { CompanyAirshipStatus: 11, AirshipTimers: 99, ActorCast: 10 },
  ]) {
    const result = mergeOpcodes(
      base,
      upstream([{ name: 'ActorCast', opcode: 10 }]),
    )
    assert.deepEqual(result.opcodes, {
      ActorCast: 10,
      CompanyAirshipStatus: 11,
    })
    assert.equal(result.added, 0)
    assert.equal(base.AirshipTimers, 99)
  }
  const result = mergeOpcodes(
    { AirshipTimers: 11 },
    upstream([{ name: 'AirshipTimers', opcode: 11 }]),
  )
  assert.deepEqual(result.opcodes, { CompanyAirshipStatus: 11 })
  assert.equal(result.overlap, 1)
})

test('generation normalizes all retained versions even offline, with CSV values winning', async (t) => {
  const f = fixture(t)
  writeFileSync(
    f.inputFile,
    'Name,7.55,7.56a\nCompanyAirshipStatus,0x0001,0x0002\n',
  )
  f.write('7.55.json', { AirshipTimers: 99, SubmarineTimers: 30 })
  f.write('7.56a.json', {
    AirshipTimers: 98,
    CompanyAirshipStatus: 97,
    SubmarineTimers: 31,
  })
  await generateJson({
    inputFile: f.inputFile,
    outputDir: f.dir,
    logger,
    loadUpstream: async () => {
      throw new Error('offline')
    },
  })
  assert.deepEqual(f.read('7.55.json'), {
    CompanyAirshipStatus: '0x0001',
    CompanySubmersibleStatus: 30,
  })
  assert.deepEqual(f.read('7.56a.json'), {
    CompanyAirshipStatus: '0x0002',
    CompanySubmersibleStatus: 31,
  })
  assert.deepEqual(f.read('current.json'), f.read('7.56a.json'))
})

test('generation reloads YAML on every invocation and only applies FFXIVOpcodes mappings', async (t) => {
  const f = fixture(t)
  const packetsFile = join(f.dir, 'packets.yaml')
  for (const alias of ['FirstSource', 'SecondSource']) {
    writeFileSync(
      packetsFile,
      serverPackets(`ProjectPacket:\n  FFXIVOpcodes: ${alias}\n  ACT: ActorCast\n  OverlayPlugin: DifferentName\n`),
    )
    await generateJson({
      packetsFile,
      inputFile: f.inputFile,
      outputDir: f.dir,
      logger,
      loadUpstream: async () =>
        upstream([
          { name: 'ActorCast', opcode: 10 },
          { name: alias, opcode: 42 },
        ]),
    })
    const current = f.read('current.json')
    assert.equal(current.ProjectPacket, '0x002A')
    assert.equal(current.ActorCast, '0x000a')
    assert.equal(Object.hasOwn(current, alias), false)
    assert.equal(Object.hasOwn(current, 'DifferentName'), false)
  }
})

test('historical backfill applies runtime mappings to both retained and incoming names', async (t) => {
  const f = fixture(t)
  const packetsFile = join(f.dir, 'packets.yaml')
  writeFileSync(packetsFile, serverPackets('ProjectPacket:\n  FFXIVOpcodes: SourcePacket\n'))
  f.write('7.56a.json', { SourcePacket: 10 })
  const options = {
    version: '7.56a',
    ref: 'tag',
    packetsFile,
    outputDir: f.dir,
    loadUpstream: async () => upstream([{ name: 'SourcePacket', opcode: 10 }]),
  }
  const result = await mergeHistory({ ...options, dryRun: true })
  assert.deepEqual(result.opcodes, { ProjectPacket: 10 })
  assert.deepEqual(f.read('7.56a.json'), { SourcePacket: 10 })
  await mergeHistory(options)
  assert.deepEqual(f.read('7.56a.json'), { ProjectPacket: 10 })
  assert.deepEqual(f.read('current.json'), { ProjectPacket: 10 })
})

test('invalid, ambiguous, or missing name mappings abort before output changes', async (t) => {
  const f = fixture(t)
  const packetsFile = join(f.dir, 'packets.yaml')
  const files = ['version.json', '7.55.json', '7.56a.json', 'current.json']
  const before = files.map((name) => readFileSync(join(f.dir, name), 'utf-8'))
  const inputs = [
    '',
    '[]',
    'Packet: []',
    serverPackets('Packet:\n  FFXIVOpcodes: 123\n'),
    serverPackets('Packet:\n  FFXIVOpcodes: Alias\n  FFXIVOpcodes: Other\n'),
    serverPackets('First:\n  FFXIVOpcodes: Alias\nSecond:\n  FFXIVOpcodes: Alias\n'),
    serverPackets('First:\n  FFXIVOpcodes: Second\nSecond:\n  FFXIVOpcodes: Third\n'),
  ]
  const loadUpstream = async () => {
    assert.fail('Must not fetch with invalid mappings')
  }
  for (const input of inputs) {
    writeFileSync(packetsFile, input)
    assert.throws(() => loadPackets(packetsFile))
    await assert.rejects(
      generateJson({
        packetsFile,
        inputFile: f.inputFile,
        outputDir: f.dir,
        loadUpstream,
      }),
    )
    await assert.rejects(
      mergeHistory({
        packetsFile,
        version: '7.56a',
        ref: 'tag',
        outputDir: f.dir,
        loadUpstream,
      }),
    )
    assert.deepEqual(
      files.map((name) => readFileSync(join(f.dir, name), 'utf-8')),
      before,
    )
  }
  rmSync(packetsFile)
  await assert.rejects(
    generateJson({
      packetsFile,
      inputFile: f.inputFile,
      outputDir: f.dir,
      loadUpstream,
    }),
    /ENOENT/,
  )
  assert.deepEqual(
    files.map((name) => readFileSync(join(f.dir, name), 'utf-8')),
    before,
  )
})

test('packet direction comes from YAML independently of the IPC category', () => {
  for (const category of ['ServerZoneIpc', 'ClientZoneIpc', 'ServerLobbyIpc', 'ClientLobbyIpc', 'ServerChatIpc', 'ClientChatIpc', 'CustomIpc']) {
    for (const direction of ['server-to-client', 'client-to-server']) {
      const { aliases, packets } = parsePackets(JSON.stringify({ [category]: { direction, packets: { KnownPacket: {} } } }))
      assert.deepEqual(packets.get('KnownPacket'), { category, direction, names: {} })
      assert.equal(aliases.size, 0)
    }
  }
})

test('invalid category metadata and cross-category name collisions are rejected', () => {
  const server = { direction: 'server-to-client', packets: { First: { FFXIVOpcodes: 'Alias' } } }
  const client = { direction: 'client-to-server', packets: { Second: {} } }
  for (const input of [
    { '': server },
    { '   ': server },
    { CustomIpc: null },
    { CustomIpc: [] },
    ...[undefined, null, '', 'outgoing', true, 0, [], {}].map(direction => ({ ServerZoneIpc: { ...server, direction } })),
    { ServerZoneIpc: { packets: {} } },
    { ServerZoneIpc: { direction: 'server-to-client', packets: [] } },
    { ServerZoneIpc: server, ClientZoneIpc: { ...client, packets: { First: {} } } },
    { ServerZoneIpc: server, ClientZoneIpc: { ...client, packets: { Alias: {} } } },
    { ServerZoneIpc: server, ClientZoneIpc: { ...client, packets: { Second: { FFXIVOpcodes: 'Alias' } } } },
  ]) assert.throws(() => parsePackets(JSON.stringify(input)))
})

test('repository catalog covers current opcodes and distinguishes zone and lobby traffic', () => {
  const { aliases, packets } = loadPackets()
  const current = JSON.parse(readFileSync(new URL('../../json/current.json', import.meta.url), 'utf8'))
  for (const name of Object.keys(current)) assert(packets.has(name), `Missing metadata: ${name}`)
  assert.equal(aliases.get('DespawnCharacter'), 'ActorFreeSpawn')
  assert.equal(packets.get('ActorCast').names.ACT, 'ActorCast')
  assert.equal(packets.get('EnvironmentControl').names.OverlayPlugin, 'MapEffect')
  assert.equal(packets.get('ActionRequest').direction, 'client-to-server')
  assert.equal(packets.get('ClientVersionInfo').category, 'ClientLobbyIpc')
  assert.equal(packets.get('LobbyEnterWorld').category, 'ServerLobbyIpc')
})
