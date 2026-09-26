import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parse } from 'csv-parse/sync'
import {
  fetchOpcodes,
  mergeOpcodes,
  serializeOpcodes,
  validateOpcodes,
} from '../../lib/ffxiv-opcodes.mjs'

export const versionPattern = /^\d+\.\d+(?:[a-z])?$/

export function readOpcodes(file) {
  try {
    return validateOpcodes(JSON.parse(readFileSync(file, 'utf-8')))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

export async function generateJson({
  inputFile = 'cn-opcodes.csv',
  outputDir = 'json',
  region = 'Global',
  loadUpstream = fetchOpcodes,
  logger = console,
} = {}) {
  const rows = parse(readFileSync(inputFile, 'utf-8'), {
    columns: true,
    skip_empty_lines: true,
  })
  const versions = Object.keys(rows[0] ?? {}).filter((field) =>
    versionPattern.test(field),
  )
  const latestVersion = versions.at(-1)
  if (!latestVersion) throw new Error('No opcode versions found in CSV')

  const output = new Map()
  for (const version of versions) {
    const csvOpcodes = Object.fromEntries(
      rows
        .filter((row) => row.Name && row[version] && row[version] !== '#N/A')
        .map((row) => [row.Name, row[version]]),
    )
    // Keep previously merged entries, including when the former current version
    // becomes historical. CSV remains authoritative for names it provides.
    output.set(version, {
      ...readOpcodes(join(outputDir, `${version}.json`)),
      ...csvOpcodes,
    })
  }

  try {
    const result = mergeOpcodes(
      output.get(latestVersion),
      await loadUpstream(),
      region,
    )
    output.set(latestVersion, result.opcodes)
    logger.log(
      `Merged ${result.added} opcode(s) from ${region} ${result.version}; kept local values for ${result.conflicts}/${result.overlap} overlapping opcode(s)`,
    )
  } catch (error) {
    logger.warn(`Skipped FFXIVOpcodes merge: ${error.message}`)
  }

  mkdirSync(outputDir, { recursive: true })
  writeFileSync(
    join(outputDir, 'version.json'),
    `${JSON.stringify(versions, null, 2)}\n`,
  )
  for (const [version, opcodes] of output) {
    writeFileSync(join(outputDir, `${version}.json`), serializeOpcodes(opcodes))
  }
  writeFileSync(
    join(outputDir, 'current.json'),
    serializeOpcodes(output.get(latestVersion)),
  )
  logger.log(
    `Wrote ${versions.length} opcode JSON file(s), current.json, and version.json to ${outputDir}`,
  )
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { region: { type: 'string', default: 'Global' } },
  })
  await generateJson({
    inputFile: positionals[0],
    outputDir: positionals[1],
    region: values.region,
  })
}
