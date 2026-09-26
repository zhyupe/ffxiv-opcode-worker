import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { mergeOpcodes } from '../../lib/ffxiv-opcodes.mjs'
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
