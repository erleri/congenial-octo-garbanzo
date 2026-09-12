import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadBusinessPlanForEmail } from './business-plan-email.js'
import { buildDeterministicReport, buildFxReportEvidence } from './fx-report-core.js'
import { loadOperationalFxDataset } from './load-fx-dataset.js'
import { enhanceReportWithOpenRouter } from './openrouter-report.js'

const OUTPUT_PATH = path.resolve('fx-report-run.json')
const PUBLISHED_PATH = path.resolve('fx-report-published.json')
const ALPHA_VANTAGE_ENDPOINT = 'https://www.alphavantage.co/query'

async function fetchNews() {
  const apiKey = process.env.VITE_ALPHA_VANTAGE_API_KEY?.trim()
  if (!apiKey) return []
  try {
    const params = new URLSearchParams({ function: 'NEWS_SENTIMENT', tickers: 'FOREX:USD', sort: 'LATEST', limit: '50', apikey: apiKey })
    const response = await fetch(`${ALPHA_VANTAGE_ENDPOINT}?${params}`)
    if (!response.ok) return []
    const payload = await response.json()
    return Array.isArray(payload.feed) ? payload.feed : []
  } catch {
    return []
  }
}

function enabled(value, fallback = false) {
  if (value === undefined || value === '') return fallback
  return String(value).toLowerCase() === 'true'
}

async function findExistingReport(baseDate) {
  const url = process.env.VITE_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) return null
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await supabase
    .from('fx_report_runs')
    .select('id, status')
    .eq('base_date', baseDate)
    .in('status', ['pending_review', 'published'])
    .order('attempt', { ascending: false })
    .limit(1)
  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code ?? '')) return null
    console.warn(`Existing FX report could not be checked; generation will continue. ${error.message}`)
    return null
  }
  if (!data?.length) return null
  let published = null
  if (data[0].status === 'published') {
    const result = await supabase
      .from('fx_reports')
      .select('base_date, generation_mode, content, evidence')
      .eq('base_date', baseDate)
      .maybeSingle()
    if (result.error) {
      console.warn(`Published FX report could not be reloaded for email. ${result.error.message}`)
      return { status: data[0].status, published: null }
    }
    published = result.data
  }
  return { status: data[0].status, published }
}

async function main() {
  await Promise.all([
    fs.rm(OUTPUT_PATH, { force: true }),
    fs.rm(PUBLISHED_PATH, { force: true }),
  ])
  if (!enabled(process.env.FX_REPORT_ENABLED, true)) {
    console.log('FX report generation is disabled.')
    return
  }
  const dataset = await loadOperationalFxDataset()
  const forced = enabled(process.env.FX_REPORT_FORCE)
  if (!forced) {
    const existing = await findExistingReport(dataset.baseDate)
    if (existing) {
      if (process.env.FX_REPORT_PUBLISH_MODE === 'automatic' && existing.published) {
        await fs.writeFile(PUBLISHED_PATH, `${JSON.stringify({
          baseDate: existing.published.base_date,
          generationMode: existing.published.generation_mode,
          content: existing.published.content,
          evidence: existing.published.evidence,
        }, null, 2)}\n`, 'utf8')
      }
      console.log(`FX report ${dataset.baseDate} already exists with status ${existing.status}; skipping generation.`)
      return
    }
  }
  const [businessPlan, articles] = await Promise.all([loadBusinessPlanForEmail(dataset), fetchNews()])
  const evidence = buildFxReportEvidence(dataset, businessPlan, articles)
  const deterministicContent = buildDeterministicReport(evidence)
  let selectedContent = deterministicContent
  let generationMode = 'deterministic'
  let aiCandidate = null
  let aiModel = null
  let aiError = null
  let rawAiResponse = null
  let validation = { valid: true, errors: [] }

  if ((process.env.FX_REPORT_AI_MODE ?? 'optional') === 'optional' && process.env.OPENROUTER_API_KEY?.trim()) {
    try {
      const result = await enhanceReportWithOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY.trim(),
        model: process.env.FX_REPORT_AI_MODEL?.trim() || 'openrouter/free',
        evidence,
      })
      selectedContent = result.candidate
      generationMode = 'ai_enhanced'
      aiCandidate = result.candidate
      aiModel = result.model
      rawAiResponse = result.raw
      validation = { ...result.validation, aiValid: true, aiErrors: [] }
    } catch (error) {
      aiError = error instanceof Error ? error.message : String(error)
      aiModel = typeof error?.model === 'string' ? error.model : null
      rawAiResponse = typeof error?.raw === 'string' ? error.raw : null
      const aiValidation = error?.validation ?? { valid: false, errors: ['openrouter_failure'] }
      validation = { valid: true, errors: [], aiValid: false, aiErrors: aiValidation.errors }
      console.warn(`AI enhancement was skipped; deterministic report remains active. ${aiError}`)
    }
  }

  const output = {
    schemaVersion: '2.0.0',
    baseDate: evidence.baseDate,
    createdAt: new Date().toISOString(),
    publishMode: process.env.FX_REPORT_PUBLISH_MODE === 'automatic' ? 'automatic' : 'review',
    generationMode,
    evidence,
    deterministicContent,
    aiCandidate,
    selectedContent,
    ai: { provider: aiModel ? 'openrouter' : null, model: aiModel, error: aiError, rawResponse: rawAiResponse },
    validation,
  }
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${OUTPUT_PATH} (${generationMode})`)
}

main().catch(async (error) => {
  console.error(error)
  // The caller marks this step non-blocking so 1.x data and email flows remain available.
  process.exitCode = 1
})
