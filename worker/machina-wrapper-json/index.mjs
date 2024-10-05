import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readCsv } from '../../lib/csv.mjs'
import { parseOpcode, formatOpcode } from '../../lib/opcode.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const workspace = process.argv[2]
let version = process.argv[3]
if (/^\d\.\d$/.test(version)) {
  version += '0'
}

const csvVersion = version.replace(/0+$/, '')

const text = readFileSync(join(__dirname, '../../cn-opcodes.csv'), 'utf-8')
const table = readCsv(text, null, { header: 0, skip: 1 })

const output = {}
const existsOpcode = new Set()
const specialValues = {}

for (let {
  Name: name,
  Scope: scope,
  TeamCraft: altname,
  [csvVersion]: opcode,
} of table) {
  if (!name || !opcode || opcode === '#N/A') {
    continue
  }

  if (!output[scope]) {
    output[scope] = []
  }

  if (altname.includes('!')) {
    specialValues[name] = opcode
    continue
  }

  const opcodeValue = parseInt(opcode)
  if (existsOpcode.has(`${scope}:${opcodeValue}`)) {
    throw new Error(`Detected duplicate opcode ${opcode}`)
  }
  existsOpcode.add(`${scope}:${opcodeValue}`)

  output[scope].push({
    name: altname || name,
    opcode,
  })
}

const scopes = [
  'ServerLobbyIpc',
  'ClientLobbyIpc',
  'ServerZoneIpc',
  'ClientZoneIpc',
  'ServerChatIpc',
  'ClientChatIpc',
]
const tab = `    `

const opcodeFile = join(workspace, 'FFXIVOpcodes/Ipcs_cn.cs')
const constantFile = join(workspace, 'FFXIVConstants/CN.cs')

mkdirSync(dirname(opcodeFile), { recursive: true })
mkdirSync(dirname(constantFile), { recursive: true })

writeFileSync(
  opcodeFile,
  `// Generated by https://github.com/zhyupe/ffxiv-opcode-worker

namespace FFXIVOpcodes.CN
{
${scopes
    .map(
      (key) => `${tab}public enum ${key}Type : ushort
${tab}{
${(output[key] || [])
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ name, opcode }) => `${tab}${tab}${name} = ${opcode},`)
          .join('\n')}
${tab}};`
    )
    .join('\n\n')}
}
`
)

const offset = parseOpcode(specialValues.InventoryHandlerOffset) + 7
writeFileSync(
  constantFile,
  `// Generated by https://github.com/zhyupe/ffxiv-opcode-worker
using System.Collections.Generic;

namespace FFXIVConstants
{
${tab}public static class CN
${tab}{
${tab}${tab}public const string Version = "${version}";

${tab}${tab}public static Dictionary<string, object> Constants = new Dictionary<string, object>
${tab}${tab}{
${tab}${tab}${tab}{ "InventoryOperationBaseValue", 0x${formatOpcode(offset)} },
${tab}${tab}};
${tab}}
}
`
)
