// Node-only, bounded public originals collector. PDFs are preserved, not executed
// or automatically admitted. Reuses existing HTML reader and entity decoder.
import { createHash } from 'node:crypto'
import { readPublicText } from './public-research-adapter.js'
import { decodeEntities } from './local-source-discovery.js'

export const CHILE_MONTHLY_SOURCES = Object.freeze([
  Object.freeze({ id: 'cl-retail', path: '/actividad-mensual-del-comercio/boletines/',
    url: 'https://www.ine.gob.cl/estadisticas-por-tema/comercio-y-servicios/actividad-mensual-del-comercio' }),
  Object.freeze({ id: 'cl-pay', path: '/sueldos-y-salarios/boletines/',
    url: 'https://www.ine.gob.cl/estadisticas-por-tema/mercado-laboral/remuneraciones-y-costos-laborales' }),
])
const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_\s]+/g, ' ')
function validatePeriod(period) {
  if (typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error('explicit_month_required')
}
function sourceById(id) {
  const source = CHILE_MONTHLY_SOURCES.find(s => s.id === id)
  if (!source) throw new Error('unknown_monthly_source')
  return source
}
export function monthlyPdfUrl(raw, sourceId) {
  const source = sourceById(sourceId), url = new URL(raw, source.url)
  // INE's own index currently emits http links; never send an HTTP request.
  if (url.protocol === 'http:' && url.hostname === 'www.ine.gob.cl' && !url.port) url.protocol = 'https:'
  if (url.protocol !== 'https:' || url.hostname !== 'www.ine.gob.cl' || url.port || url.username || url.password
    || !decodeURIComponent(url.pathname).startsWith(`/docs/default-source${source.path}`)
    || !url.pathname.toLowerCase().endsWith('.pdf')
    || [...url.searchParams.keys()].some(k => k !== 'sfvrsn')
    || (url.searchParams.has('sfvrsn') && !/^[a-z0-9_]{1,80}$/i.test(url.searchParams.get('sfvrsn')))) throw new Error('monthly_url_not_allowed')
  url.hash = ''
  return url.href
}
export function discoverMonthlyPdfs(html, sourceId, period) {
  validatePeriod(period); sourceById(sourceId)
  if (typeof html !== 'string' || Buffer.byteLength(html) > 2_000_000) throw new Error('invalid_monthly_index')
  const [year, month] = period.split('-'), seen = new Set(), candidates = []
  const monthYear = new RegExp(`\\b${months[Number(month)-1]}(?: de)? ${year}\\b`)
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = monthlyPdfUrl(decodeEntities(match[2]), sourceId)
      const label = normalize(decodeEntities(match[3].replace(/<[^>]*>/g, ' ')))
      const file = normalize(decodeURIComponent(new URL(url).pathname.split('/').pop()))
      // Anchor and filename must both identify the month. No guessed file URLs.
      if (!monthYear.test(label) || !monthYear.test(file) || seen.has(url)) continue
      seen.add(url); candidates.push({ url, period, periodBasis: 'link_label_and_filename_not_body_verified', evidenceReady: false })
    } catch { /* Untrusted links do not gain access from the surrounding page. */ }
  }
  return { status: candidates.length ? 'candidates_found' : 'not_found_in_index', candidates: candidates.slice(0, 2),
    omittedCandidates: Math.max(0, candidates.length - 2), absenceProven: false }
}

// Latest in the registered public index, not proof that newer data do not exist.
export function discoverLatestMonthlyPdfs(html, sourceId, asOf) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '') || !Number.isFinite(Date.parse(asOf))
    || new Date(asOf).toISOString().slice(0,10) !== asOf) throw new Error('explicit_asof_required')
  const date = new Date(`${asOf.slice(0,7)}-01T00:00:00Z`)
  for (let i = 0; i < 12; i++) {
    const period = date.toISOString().slice(0,7), found = discoverMonthlyPdfs(html, sourceId, period)
    if (found.candidates.length) return { ...found, period, latestBasis: 'registered_index_links_only', absenceProven: false }
    date.setUTCMonth(date.getUTCMonth() - 1)
  }
  return { status: 'not_found_in_index', candidates: [], period: null, absenceProven: false }
}

export async function readMonthlyPdf(url, sourceId, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  url = monthlyPdfUrl(url, sourceId)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('invalid_timeout')
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
  let reader
  try {
    const response = await fetchImpl(url, { redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/pdf', 'User-Agent': 'LATAM-FX-local-research/2.0' } })
    if (!response.ok) return { status: 'failed', reason: `http_${response.status}` }
    if (response.redirected || (response.url && monthlyPdfUrl(response.url, sourceId) !== url)) return { status: 'failed', reason: 'redirect' }
    if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('application/pdf')) return { status: 'failed', reason: 'not_pdf' }
    if (Number(response.headers.get('content-length')) > 2_000_000) return { status: 'failed', reason: 'oversize' }
    reader = response.body?.getReader()
    if (!reader) return { status: 'failed', reason: 'empty_body' }
    const chunks = []; let size = 0
    while (true) {
      const part = await reader.read(); if (part.done) break
      size += part.value.byteLength
      if (size > 2_000_000) return { status: 'failed', reason: 'oversize' }
      chunks.push(Buffer.from(part.value))
    }
    const raw = Buffer.concat(chunks)
    if (!raw.subarray(0, 5).equals(Buffer.from('%PDF-')) || !raw.subarray(-2048).includes(Buffer.from('%%EOF')))
      return { status: 'failed', reason: 'invalid_or_truncated_pdf' }
    return { status: 'collected_pending_review', raw, bytes: raw.length, sha256: digest(raw), collectedAt: new Date().toISOString(),
      publishedAt: null, periodVerified: false, sourceVersion: 'current_file_not_archived', evidenceReady: false, publicationApproved: false }
  } catch { return { status: 'failed', reason: controller.signal.aborted ? 'timeout' : 'transport_or_redirect_error' } }
  finally { clearTimeout(timer); controller.abort(); if (reader) await reader.cancel().catch(() => {}) }
}

export async function collectChileMonthlyOriginals({ period, asOf, fetchImpl = fetch, pdfTimeoutMs = 15000 }) {
  if(!Number.isInteger(pdfTimeoutMs)||pdfTimeoutMs<1||pdfTimeoutMs>30000) throw new Error('invalid_timeout')
  if (period !== 'latest') validatePeriod(period)
  else discoverLatestMonthlyPdfs('', 'cl-retail', asOf) // validate before any request
  const results = []; let networkCalls = 0
  for (const source of CHILE_MONTHLY_SOURCES) {
    networkCalls++
    const index = await readPublicText(source.url, { fetchImpl })
    if (index.status !== 'ok') { results.push({ sourceId: source.id, indexUrl: source.url, status: 'index_failed', reason: index.reason }); continue }
    const discovery = period === 'latest' ? discoverLatestMonthlyPdfs(index.text,source.id,asOf)
      : discoverMonthlyPdfs(index.text, source.id, period), originals = []
    for (const candidate of discovery.candidates) {
      networkCalls++
      originals.push({ ...candidate, ...await readMonthlyPdf(candidate.url, source.id, { fetchImpl,timeoutMs:pdfTimeoutMs }) })
    }
    results.push({ sourceId: source.id, indexUrl: source.url, indexRaw: index.text, indexHash: digest(index.text), indexCollectedAt: index.fetchedAt,
      ...discovery, originals, status: !originals.length ? discovery.status : originals.every(o => o.status === 'collected_pending_review') ? 'collected_pending_review' : 'partial_or_failed' })
  }
  return { version: 'chile-monthly-originals/1', period, collectedAt: new Date().toISOString(), results,
    limits: { maxRequests: 6, maxBytesPerRequest: 2_000_000, timeoutMsPerRequest: 15000, pdfTimeoutMs, retries: 0 },
    networkCalls, modelCalls: 0, costUsd: 0, evidenceReady: false, publicationApproved: false }
}
