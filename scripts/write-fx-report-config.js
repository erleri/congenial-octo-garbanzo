import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const OUTPUT_PATH = path.resolve('src/generated/fxReportConfig.ts')

export function reportFeatureEnabled(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error('FX_REPORT_ENABLED must be true or false.')
}

export function renderReportConfig(enabled) {
  return `// Updated by the Daily Dashboard Email workflow from the repository variable.\nexport const fxReportConfig = {\n  enabled: ${enabled},\n} as const\n`
}

export async function writeReportConfig(value = process.env.FX_REPORT_ENABLED) {
  const enabled = reportFeatureEnabled(value)
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  await fs.writeFile(OUTPUT_PATH, renderReportConfig(enabled), 'utf8')
  console.log(`FX report UI is ${enabled ? 'enabled' : 'disabled'}.`)
}

const entryPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (entryPath === import.meta.url) {
  writeReportConfig().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
