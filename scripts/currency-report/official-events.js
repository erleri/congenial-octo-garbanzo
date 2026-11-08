// Fixed public discovery endpoints; captures are not approved explanation evidence.
import { createHash } from 'node:crypto'
export const OFFICIAL_EVENT_SOURCES = Object.freeze([
  { id: 'ibge-calendar', country: 'BRL', format: 'calendar', url: 'https://servicodados.ibge.gov.br/api/v3/calendario/?qtd=30', reuse: 'unverified' },
  { id: 'ibge-news', country: 'BRL', format: 'news', url: 'https://servicodados.ibge.gov.br/api/v3/noticias/?qtd=20', reuse: 'unverified' },
  { id: 'fed-policy', country: 'GLOBAL', format: 'rss', url: 'https://www.federalreserve.gov/feeds/press_monetary.xml', reuse: 'verify_item_exceptions' },
  { id: 'bls-calendar', country: 'GLOBAL', format: 'ics', url: 'https://www.bls.gov/schedule/news_release/bls.ics', reuse: 'verify_item_exceptions' },
  { id: 'chile-policy', country: 'CLP', format: 'manual', url: 'https://www.bcentral.cl/es/web/banco-central/noticias-y-publicaciones/prensa/calendario-de-politica-monetaria-y-financiera', reuse: 'unverified' },
  { id: 'chile-statistics', country: 'CLP', format: 'manual', url: 'https://www.ine.gob.cl/inicio/agendaestadistica', reuse: 'license_review_required' },
  { id: 'banxico-policy', country: 'MXN', format: 'manual', url: 'https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/anuncios-politica-monetaria-t.html', reuse: 'attribution_required' },
  { id: 'inegi-statistics', country: 'MXN', format: 'manual', url: 'https://www.inegi.org.mx/', reuse: 'attribution_and_metadata_required' },
])
const digest = value => createHash('sha256').update(value).digest('hex')
const clean = value => String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 400)
const classify = title => /Copom|FOMC|monetary|política monetaria/i.test(title) ? 'policy' : /IPCA|INPC|IPC|Preços ao Consumidor|Consumer Price|CPI/i.test(title) ? 'inflation' : /retail|varejista|comércio|commerce/i.test(title) ? 'consumption' : /Employment Situation|emprego|employment/i.test(title) ? 'employment' : null
function publicUrl(value) {
  try { const u = new URL(value); if (u.protocol === 'http:' && u.hostname === 'agenciadenoticias.ibge.gov.br') u.protocol = 'https:'; const domains = ['ibge.gov.br','bcb.gov.br','federalreserve.gov','bls.gov','bcentral.cl','ine.gob.cl','banxico.org.mx','inegi.org.mx']; return u.protocol === 'https:' && domains.some(d => u.hostname === d || u.hostname.endsWith('.'+d)) && !u.username && !u.password && !/token|key|password/i.test(u.search) ? u.href : null } catch { return null }
}
const dateOnly = value => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value ?? '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}
export function normalizeOfficialEvents(source, body, asOf = null) {
  if (asOf !== null && !Number.isFinite(Date.parse(asOf))) throw new Error('invalid_capture_asof')
  if (typeof body !== 'string' || Buffer.byteLength(body) > 2_000_000 || /<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error('invalid_official_body')
  const candidates = []
  if (['calendar', 'news'].includes(source.format)) {
    const payload = JSON.parse(body)
    if (!Array.isArray(payload.items)) throw new Error('official_schema_changed')
    for (const item of payload.items.slice(0, 60)) {
      const title = clean(item.titulo), kind = classify(title), url = publicUrl(item.link) ?? (source.format === 'calendar' ? source.url : null)
      if (!kind || !url) continue
      candidates.push({ externalId: String(item.id), title, kind, url,
        state: source.format === 'calendar' ? 'scheduled' : 'original_pending',
        plannedDate: dateOnly(item.data_divulgacao), publishedDate: dateOnly(item.data_publicacao),
        sourceTime: clean(item.data_divulgacao ?? item.data_publicacao), timezone: null,
        period: clean(item.periodo_referencia ?? (item.ano_referencia_inicio ? `${item.ano_referencia_inicio}-${String(item.mes_referencia_inicio).padStart(2, '0')} / ${item.ano_referencia_fim}-${String(item.mes_referencia_fim).padStart(2, '0')}` : '')), publishedAt: null,
        originalUrlMissing: !item.link })
    }
  } else if (source.format === 'rss') {
    if (!/<rss\b/i.test(body)) throw new Error('official_schema_changed')
    const tag = (item, name) => new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(item)?.[1] ?? ''
    for (const item of body.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []) {
      const title = clean(tag(item, 'title')), url = publicUrl(clean(tag(item, 'link')))
      if (!url) continue
      const time = clean(tag(item, 'pubDate') || tag(item, 'dc:date'))
      candidates.push({ externalId: digest(url).slice(0, 20), title, kind: 'policy', url, state: 'original_pending',
        publishedAt: Number.isFinite(Date.parse(time)) ? new Date(time).toISOString() : null, period: null, sourceTime: time, timezone: null })
    }
  } else if (source.format === 'ics') {
    if (!body.includes('BEGIN:VCALENDAR')) throw new Error('official_schema_changed')
    const unfolded = body.replace(/\r?\n[ \t]/g, '')
    for (const item of unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? []) {
      const title = clean(/^SUMMARY:(.*)$/m.exec(item)?.[1]), kind = classify(title)
      if (!kind || !/Consumer Price Index|Employment Situation/i.test(title)) continue
      const start = /^DTSTART(?:;TZID=([^:\r\n]+))?:(\d{8}(?:T\d{6}Z?)?)\r?$/m.exec(item)
      candidates.push({ externalId: clean(/^UID:(.*)$/m.exec(item)?.[1]) || digest(item).slice(0, 20), title, kind,
        url: publicUrl(clean(/^URL:(.*)$/m.exec(item)?.[1])) ?? source.url, state: 'scheduled',
        plannedDate: start ? `${start[2].slice(0, 4)}-${start[2].slice(4, 6)}-${start[2].slice(6, 8)}` : null,
        sourceTime: start?.[2] ?? null, timezone: start?.[1] ?? (start?.[2].endsWith('Z') ? 'UTC' : null), publishedAt: null, period: null })
    }
  } else throw new Error('manual_source_required')
  const day = asOf?.slice(0, 10), now = day ? Date.parse(day) : null
  const relevant = candidates.filter(c => {
    if (now === null) return true
    const date = c.plannedDate ?? c.publishedDate ?? c.publishedAt?.slice(0, 10)
    if (!date) return true
    const delta = (Date.parse(date) - now) / 86400000
    return c.state === 'scheduled' ? delta >= -7 && delta <= 45 : delta >= -30 && delta <= 0
  }).sort((a, b) => String(a.plannedDate ?? a.publishedDate ?? a.publishedAt ?? '').localeCompare(String(b.plannedDate ?? b.publishedDate ?? b.publishedAt ?? '')))
  return { bodyHash: digest(body), coverage: relevant.length ? 'partial_discovery' : 'no_core_items_in_window', candidates: relevant.slice(0, 60).map(c => ({ ...c, source: source.id, country: source.country,
    originalVerified: false, reuse: source.reuse, evidenceReady: false })) }
}

export function projectOfficialCalendar(capture, asOf) {
  const entries = [], sources = []
  for (const result of capture.results ?? []) {
    const source = OFFICIAL_EVENT_SOURCES.find(s => s.id === result.source)
    if (!source) throw new Error('unknown_capture_source')
    const normalized = result.body ? normalizeOfficialEvents(source, result.body, asOf) : { candidates: [], coverage: result.status }
    if (result.body && normalized.bodyHash !== result.bodyHash) throw new Error('captured_original_changed')
    sources.push({ id: source.id, country: source.country, status: result.status, coverage: normalized.coverage, url: source.url })
    for (const candidate of normalized.candidates) {
      if (/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|ignore previous|system prompt/i.test(candidate.title)) continue
      entries.push({ title: candidate.title, country: candidate.country, kind: candidate.kind, state: candidate.state,
        plannedDate: candidate.plannedDate ?? null, publishedAt: candidate.publishedAt, publishedDate: candidate.publishedDate ?? null,
        sourceTime: candidate.sourceTime, timezone: candidate.timezone, period: candidate.period, url: candidate.url, source: source.id, evidenceReady: false })
    }
  }
  return { version: 'official-calendar/1', checkedAt: asOf, entries, sources, publicationApproved: false }
}

export function discoveryDecisionEvents(capture, asOf) {
  return projectOfficialCalendar(capture, asOf).entries.map(item => ({
    id: `official-${digest(JSON.stringify([item.source, item.title, item.plannedDate ?? item.publishedDate ?? item.publishedAt])).slice(0, 24)}`,
    country: item.country, kind: item.kind, period: item.period ?? '', revision: 'discovery',
    state: item.state, publishedAt: item.publishedAt, publishedDate: item.publishedDate,
    sourceUrl: item.url, summary: item.title,
  }))
}

export async function collectOfficialEvents({ countries = ['BRL', 'GLOBAL', 'CLP', 'MXN'], asOf = new Date().toISOString(), fetchImpl = fetch }) {
  if (!Array.isArray(countries) || countries.some(c => !['BRL', 'CLP', 'MXN', 'GLOBAL'].includes(c))) throw new Error('invalid_source_countries')
  const results = []
  for (const source of OFFICIAL_EVENT_SOURCES.filter(s => countries.includes(s.country))) {
    if (source.format === 'manual') { results.push({ source: source.id, country: source.country, url: source.url, status: 'manual_required', reason: 'official_original_and_terms_review_required', candidates: [] }); continue }
    try {
      const response = await fetchImpl(source.url, { redirect: 'error', signal: AbortSignal.timeout(20_000) })
      if (!response.ok) { results.push({ source: source.id, country: source.country, status: 'failed', reason: `http_${response.status}`, candidates: [] }); continue }
      if (Number(response.headers.get('content-length')) > 2_000_000) throw new Error('official_body_oversize')
      // Bound the body during transfer too; Content-Length can be absent.
      const reader = response.body?.getReader(), chunks = []; let size = 0
      if (!reader) throw new Error('empty_response')
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2_000_000) { await reader.cancel(); throw new Error('official_body_oversize') } chunks.push(Buffer.from(part.value)) }
      const body = Buffer.concat(chunks).toString('utf8'), normalized = normalizeOfficialEvents(source, body, asOf)
      results.push({ source: source.id, country: source.country, url: source.url, status: 'collected_pending_review', collectedAt: new Date().toISOString(), body, ...normalized })
    } catch { results.push({ source: source.id, country: source.country, status: 'failed', reason: 'access_format_or_size_failure', candidates: [] }) }
  }
  return { version: 'official-events/1', results, modelCalls: 0, costUsd: 0, publicationApproved: false }
}

export function importManualOriginal({ sourceId, documentUrl, title, period, publishedAt, original, collectedAt }) {
  const source = OFFICIAL_EVENT_SOURCES.find(s => s.id === sourceId)
  if (!source || typeof original !== 'string' || !original.trim() || Buffer.byteLength(original) > 2_000_000 || /sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|ignore previous|system prompt/i.test(original)) throw new Error('invalid_manual_original')
  const url = publicUrl(documentUrl), publisher = sourceId.startsWith('ibge') ? 'ibge.gov.br' : sourceId.startsWith('fed') ? 'federalreserve.gov' : sourceId.startsWith('bls') ? 'bls.gov' : sourceId === 'chile-policy' ? 'bcentral.cl' : sourceId === 'chile-statistics' ? 'ine.gob.cl' : sourceId.startsWith('banxico') ? 'banxico.org.mx' : 'inegi.org.mx'
  if (!url || !(new URL(url).hostname === publisher || new URL(url).hostname.endsWith('.' + publisher))) throw new Error('matching_original_document_url_required')
  return { source: source.id, country: source.country, url, discoveryUrl: source.url, title: clean(title), period: clean(period),
    publishedAt: typeof publishedAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(publishedAt) && Number.isFinite(Date.parse(publishedAt)) ? publishedAt : null,
    collectedAt, original, bodyHash: digest(original), collectionMode: 'manual', originalVerified: false, reuse: source.reuse, evidenceReady: false }
}
