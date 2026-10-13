import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, parseDiff } from '../../lib/opcodediff.mjs'
import { parsePackets } from '../../lib/packets.mjs'
import { generate } from './index.mjs'

function fixture() {
  const previous = {}, lists = { ServerZoneIpcType: [], ClientZoneIpcType: [], ServerLobbyIpcType: [] }, diff = []
  let yaml = ''
  for (const [category, count, base] of [['ServerZoneIpc', 20, 100], ['ClientZoneIpc', 5, 200]]) {
    yaml += `${category}:\n  direction: ${category.startsWith('Server') ? 'server-to-client' : 'client-to-server'}\n  packets:\n`
    for (let i = 0; i < count; i++) {
      const name = `${category}${i}`, opcode = base + i
      previous[name] = opcode; lists[`${category}Type`].push({ name, opcode })
      diff.push({ old: [opcode], new: [opcode + 1000] }); yaml += `    ${name}: {}\n`
    }
    if (category === 'ServerZoneIpc') yaml += '    Custom: {}\n    Other: {}\n'
  }
  yaml += 'ServerLobbyIpc:\n  direction: server-to-client\n  packets:\n    Lobby: {}\n'
  previous.Custom = 300; diff.push({ old: [300], new: [1300] })
  previous.Lobby = 7; lists.ServerLobbyIpcType.push({ name: 'Lobby', opcode: 7 })
  const updated = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.map(e => ({ ...e, opcode: e.opcode + 1000 }))]))
  return { previous, diff, names: parsePackets(yaml), yaml, sourceVersion: '1.0', version: '1.1',
    oldUpstream: [{ region: 'Global', version: '1.0', lists }],
    newUpstream: ['Global', 'CN', 'KR'].map(region => ({ region, version: '1.1', lists: structuredClone(updated) })) }
}
test('migrates extra packets, verifies regions, uses fresh upstream for Lobby', () => {
  const f = fixture(), r = migrate(f)
  assert.equal(r.opcodes.Custom, '0x0514')
  assert.equal(r.opcodes.Lobby, '0x03EF')
  assert.deepEqual(r.report.checked, { ServerZoneIpc: 20, ClientZoneIpc: 5 })
  assert.deepEqual(r.report.unresolved, [])
  assert.equal(f.previous.Custom, 300)
})
test('rejects wrong baseline, wrong diff, regional differences and category conflicts', () => {
  let f = fixture(); f.previous.ServerZoneIpc0 = 99
  assert.throws(() => migrate(f), /baseline mismatch/)
  f = fixture(); f.diff[0].new = [999]
  assert.throws(() => migrate(f), /disagrees/)
  f = fixture(); f.newUpstream[1].lists.ServerZoneIpcType.pop()
  assert.throws(() => migrate(f), /Regional/)
  f = fixture(); f.names.packets.get('ServerZoneIpc0').category = 'ClientZoneIpc'
  assert.throws(() => migrate(f), /Category/)
  f = fixture(); f.previous = { Custom: 300 }
  assert.throws(() => migrate(f), /local baseline anchors/)
})
test('missing/ambiguous matches remain unresolved; no old value or Lobby diff reused', () => {
  const f = fixture(); f.diff.at(-1).new = [1300, 1301]
  for (const r of f.newUpstream) r.lists.ServerLobbyIpcType = []
  f.diff.push({ old: [7], new: [8] })
  const r = migrate(f)
  assert.deepEqual(r.report.unresolved.sort(), ['Custom', 'Lobby'])
  assert.equal(r.opcodes.Custom, undefined)
  assert.equal(r.opcodes.Lobby, undefined)
})
test('overrides cannot contradict upstream or collide within a category', () => {
  let f = fixture(); f.overrides = { ServerZoneIpc0: 1 }
  assert.throws(() => migrate(f), /Override disagrees/)
  f = fixture(); f.overrides = { Other: 1300 }
  assert.throws(() => migrate(f), /collision/)
  f = fixture(); f.overrides = { Custom: 1400 }
  assert.equal(migrate(f).opcodes.Custom, '0x0578')
  assert.throws(() => parseDiff([{ old: [1], new: [2] }, { old: [1], new: [3] }]), /Duplicate/)
  assert.throws(() => parseDiff([{ old: [1], new: [65536] }]), /Invalid opcode/)
})
test('generation preserves history, is repeatable and never writes rejected sources', async t => {
  const f = fixture(), dir = mkdtempSync(join(tmpdir(), 'opcode-migration-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const put = (p, v) => writeFileSync(join(dir, p), JSON.stringify(v))
  const config = { previousVersion: '1.0a', sourceVersion: '1.0', version: '1.1',
    diffRef: 'a'.repeat(40), oldUpstreamRef: 'b'.repeat(40), newUpstreamRef: 'c'.repeat(40) }
  put('config.json', config); put('version.json', ['1.0a']); put('1.0a.json', f.previous)
  writeFileSync(join(dir, 'packets.yaml'), f.yaml)
  const options = { configFile: join(dir, 'config.json'), outputDir: dir, reportsDir: join(dir, 'reports'),
    overridesDir: join(dir, 'overrides'), packetsFile: join(dir, 'packets.yaml'),
    loadUpstream: async ref => ref[0] === 'b' ? f.oldUpstream : f.newUpstream,
    loadDiff: async (_, p) => p.startsWith('diffs/') ? f.diff : [{ retail_version: '1.0' }, { retail_version: '1.1' }] }
  const baseline = readFileSync(join(dir, '1.0a.json'), 'utf8')
  await generate(options)
  const current = readFileSync(join(dir, 'current.json'), 'utf8')
  await generate(options)
  assert.equal(readFileSync(join(dir, 'current.json'), 'utf8'), current)
  assert.equal(readFileSync(join(dir, '1.0a.json'), 'utf8'), baseline)
  f.diff.at(-1).new = [1300, 1301]
  await assert.rejects(generate(options), /Unresolved/)
  assert.equal(readFileSync(join(dir, 'current.json'), 'utf8'), current)
  await assert.rejects(generate({ ...options, loadDiff: async (_, p) => p.startsWith('diffs/') ? f.diff : [] }), /predecessor/)
  assert.equal(readFileSync(join(dir, 'current.json'), 'utf8'), current)
  mkdirSync(join(dir, 'overrides')); put('overrides/1.1.json', { Custom: 1400 })
  await generate(options)
  assert.equal(JSON.parse(readFileSync(join(dir, 'current.json'))).Custom, '0x0578')
})

test('known upstream values fill diff gaps without applying Zone diff to Lobby', () => {
  const f = fixture()
  f.diff = f.diff.filter(r => r.old[0] !== 300)
  for (const r of f.newUpstream) r.lists.ServerZoneIpcType.push({ name: 'Custom', opcode: 1400 })
  const result = migrate(f)
  assert.equal(result.opcodes.Custom, '0x0578')
  assert.equal(result.report.provenance.Custom, 'upstream')
  f.newUpstream[0].version = '9.9'
  assert.throws(() => migrate(f), /Unexpected Global version/)
})
