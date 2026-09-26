import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  fetchOpcodes,
  mergeOpcodes,
  serializeOpcodes,
} from '../../lib/ffxiv-opcodes.mjs'
import { versionPattern } from './index.mjs'

export async function mergeHistory({
  version,
  ref,
  outputDir = 'json',
  region = 'Global',
  dryRun = false,
  loadUpstream = fetchOpcodes,
}) {
  if (!versionPattern.test(version) || !ref) {
    throw new Error('A target version and an upstream commit/tag are required')
  }
  const versions = JSON.parse(
    readFileSync(join(outputDir, 'version.json'), 'utf-8'),
  )
  if (!Array.isArray(versions) || !versions.includes(version)) {
    throw new Error(`Unknown target version: ${version}`)
  }
  const file = join(outputDir, `${version}.json`)
  const opcodes = JSON.parse(readFileSync(file, 'utf-8'))
  const result = mergeOpcodes(opcodes, await loadUpstream(ref), region)
  if (!dryRun) {
    const text = serializeOpcodes(result.opcodes)
    writeFileSync(file, text)
    if (version === versions.at(-1)) {
      writeFileSync(join(outputDir, 'current.json'), text)
    }
  }
  return result
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      options: {
        region: { type: 'string', default: 'Global' },
        'dry-run': { type: 'boolean', default: false },
      },
    })
    if (positionals.length < 2 || positionals.length > 3) {
      throw new Error(
        'Usage: npm run json:merge-history <version> <commit-or-tag> [output-dir] [--region Global] [--dry-run]',
      )
    }
    const result = await mergeHistory({
      version: positionals[0],
      ref: positionals[1],
      outputDir: positionals[2],
      region: values.region,
      dryRun: values['dry-run'],
    })
    console.log(
      `${values['dry-run'] ? 'Would merge' : 'Merged'} ${result.added} opcode(s) from ${values.region} ${result.version} at ${positionals[1]} into ${positionals[0]}; ${result.conflicts}/${result.overlap} overlapping opcode(s) conflict (local values take precedence)`,
    )
  } catch (error) {
    console.error(`Merge aborted: ${error.message}`)
    process.exitCode = 1
  }
}
