import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { fetchOpcodes, serializeOpcodes } from '../../lib/ffxiv-opcodes.mjs'
import { loadPackets } from '../../lib/packets.mjs'
import { migrate } from '../../lib/opcodediff.mjs'

const read = file => JSON.parse(readFileSync(file, 'utf8'))
async function fetchDiffFile(ref, path) {
  const response = await fetch(`https://raw.githubusercontent.com/xivdev/opcodediff/${ref}/${path}`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Cannot fetch opcodediff: HTTP ${response.status}`)
  return response.json()
}
export async function generate({ configFile = 'opcode-source.json', outputDir = 'json',
  overridesDir = 'overrides', reportsDir = 'reports', packetsFile, dryRun = false,
  loadUpstream = fetchOpcodes, loadDiff = fetchDiffFile } = {}) {
  const config = read(configFile)
  for (const key of ['diffRef', 'oldUpstreamRef', 'newUpstreamRef'])
    if (!/^[a-f0-9]{40}$/.test(config[key])) throw new Error(`${key} must be a fixed commit SHA`)
  for (const key of ['previousVersion', 'sourceVersion', 'version'])
    if (!/^\d+\.\d+[a-z]*\d*$/.test(config[key])) throw new Error(`Invalid ${key}`)
  if (config.previousVersion === config.version) throw new Error('Source and target must differ')
  const versions = read(join(outputDir, 'version.json'))
  if (!Array.isArray(versions) || !versions.includes(config.previousVersion)
    || ![config.previousVersion, config.version].includes(versions.at(-1)))
    throw new Error('Migration must extend the latest published version')
  const [diff, builds, oldUpstream, newUpstream] = await Promise.all([
    loadDiff(config.diffRef, `diffs/${config.version}.diff.json`),
    loadDiff(config.diffRef, 'automation/ffxiv_versions_global.json'),
    loadUpstream(config.oldUpstreamRef), loadUpstream(config.newUpstreamRef),
  ])
  const index = builds.findIndex(b => b.retail_version === config.version)
  if (index < 1 || builds[index - 1].retail_version !== config.sourceVersion)
    throw new Error('Diff predecessor does not match sourceVersion')
  let overrides = {}
  try { overrides = read(join(overridesDir, `${config.version}.json`)) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const result = migrate({ ...config, previous: read(join(outputDir, `${config.previousVersion}.json`)),
    diff, oldUpstream, newUpstream, names: loadPackets(packetsFile), overrides })
  const report = { ...config, oldBuild: builds[index - 1].version_string,
    newBuild: builds[index].version_string, ...result.report }
  // All fetching, baseline checks, conflicts and serialization precede output writes.
  const text = serializeOpcodes(result.opcodes)
  if (!dryRun) {
    if (report.unresolved.length) throw new Error(`Unresolved packets: ${report.unresolved.join(', ')}`)
    try {
      const existing = read(join(outputDir, `${config.version}.json`))
      const missing = Object.keys(existing).filter(name => !Object.hasOwn(result.opcodes, name))
      if (missing.length) throw new Error(`Target additions must be preserved in overrides: ${missing.join(', ')}`)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    mkdirSync(reportsDir, { recursive: true })
    writeFileSync(join(reportsDir, `${config.version}.json`), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(join(outputDir, `${config.version}.json`), text)
    writeFileSync(join(outputDir, 'current.json'), text)
    writeFileSync(join(outputDir, 'version.json'), `${JSON.stringify([...new Set([...versions, config.version])], null, 2)}\n`)
  }
  return { ...result, report }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: {
      config: { type: 'string' }, output: { type: 'string' }, packets: { type: 'string' },
      overrides: { type: 'string' }, reports: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
    } })
    const result = await generate({ configFile: values.config, outputDir: values.output,
      packetsFile: values.packets, overridesDir: values.overrides, reportsDir: values.reports, dryRun: values['dry-run'] })
    console.log(JSON.stringify({ count: Object.keys(result.opcodes).length, checked: result.report.checked,
      unresolved: result.report.unresolved, dryRun: values['dry-run'] }, null, 2))
  } catch (error) { console.error(`Generation aborted: ${error.message}`); process.exitCode = 1 }
}
