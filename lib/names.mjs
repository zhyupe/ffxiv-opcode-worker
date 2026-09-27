import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

export const defaultNamesFile = new URL('../names.yaml', import.meta.url)

export function loadNames(file = defaultNamesFile) {
  const definitions = parse(readFileSync(file, 'utf-8'))
  if (
    !definitions ||
    typeof definitions !== 'object' ||
    Array.isArray(definitions)
  ) {
    throw new Error('Expected a packet-name mapping in names.yaml')
  }
  const aliases = new Map()
  for (const [name, providers] of Object.entries(definitions)) {
    if (
      !name.trim() ||
      !providers ||
      typeof providers !== 'object' ||
      Array.isArray(providers)
    ) {
      throw new Error(`Invalid packet-name definition: ${name}`)
    }
    for (const [provider, alias] of Object.entries(providers)) {
      if (typeof alias !== 'string' || !alias.trim()) {
        throw new Error(`Invalid ${provider} name for ${name}`)
      }
    }
    const alias = providers.FFXIVOpcodes
    if (alias === undefined) continue
    if (aliases.has(alias)) {
      throw new Error(
        `Ambiguous FFXIVOpcodes name ${alias}: ${aliases.get(alias)} and ${name}`,
      )
    }
    if (alias !== name && Object.hasOwn(definitions, alias)) {
      throw new Error(
        `FFXIVOpcodes alias ${alias} is also a project packet name`,
      )
    }
    aliases.set(alias, name)
  }
  return { aliases }
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
