const files = { Global: 'Ipcs.cs', CN: 'Ipcs_cn.cs', KR: 'Ipcs_kr.cs' }
const categories = ['ServerZoneIpcType', 'ClientZoneIpcType', 'ServerLobbyIpcType',
  'ClientLobbyIpcType', 'ServerChatIpcType', 'ClientChatIpcType']

export function parseCSharpOpcodes(source, region, version) {
  source = source.replace(/\/\*[\s\S]*?\*\//g, '')
  if (!new RegExp(`namespace\\s+FFXIVOpcodes\\.${region}\\s*\\{`).test(source))
    throw new Error(`Unexpected C# opcode namespace for ${region}`)
  const lists = {}
  for (const [, category, body] of source.matchAll(/enum\s+(\w+IpcType)\s*:\s*ushort\s*\{([^}]*)\}/g)) {
    if (!categories.includes(category) || Object.hasOwn(lists, category))
      throw new Error(`Unexpected or duplicate C# opcode category: ${category}`)
    const entries = []
    const names = new Set()
    for (const line of body.split('\n')) {
      if (!line.replace(/\/\/.*$/, '').trim()) continue
      const row = line.match(/^\s*(\w+)\s*=\s*(0x[\da-f]+|\d+)\s*,\s*(?:\/\/\s*(\S+).*)?$/i)
      if (!row || Number(row[2]) > 0xffff || names.has(row[1]))
        throw new Error(`Invalid C# opcode entry in ${region}/${category}: ${line.trim()}`)
      if (category.includes('Zone') && row[3] !== version)
        throw new Error(`Unexpected ${region} C# version; expected ${version}`)
      names.add(row[1])
      entries.push({ name: row[1], opcode: Number(row[2]) })
    }
    lists[category] = entries
  }
  if (categories.some(category => !Object.hasOwn(lists, category)))
    throw new Error(`Missing C# opcode categories for ${region}`)
  return { region, version, lists }
}

export async function fetchCSharpOpcodes(ref, { version, region = 'Global', sharedRegions = ['CN', 'KR'] }) {
  return Promise.all([...new Set([region, ...sharedRegions])].map(async region => {
    if (!Object.hasOwn(files, region)) throw new Error(`Unsupported C# opcode region: ${region}`)
    const response = await fetch(`https://raw.githubusercontent.com/karashiiro/FFXIVOpcodes/${ref}/FFXIVOpcodes/${files[region]}`,
      { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`Cannot fetch FFXIVOpcodes C# at ${ref}: HTTP ${response.status}`)
    return parseCSharpOpcodes(await response.text(), region, version)
  }))
}
