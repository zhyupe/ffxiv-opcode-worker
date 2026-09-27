import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

export const defaultPacketsFile = new URL('../packets.yaml', import.meta.url)

const categoryDirections = {
  ServerZoneIpc: 'server-to-client',
  ClientZoneIpc: 'client-to-server',
  ServerLobbyIpc: 'server-to-client',
  ClientLobbyIpc: 'client-to-server',
  ServerChatIpc: 'server-to-client',
  ClientChatIpc: 'client-to-server',
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parsePackets(source) {
  const definitions = parse(source)
  if (!isRecord(definitions)) {
    throw new Error('Expected IPC categories in packets.yaml')
  }
  const aliases = new Map()
  const packets = new Map()
  for (const [category, group] of Object.entries(definitions)) {
    if (!Object.hasOwn(categoryDirections, category) || !isRecord(group)) {
      throw new Error(`Invalid IPC category: ${category}`)
    }
    const expectedDirection = categoryDirections[category]
    if (group.direction !== expectedDirection) {
      throw new Error(`Invalid direction for ${category}: expected ${expectedDirection}`)
    }
    if (!isRecord(group.packets)) {
      throw new Error(`Expected a packet mapping in ${category}`)
    }
    for (const [name, providers] of Object.entries(group.packets)) {
      if (!name.trim() || !isRecord(providers)) {
        throw new Error(`Invalid packet definition: ${category}.${name}`)
      }
      if (packets.has(name)) {
        throw new Error(`Duplicate project packet name across categories: ${name}`)
      }
      for (const [provider, alias] of Object.entries(providers)) {
        if (!provider.trim() || typeof alias !== 'string' || !alias.trim()) {
          throw new Error(`Invalid ${provider} name for ${name}`)
        }
      }
      packets.set(name, {
        category,
        direction: expectedDirection,
        names: providers,
      })
      const alias = providers.FFXIVOpcodes
      if (alias === undefined) continue
      if (aliases.has(alias)) {
        throw new Error(`Ambiguous FFXIVOpcodes name ${alias}: ${aliases.get(alias)} and ${name}`)
      }
      aliases.set(alias, name)
    }
  }
  for (const [alias, name] of aliases) {
    if (alias !== name && packets.has(alias)) {
      throw new Error(`FFXIVOpcodes alias ${alias} is also a project packet name`)
    }
  }
  return { aliases, packets }
}

export function loadPackets(file = defaultPacketsFile) {
  return parsePackets(readFileSync(file, 'utf8'))
}

export function normalizeOpcodeNames(opcodes, names) {
  const normalized = new Map()
  for (const [name, value] of Object.entries(opcodes)) {
    const canonical = names.aliases.get(name) ?? name
    // An existing project name wins over a retained upstream alias.
    if (canonical !== name && Object.hasOwn(opcodes, canonical)) continue
    normalized.set(canonical, value)
  }
  return Object.fromEntries(normalized)
}
