import { supabase } from './supabaseClient'
import type { FxReportRun, PublishedFxReport } from '../types/fxReport'

const CACHE_KEY = 'latamfx:published-reports:v2'

interface PublishedRow {
  base_date: string
  run_id: string
  schema_version: string
  generation_mode: PublishedFxReport['generationMode']
  confidence: PublishedFxReport['confidence']
  content: PublishedFxReport['content']
  evidence: PublishedFxReport['evidence']
  published_at: string
}

interface RunRow {
  id: string
  base_date: string
  attempt: number
  schema_version: string
  generation_mode: FxReportRun['generationMode']
  publish_mode: FxReportRun['publishMode']
  status: FxReportRun['status']
  evidence: FxReportRun['evidence']
  deterministic_content: FxReportRun['deterministicContent']
  ai_candidate: FxReportRun['aiCandidate']
  selected_content: FxReportRun['selectedContent']
  ai_provider: string | null
  ai_model: string | null
  validation: FxReportRun['validation']
  error_message: string | null
  created_at: string
  published_at: string | null
}

function mapPublished(row: PublishedRow): PublishedFxReport {
  return {
    baseDate: row.base_date, runId: row.run_id, schemaVersion: row.schema_version,
    generationMode: row.generation_mode, confidence: row.confidence,
    content: row.content, evidence: row.evidence, publishedAt: row.published_at,
  }
}

function mapRun(row: RunRow): FxReportRun {
  return {
    id: row.id, baseDate: row.base_date, attempt: row.attempt, schemaVersion: row.schema_version,
    generationMode: row.generation_mode, publishMode: row.publish_mode, status: row.status,
    evidence: row.evidence, deterministicContent: row.deterministic_content,
    aiCandidate: row.ai_candidate, selectedContent: row.selected_content,
    aiProvider: row.ai_provider, aiModel: row.ai_model, validation: row.validation,
    errorMessage: row.error_message, createdAt: row.created_at, publishedAt: row.published_at,
  }
}

function readCache(): PublishedFxReport[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function loadPublishedFxReports(limit = 30): Promise<{ reports: PublishedFxReport[]; cached: boolean }> {
  if (!supabase) return { reports: readCache().slice(0, limit), cached: true }
  const { data, error } = await supabase
    .from('fx_reports')
    .select('base_date, run_id, schema_version, generation_mode, confidence, content, evidence, published_at')
    .order('base_date', { ascending: false })
    .limit(limit)
  if (error) {
    const cached = readCache().slice(0, limit)
    if (cached.length) return { reports: cached, cached: true }
    if (['42P01', 'PGRST205'].includes(error.code ?? '')) return { reports: [], cached: false }
    throw error
  }
  const reports = (data as PublishedRow[] ?? []).map(mapPublished)
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(reports)) } catch { /* Cache is optional. */ }
  return { reports, cached: false }
}

export async function loadFxReportRuns(limit = 20): Promise<FxReportRun[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('fx_report_runs')
    .select('id, base_date, attempt, schema_version, generation_mode, publish_mode, status, evidence, deterministic_content, ai_candidate, selected_content, ai_provider, ai_model, validation, error_message, created_at, published_at')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    if (['42P01', 'PGRST205'].includes(error.code ?? '')) return []
    throw error
  }
  return (data as RunRow[] ?? []).map(mapRun)
}

export async function reviewFxReport(runId: string, decision: 'approved' | 'rejected', reason = ''): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.rpc('review_fx_report', {
    p_run_id: runId, p_decision: decision, p_reason: reason || null,
  })
  if (error) throw error
}
