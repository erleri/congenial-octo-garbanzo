import fs from 'node:fs/promises'
import path from 'node:path'
import { createEditorialEvalFixtures } from './fx-report-eval-fixtures.js'
import { scoreEditorialDecision, validateEditorialDecision } from './fx-report-core.js'
import { enhanceReportWithOpenRouter } from './openrouter-report.js'

const OUTPUT_PATH = path.resolve('fx-report-eval.json')

function argumentsFrom(argv) {
  const live = argv.includes('--live')
  const limitArgument = argv.find((item) => item.startsWith('--limit='))
  const requestedLimit = Number(limitArgument?.split('=')[1] ?? (live ? 5 : 40))
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new Error('--limit must be a positive integer.')
  if (live && requestedLimit > 5) throw new Error('Live evaluation is limited to five fixtures per run.')
  return { live, limit: Math.min(requestedLimit, live ? 5 : 40) }
}

async function evaluateFixture(fixture, options) {
  const startedAt = Date.now()
  if (!options.live) {
    const validation = validateEditorialDecision(fixture.baselineDecision, fixture.evidence)
    const quality = scoreEditorialDecision(fixture.baselineDecision, fixture.evidence)
    return {
      id: fixture.id,
      category: fixture.category,
      mode: 'offline',
      model: null,
      durationMs: Date.now() - startedAt,
      hardGate: validation,
      quality,
      adopted: validation.valid && quality.passed,
      error: null,
    }
  }

  try {
    const result = await enhanceReportWithOpenRouter({
      apiKey: process.env.OPENROUTER_API_KEY?.trim(),
      model: process.env.FX_REPORT_AI_MODEL?.trim() || 'openrouter/free',
      evidence: fixture.evidence,
    })
    return {
      id: fixture.id,
      category: fixture.category,
      mode: 'live',
      model: result.model,
      durationMs: Date.now() - startedAt,
      hardGate: { valid: result.validation.valid, errors: result.validation.errors },
      quality: result.validation.quality,
      adopted: true,
      error: null,
    }
  } catch (error) {
    return {
      id: fixture.id,
      category: fixture.category,
      mode: 'live',
      model: typeof error?.model === 'string' ? error.model : null,
      durationMs: Date.now() - startedAt,
      hardGate: error?.validation ?? { valid: false, errors: ['openrouter_failure'] },
      quality: error?.validation?.quality ?? null,
      adopted: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2))
  if (options.live && !process.env.OPENROUTER_API_KEY?.trim()) throw new Error('OPENROUTER_API_KEY is required for --live evaluation.')
  const fixtures = createEditorialEvalFixtures().slice(0, options.limit)
  const results = []
  for (const fixture of fixtures) results.push(await evaluateFixture(fixture, options))
  const adopted = results.filter((item) => item.adopted).length
  const output = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    mode: options.live ? 'live' : 'offline',
    requestedModel: options.live ? process.env.FX_REPORT_AI_MODEL?.trim() || 'openrouter/free' : null,
    fixtureCount: results.length,
    adoptedCount: adopted,
    adoptionRate: results.length ? Number(((adopted / results.length) * 100).toFixed(1)) : 0,
    results,
  }
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${OUTPUT_PATH}: ${adopted}/${results.length} decisions passed.`)
  if (!options.live && adopted !== results.length) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
