import { normalizeOpcodeNames } from './packets.mjs'
import { validateOpcodes } from './ffxiv-opcodes.mjs'

const zoneCategories = ['ServerZoneIpc', 'ClientZoneIpc']
const hex = n => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`
function value(v) {
  validateOpcodes({ opcode: v })
  return Number(v)
}
export function parseDiff(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty or invalid opcode diff')
  const result = new Map()
  for (const row of rows) {
    if (!Array.isArray(row.old) || !Array.isArray(row.new) || !row.old.length || !row.new.length)
      throw new Error('Invalid opcode diff entry')
    const targets = row.new.map(value)
    for (const old of row.old.map(value)) {
      if (result.has(old)) throw new Error(`Duplicate diff source: ${hex(old)}`)
      // Splits and merges require review, even if one side happens to have one value.
      result.set(old, row.old.length === 1 && targets.length === 1 ? targets[0] : null)
    }
  }
  return result
}
function table(data, region, version, names) {
  const matches = data.filter(r => r.region === region)
  if (matches.length !== 1 || matches[0].version !== version) throw new Error(`Unexpected ${region} version; expected ${version}`)
  const result = new Map()
  for (const [type, entries] of Object.entries(matches[0].lists)) {
    if (!Array.isArray(entries)) throw new Error('Invalid upstream list')
    const category = type.replace(/Type$/, '')
    for (const entry of entries) {
      if (typeof entry.name !== 'string' || !entry.name) throw new Error('Invalid upstream name')
      const name = names.aliases.get(entry.name) ?? entry.name
      const metadata = names.packets.get(name)
      if (metadata && metadata.category !== category) throw new Error(`Category conflict: ${name}`)
      if (result.has(name)) throw new Error(`Duplicate upstream name: ${name}`)
      result.set(name, { value: value(entry.opcode), category })
    }
  }
  return result
}
export function migrate({ previous, oldUpstream, newUpstream, diff, names, sourceVersion,
  version, region = 'Global', sharedRegions = ['CN', 'KR'], overrides = {} }) {
  validateOpcodes(previous)
  validateOpcodes(overrides)
  previous = normalizeOpcodeNames(previous, names)
  overrides = normalizeOpcodeNames(overrides, names)
  const old = table(oldUpstream, region, sourceVersion, names)
  const next = table(newUpstream, region, version, names)
  const mapping = parseDiff(diff)
  for (const other of sharedRegions) {
    const peer = table(newUpstream, other, version, names)
    for (const category of zoneCategories) {
      const a = [...next].filter(([, r]) => r.category === category)
      const b = [...peer].filter(([, r]) => r.category === category)
      if (a.length !== b.length || a.some(([n, r]) => peer.get(n)?.category !== category || peer.get(n)?.value !== r.value))
        throw new Error(`Regional Zone tables differ: ${region}/${other}/${category}`)
    }
  }
  const checked = Object.fromEntries(zoneCategories.map(c => [c, 0]))
  const baselineChecked = Object.fromEntries(zoneCategories.map(c => [c, 0]))
  const upstreamOnly = []
  for (const [name, before] of old) {
    const after = next.get(name)
    if (Object.hasOwn(previous, name) && value(previous[name]) !== before.value)
      throw new Error(`Old baseline mismatch: ${name}`)
    if (Object.hasOwn(previous, name) && zoneCategories.includes(before.category)) baselineChecked[before.category]++
    if (!after || !zoneCategories.includes(before.category)) continue
    if (after.category !== before.category) throw new Error(`Category changed: ${name}`)
    const mapped = mapping.get(before.value)
    if (mapped == null) { upstreamOnly.push(name); continue }
    if (mapped !== after.value) throw new Error(`Diff disagrees with upstream: ${name}`)
    checked[before.category]++
  }
  // Require independent anchors in each direction before migrating unnamed extra packets.
  if (checked.ServerZoneIpc < 20 || checked.ClientZoneIpc < 5)
    throw new Error('Insufficient independent opcode anchors')
  if (baselineChecked.ServerZoneIpc < 20 || baselineChecked.ClientZoneIpc < 5)
    throw new Error('Insufficient local baseline anchors')
  const output = {}
  const provenance = {}
  const unresolved = []
  const categories = new Map()
  for (const [name, row] of next) {
    output[name] = hex(row.value)
    categories.set(name, row.category)
    provenance[name] = 'upstream'
  }
  for (const [name, opcode] of Object.entries(previous)) {
    if (Object.hasOwn(output, name)) continue
    const category = names.packets.get(name)?.category
    categories.set(name, category)
    if (name === 'InventoryHandlerOffset') continue
    const mapped = mapping.get(value(opcode))
    if (zoneCategories.includes(category) && mapped != null) {
      output[name] = hex(mapped)
      provenance[name] = 'opcodediff'
    } else unresolved.push(name)
  }
  for (const [name, opcode] of Object.entries(overrides)) {
    const category = names.packets.get(name)?.category
    if (!category) throw new Error(`Override has no packet metadata: ${name}`)
    if (next.has(name) && next.get(name).value !== value(opcode)) throw new Error(`Override disagrees with upstream: ${name}`)
    output[name] = hex(value(opcode)); categories.set(name, category); provenance[name] = 'override'
  }
  if (Object.hasOwn(previous, 'InventoryHandlerOffset')) {
    if (output.InventoryModifyHandler) {
      if (output.InventoryHandlerOffset && output.InventoryHandlerOffset !== output.InventoryModifyHandler)
        throw new Error('InventoryHandlerOffset must match InventoryModifyHandler')
      output.InventoryHandlerOffset = output.InventoryModifyHandler
      provenance.InventoryHandlerOffset = 'InventoryModifyHandler'
    } else unresolved.push('InventoryHandlerOffset')
  }
  const used = new Map()
  for (const [name, opcode] of Object.entries(output)) {
    if (name === 'InventoryHandlerOffset') continue
    const key = `${categories.get(name)}:${opcode}`
    if (used.has(key)) throw new Error(`Opcode collision: ${used.get(key)} / ${name}`)
    used.set(key, name)
  }
  return { opcodes: output, report: { checked, baselineChecked, sharedRegions, upstreamOnly,
    unresolved: unresolved.filter(n => !Object.hasOwn(output, n)), provenance } }
}
