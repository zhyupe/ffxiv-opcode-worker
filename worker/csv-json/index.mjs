import { parse } from 'csv-parse/sync'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const inputFile = process.argv[2] ?? 'cn-opcodes.csv'
const outputDir = process.argv[3] ?? 'json'
const versionPattern = /^\d+\.\d+(?:[a-z])?$/

const rows = parse(readFileSync(inputFile, 'utf-8'), {
  columns: true,
  skip_empty_lines: true,
})

const versions = Object.keys(rows[0] ?? {}).filter((field) =>
  versionPattern.test(field)
)
const latestVersion = versions.at(-1)

rmSync(outputDir, { recursive: true, force: true })
mkdirSync(outputDir, { recursive: true })

writeFileSync(
  join(outputDir, 'version.json'),
  `${JSON.stringify(versions, null, 2)}\n`
)

let latestOpcodes

for (const version of versions) {
  const opcodes = Object.fromEntries(
    rows
      .filter((row) => row.Name && row[version] && row[version] !== '#N/A')
      .map((row) => [row.Name, row[version]])
      .sort(([a], [b]) => a.localeCompare(b))
  )

  writeFileSync(
    join(outputDir, `${version}.json`),
    `${JSON.stringify(opcodes, null, 2)}\n`
  )

  if (version === latestVersion) {
    latestOpcodes = opcodes
  }
}

if (latestOpcodes) {
  writeFileSync(
    join(outputDir, 'current.json'),
    `${JSON.stringify(latestOpcodes, null, 2)}\n`
  )
}

console.log(
  `Wrote ${versions.length} opcode JSON file(s), current.json, and version.json to ${outputDir}`
)
