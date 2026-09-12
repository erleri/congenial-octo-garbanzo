import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const INPUT_PATH = path.resolve('fx-report-run.json')
const PUBLISHED_PATH = path.resolve('fx-report-published.json')

async function main() {
  const url = process.env.VITE_SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !serviceRoleKey) throw new Error('Supabase report persistence is not configured.')

  const payload = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8'))
  if (payload.validation?.valid !== true || !payload.selectedContent || !payload.evidence) {
    throw new Error('FX report artifact failed publication validation.')
  }
  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data: existing, error: existingError } = await supabase
    .from('fx_report_runs')
    .select('id, attempt, status')
    .eq('base_date', payload.baseDate)
    .order('attempt', { ascending: false })
    .limit(1)
  if (existingError) throw existingError

  const latest = existing?.[0]
  const forced = String(process.env.FX_REPORT_FORCE ?? '').toLowerCase() === 'true'
  if (!forced && latest && ['pending_review', 'published'].includes(latest.status)) {
    console.log(`FX report ${payload.baseDate} already exists with status ${latest.status}; skipping.`)
    return
  }

  const attempt = (latest?.attempt ?? 0) + 1
  const row = {
    base_date: payload.baseDate,
    attempt,
    schema_version: payload.schemaVersion,
    generation_mode: payload.generationMode,
    publish_mode: payload.publishMode,
    status: 'pending_review',
    evidence: payload.evidence,
    deterministic_content: payload.deterministicContent,
    ai_candidate: payload.aiCandidate,
    selected_content: payload.selectedContent,
    ai_provider: payload.ai?.provider,
    ai_model: payload.ai?.model,
    raw_ai_response: payload.ai?.rawResponse,
    validation: payload.validation,
    error_message: payload.ai?.error,
  }
  const { data: inserted, error: insertError } = await supabase
    .from('fx_report_runs')
    .insert(row)
    .select('id, base_date, status')
    .single()
  if (insertError) throw insertError

  if (payload.publishMode === 'automatic') {
    const { error: publishError } = await supabase.rpc('publish_fx_report_system', { p_run_id: inserted.id })
    if (publishError) throw publishError
    await fs.writeFile(PUBLISHED_PATH, `${JSON.stringify({
      baseDate: payload.baseDate,
      generationMode: payload.generationMode,
      content: payload.selectedContent,
      evidence: payload.evidence,
    }, null, 2)}\n`, 'utf8')
    console.log(`Published FX report ${payload.baseDate} (${payload.generationMode}).`)
  } else {
    console.log(`Stored FX report ${payload.baseDate} for administrator review.`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
