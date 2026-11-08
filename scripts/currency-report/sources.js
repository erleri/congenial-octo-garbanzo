import { validDate } from './core.js'

// Reviewed official endpoints, not arbitrary URLs supplied by a model.
export const SOURCE_CATALOG = [
  { id: 'bcb-selic', country: 'BRL', publisher: 'Banco Central do Brasil', url: 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/10?formato=json', cadence: 'daily', kind: 'policy_rate', documentation: 'https://dadosabertos.bcb.gov.br/', access: 'public' },
  { id: 'ibge-retail-meta', country: 'BRL', publisher: 'IBGE', url: 'https://servicodados.ibge.gov.br/api/v3/agregados/8880/metadados', cadence: 'monthly', kind: 'metadata', documentation: 'https://servicodados.ibge.gov.br/api/docs/agregados?versao=3', access: 'public' },
  { id: 'ibge-retail-volume', country: 'BRL', publisher: 'IBGE', url: 'https://servicodados.ibge.gov.br/api/v3/agregados/8880/periodos/-3/variaveis/11708?localidades=N1[all]&classificacao=11046[56734]', cadence: 'monthly', kind: 'retail_total', documentation: 'https://servicodados.ibge.gov.br/api/docs/agregados?versao=3', access: 'public' },
  { id: 'banxico-rate', country: 'MXN', publisher: 'Banco de México', cadence: 'daily', kind: 'policy_rate', documentation: 'https://www.banxico.org.mx/SieAPIRest/service/v1/', access: 'token_required' },
  { id: 'inegi-retail', country: 'MXN', publisher: 'INEGI', cadence: 'monthly', kind: 'retail', documentation: 'https://www.inegi.org.mx/servicios/api_indicadores.html', access: 'token_and_series_selection_required' },
]

export function normalizeSnapshot(source, payload, asOf) {
  if (!validDate(asOf)) throw new Error('invalid_date')
  if (source.id === 'bcb-selic') {
    if (!Array.isArray(payload)) throw new Error('source_schema_changed')
    const observations = payload.map(r => {
      const date = typeof r.data === 'string' ? r.data.split('/').reverse().join('-') : ''
      return { date, value: Number(r.valor) }
    }).filter(r => validDate(r.date) && r.date <= asOf && Number.isFinite(r.value))
    return { observations, unit: 'percent_per_year', publishedAt: null, evidenceReady: false, limitation: 'SGS 적용일은 발표시각이 아닙니다. 정책 발표와 별도 연결해야 합니다.' }
  }
  if (source.id === 'ibge-retail-meta') {
    if (payload?.id !== 8880 || !Array.isArray(payload.variaveis)) throw new Error('source_schema_changed')
    return { title: payload.nome, periodicity: payload.periodicidade, variables: payload.variaveis.map(v => ({ id: v.id, title: v.nome, unit: v.unidade })), publishedAt: null, evidenceReady: false }
  }
  if (source.id === 'ibge-retail-volume') {
    if (!Array.isArray(payload) || payload[0]?.id !== '11708') throw new Error('source_schema_changed')
    const rows = payload[0].resultados?.flatMap(r => r.series ?? []) ?? []
    const observations = rows.filter(r => r.localidade?.id === '1').flatMap(r => Object.entries(r.serie).filter(([period]) => /^\d{6}$/.test(period) && period <= asOf.replaceAll('-', '').slice(0, 6)).map(([period, value]) => ({ period, value: /^-?\d+(\.\d+)?$/.test(String(value)) ? Number(value) : null })))
    return { observations, unit: 'percent_month_over_month_seasonally_adjusted', publishedAt: null, evidenceReady: false, limitation: '전국 소매 전체이며 가전·TV 셀아웃이 아닙니다. 발표일과 당시 버전 확인 전 과거 원인 설명에 사용하지 않습니다.' }
  }
  throw new Error('unsupported_source')
}

export async function collectSources({ currency, asOf, fetchImpl = fetch }) {
  if (!['BRL', 'MXN'].includes(currency) || !validDate(asOf)) throw new Error('invalid_currency_or_date')
  const results = []
  for (const source of SOURCE_CATALOG.filter(s => s.country === currency)) {
    if (source.access !== 'public') { results.push({ source: source.id, status: 'not_collected', reason: source.access }); continue }
    try {
      const response = await fetchImpl(source.url, { signal: AbortSignal.timeout(20_000), redirect: 'error', headers: { Accept: 'application/json' } })
      if (!response.ok) { results.push({ source: source.id, status: 'failed', reason: `http_${response.status}` }); continue }
      const body = await response.text()
      if (body.length > 1_000_000) throw new Error('oversize')
      const normalized = normalizeSnapshot(source, JSON.parse(body), asOf)
      results.push({ source: source.id, status: 'collected_for_review', url: source.url, collectedAt: new Date().toISOString(), asOf, ...normalized })
    } catch { results.push({ source: source.id, status: 'failed', reason: 'access_or_schema_failure' }) }
  }
  return results
}
