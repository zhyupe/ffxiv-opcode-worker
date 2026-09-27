import { loadPackets, normalizeOpcodeNames } from './packets.mjs'

const sourceUrl = 'https://raw.githubusercontent.com/karashiiro/FFXIVOpcodes'

export async function fetchOpcodes(ref = 'master') {
  const response = await fetch(
    `${sourceUrl}/${encodeURIComponent(ref)}/opcodes.json`,
    { signal: AbortSignal.timeout(30_000) },
  )
  if (!response.ok) {
    throw new Error(
      `Cannot fetch FFXIVOpcodes at ${ref}: HTTP ${response.status}`,
    )
  }
  return response.json()
}

function opcodeValue(value) {
  if (
    typeof value !== 'number' &&
    !(typeof value === 'string' && /^(?:0x[\da-f]+|\d+)$/i.test(value))
  ) {
    throw new Error(`Invalid opcode: ${JSON.stringify(value)}`)
  }
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 0xffff) {
    throw new Error(`Invalid opcode: ${JSON.stringify(value)}`)
  }
  return number
}

export function validateOpcodes(opcodes) {
  if (!opcodes || typeof opcodes !== 'object' || Array.isArray(opcodes)) {
    throw new Error('Expected an opcode object')
  }
  for (const value of Object.values(opcodes)) opcodeValue(value)
  return opcodes
}

export function serializeOpcodes(opcodes) {
  return `${JSON.stringify(
    Object.fromEntries(
      Object.entries(opcodes).sort(([a], [b]) => a.localeCompare(b)),
    ),
    null,
    2,
  )}\n`
}

// Validate the complete source before merging; rejected sources add nothing.
export function mergeOpcodes(
  opcodes,
  upstream,
  region = 'Global',
  names = loadPackets(),
) {
  validateOpcodes(opcodes)
  opcodes = normalizeOpcodeNames(opcodes, names)
  if (!Array.isArray(upstream))
    throw new Error('Expected an FFXIVOpcodes array')
  const matches = upstream.filter((entry) => entry?.region === region)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${region} entry in FFXIVOpcodes`)
  }
  const { lists, version } = matches[0]
  if (!lists || typeof lists !== 'object' || Array.isArray(lists)) {
    throw new Error(`Invalid opcode lists for ${region}`)
  }
  const rawIncoming = new Map()
  for (const entries of Object.values(lists)) {
    if (!Array.isArray(entries)) throw new Error('Invalid opcode list')
    for (const entry of entries) {
      if (!entry || typeof entry.name !== 'string' || !entry.name) {
        throw new Error('Invalid opcode name')
      }
      const { name, opcode } = entry
      const value = opcodeValue(opcode)
      if (rawIncoming.has(name) && rawIncoming.get(name) !== value) {
        throw new Error(
          `Upstream opcode conflict for ${name}: ${rawIncoming.get(name)} != ${opcode}`,
        )
      }
      rawIncoming.set(name, value)
    }
  }

  const incoming = new Map()
  for (const [sourceName, value] of rawIncoming) {
    const name = names.aliases.get(sourceName) ?? sourceName
    if (incoming.has(name) && incoming.get(name) !== value) {
      throw new Error(
        `Upstream opcode conflict for ${name}: ${incoming.get(name)} != ${value}`,
      )
    }
    incoming.set(name, value)
  }

  let overlap = 0
  let conflicts = 0
  const merged = new Map(Object.entries(opcodes))
  for (const [name, value] of incoming) {
    if (Object.hasOwn(opcodes, name)) {
      overlap++
      if (opcodeValue(opcodes[name]) !== value) conflicts++
      // Local values (CSV takes precedence during generation) always win.
    } else {
      merged.set(name, `0x${value.toString(16).toUpperCase().padStart(4, '0')}`)
    }
  }
  if (!overlap)
    throw new Error('No overlapping opcodes to verify compatibility')
  if (conflicts * 2 >= overlap) {
    throw new Error(
      `Opcode conflicts: ${conflicts}/${overlap} overlapping names (50% or more)`,
    )
  }
  return {
    opcodes: Object.fromEntries(merged),
    added: merged.size - Object.keys(opcodes).length,
    overlap,
    conflicts,
    version,
  }
}
