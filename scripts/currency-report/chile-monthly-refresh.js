// Pure comparison and injectable extraction. Changes never re-authorize old
// evidence; failures preserve prior captures and cannot be called "unchanged".
import { createHash } from 'node:crypto'
import { validateMonthlyExtraction } from './chile-monthly-evidence.js'
const hash = value => createHash('sha256').update(value).digest('hex')

export function classifyMonthlyVersion(current, previous = []) {
  if (current.status !== 'collected_pending_review' || !/^[a-f0-9]{64}$/.test(current.sha256 ?? ''))
    return {status:'current_unavailable',priorRetained:previous.length > 0,reviewReusable:false}
  const samePeriod = previous.filter(p => p.period === current.period && p.sha256)
  const identical = samePeriod.find(p => p.sha256 === current.sha256)
  if (identical) return {status:'unchanged_bytes',previousSha256:identical.sha256,urlChanged:identical.url !== current.url,reviewReusable:false}
  return {status:samePeriod.length ? 'changed_bytes_review_required' : previous.length ? 'new_period_review_required' : 'first_capture_review_required',
    previousHashes:samePeriod.map(p => p.sha256),reviewReusable:false}
}

export async function inspectMonthlyPdf({original, raw, extract}) {
  if (original.status !== 'collected_pending_review') return {status:'not_extracted',reason:'capture_unavailable'}
  if (!Buffer.isBuffer(raw) || hash(raw) !== original.sha256 || raw.length !== original.bytes)
    return {status:'extraction_failed',reason:'stored_bytes_mismatch'}
  try {
    const extraction = await extract()
    const identity = validateMonthlyExtraction(original,extraction)
    if (!extraction.pages.some(p => p.text.trim().length >= 40))
      return {status:'extraction_failed',reason:'no_usable_text',extractor:extraction.extractor}
    return {status:'extracted_pending_review',...identity,extractor:extraction.extractor,
      textHash:hash(extraction.pages.map(p => p.text.replace(/\s+/gu,' ').trim()).join('\n')),extraction}
  } catch(e) {
    return {status:'extraction_failed',reason:e?.code === 'ETIMEDOUT' || e?.killed ? 'extractor_timeout' : 'extractor_or_schema_failure'}
  }
}

export function compareMonthlyText(current, previous) {
  if (current.status !== 'extracted_pending_review' || previous?.status !== 'extracted_pending_review')
    return {status:'text_comparison_unverified'}
  if (current.extractor !== previous.extractor) return {status:'extractor_version_mismatch'}
  return {status:current.textHash === previous.textHash ? 'same_extracted_text' : 'changed_text_review_required'}
}
