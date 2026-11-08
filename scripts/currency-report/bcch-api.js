// Node-only BCCh source adapter. No env reads, persistence, AI or retries.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parse } from 'dotenv'
import { validDate } from './core.js'
import { BCCH_METHOD, CLP_PRICE_VERSION, mapBcchSessionDates, chileClockUtc } from './clp-official-price.js'
import { marketCalendarDate } from './public-research-adapter.js'

export const BCCH_API_DOC_URL = 'https://si3.bcentral.cl/estadisticas/Principal1/Web_Services/documentacion.html'
const timestamp = v => typeof v === 'string' && validDate(v.slice(0,10))
  && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))

export function parseBcchTokenFile(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 10_000) throw new Error('invalid_token_file')
  const settings = parse(raw), token = settings.BCCH_API_TOKEN?.trim()
  if (Object.keys(settings).some(key => key !== 'BCCH_API_TOKEN')) throw new Error('unexpected_config_field')
  if (!token) throw new Error('token_missing')
  if (token.length > 4096 || /\s|[\u0000-\u001f\u007f]/u.test(token)) throw new Error('invalid_token_format')
  return token
}

export function validateProbeRange(firstDate, lastDate) {
  if (!validDate(firstDate) || !validDate(lastDate) || firstDate > lastDate
    || (Date.parse(lastDate) - Date.parse(firstDate)) / 86400000 > 31) throw new Error('invalid_probe_range')
}

export function projectBcchApiResponse(raw, { firstDate, lastDate, token, capturedAt }) {
  validateProbeRange(firstDate,lastDate)
  if (!timestamp(capturedAt)) throw new Error('invalid_api_capture_time')
  if (!Buffer.isBuffer(raw) || raw.length > 2_000_000 || !token) throw new Error('invalid_api_body')
  // Never save an arbitrary response or an error description. Detect direct or
  // URL-encoded credential echoes even though only numeric fields are projected.
  const text = raw.toString('utf8')
  if (text.includes(token) || text.includes(encodeURIComponent(token))) throw new Error('credential_echo_in_response')
  let response
  try {response=JSON.parse(text.replace(/^\uFEFF/,''))} catch {throw new Error('invalid_api_json')}
  if (response.Codigo !== 0) throw new Error('api_rejected_request')
  const series=response.Series
  if (!series || series.seriesId !== BCCH_METHOD.seriesId || !Array.isArray(series.Obs) || series.Obs.length > 32)
    throw new Error('unexpected_api_series')
  const values=[],missing=[],seen=new Set()
  for (const row of series.Obs) {
    const match=/^(\d{2})-(\d{2})-(\d{4})$/.exec(row?.indexDateString ?? '')
    const day=match?`${match[3]}-${match[2]}-${match[1]}`:null
    if (!validDate(day) || day < firstDate || day > lastDate || seen.has(day)) throw new Error('invalid_api_observation_date')
    seen.add(day)
    if (row.statusCode === 'ND') {missing.push(day);continue}
    if (row.statusCode !== 'OK' || !/^\d+(?:\.\d+)?$/.test(String(row.value))
      || !Number.isFinite(Number(row.value)) || Number(row.value) <= 0 || [0,6].includes(new Date(day).getUTCDay()))
      throw new Error('invalid_api_observation_value')
    values.push({effectiveDate:day,value:Number(row.value)})
  }
  values.sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate))
  if (!values.length) throw new Error('api_no_observations')
  const observations=mapBcchSessionDates(values).map(row=>({...row,
    observationWindowEndAt:row.localSessionDate?chileClockUtc(row.localSessionDate,'16:00'):null,
    scheduledWebAvailabilityAt:row.localSessionDate?chileClockUtc(row.localSessionDate,'17:30'):null,
    observedAt:null,publishedAt:null}))
  return {version:'bcch-api-probe/1',authentication:'accepted',dataStatus:'valid_projected_observations',
    provider:BCCH_METHOD.provider,seriesId:BCCH_METHOD.seriesId,unit:'CLP per USD',priceKind:'official_transaction_weighted_average',
    firstDate,lastDate,capturedAt,observations,missingDates:missing.sort(),
    rawResponseSha256:createHash('sha256').update(raw).digest('hex'),
    request:{endpoint:'https://si3.bcentral.cl/SieteRestWS/SieteRestWS.ashx',function:'GetSeries',credentialOmitted:true},
    networkRequests:1,modelCalls:0,newApiCostUsd:0,publicationApproved:false}
}

export function requestBcchOnce({token,firstDate,lastDate,powershell}) {
  if (!/pwsh\.exe$/i.test(powershell ?? '')) throw new Error('explicit_pwsh_required')
  return new Promise((resolve,reject)=>{
    const child=spawn(powershell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./read-bcch-api.ps1',import.meta.url))],
      {windowsHide:true,stdio:['pipe','pipe','pipe']})
    const chunks=[];let size=0,settled=false
    const finish=(error,body)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(new Error(error)):resolve(body)}
    const timer=setTimeout(()=>{child.kill();finish('api_transport_timeout')},25000)
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>3_000_000){child.kill();finish('api_response_oversize')}else chunks.push(chunk)})
    child.stderr.on('data',()=>{}) // Never forward a native credential-bearing error.
    child.on('error',()=>finish('api_transport_failed'))
    child.stdin.on('error',()=>finish('api_transport_failed'))
    child.on('close',code=>{
      if(code!==0){finish('api_transport_failed');return}
      try {
        const response=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''))
        if(response.error || response.status!==200){finish('api_transport_failed');return}
        finish(null,Buffer.from(response.bodyBase64,'base64'))
      } catch {finish('api_transport_failed')}
    })
    child.stdin.end(JSON.stringify({token,firstDate,lastDate}))
  })
}

// Native HTTP failures can contain credential-bearing URLs. Forward only a
// stable error code; this collector performs one attempt and never falls back.
export async function collectBcchApi({ token, firstDate, lastDate, powershell, transport = requestBcchOnce,
  now = () => new Date().toISOString() }) {
  validateProbeRange(firstDate,lastDate)
  if (typeof token !== 'string' || !token || token.length > 4096 || /\s|[\u0000-\u001f\u007f]/u.test(token))
    throw new Error('invalid_token_format')
  let raw
  try { raw = await transport({token,firstDate,lastDate,powershell}) }
  catch { throw new Error('api_transport_failed') }
  return projectBcchApiResponse(raw,{token,firstDate,lastDate,capturedAt:now()})
}

// Recompute session mapping from numeric effective dates, never trust a saved
// localSessionDate or treat a caller-edited snapshot as a bank-signed archive.
export function bcchApiResearchSeries(snapshot, { methodologySha256, asOf, throughSessionDate } = {}) {
  if (methodologySha256 !== BCCH_METHOD.sha256) throw new Error('bcch_methodology_changed')
  if (snapshot?.version !== 'bcch-api-probe/1' || snapshot.authentication !== 'accepted'
    || snapshot.dataStatus !== 'valid_projected_observations' || snapshot.provider !== BCCH_METHOD.provider
    || snapshot.seriesId !== BCCH_METHOD.seriesId || snapshot.unit !== 'CLP per USD'
    || snapshot.priceKind !== 'official_transaction_weighted_average'
    || !timestamp(snapshot.capturedAt) || !timestamp(asOf) || Date.parse(asOf) < Date.parse(snapshot.capturedAt)
    || !/^[a-f0-9]{64}$/.test(snapshot.rawResponseSha256 ?? '')
    || !Array.isArray(snapshot.observations) || !snapshot.observations.length || snapshot.observations.length > 32
    || !Array.isArray(snapshot.missingDates)) throw new Error('invalid_api_research_snapshot')
  validateProbeRange(snapshot.firstDate,snapshot.lastDate)
  const seen=new Set(), values=snapshot.observations.map(row=>{
    if (!validDate(row?.effectiveDate) || row.effectiveDate < snapshot.firstDate || row.effectiveDate > snapshot.lastDate
      || seen.has(row.effectiveDate) || [0,6].includes(new Date(row.effectiveDate).getUTCDay())
      || typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value <= 0)
      throw new Error('invalid_api_research_observation')
    seen.add(row.effectiveDate)
    return {effectiveDate:row.effectiveDate,value:row.value}
  }).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate))
  for (const day of snapshot.missingDates) {
    if (!validDate(day) || day < snapshot.firstDate || day > snapshot.lastDate || seen.has(day))
      throw new Error('invalid_api_missing_date')
    seen.add(day)
  }
  const observations=mapBcchSessionDates(values).map(row=>{
    const cutoff=row.localSessionDate?chileClockUtc(row.localSessionDate,'16:00'):null
    const scheduled=row.localSessionDate?chileClockUtc(row.localSessionDate,'17:30'):null
    if ((scheduled && Date.parse(scheduled)>Date.parse(snapshot.capturedAt))
      || (!row.localSessionDate && row.effectiveDate>marketCalendarDate(snapshot.capturedAt,'CLP')))
      throw new Error('bcch_price_ahead_of_schedule')
    return {...row,currency:'CLP',unit:'LOCAL_PER_USD',provider:BCCH_METHOD.provider,seriesId:BCCH_METHOD.seriesId,
      priceKind:'official_transaction_weighted_average',quoteSide:'not_applicable',timeZone:'America/Santiago',
      observationWindow:{startAt:null,endAt:cutoff},observedAt:null,publishedAt:null,
      scheduledWebAvailabilityAt:scheduled,firstSeenAt:snapshot.capturedAt,url:BCCH_API_DOC_URL,
      rawSha256:snapshot.rawResponseSha256,methodologyVersion:BCCH_METHOD.version,methodologySha256:BCCH_METHOD.sha256}
  })
  // An unmapped latest row must not silently select an older observation.
  const latest=observations.at(-1)
  const selected=throughSessionDate ?? latest.localSessionDate
  if (!selected || !validDate(selected)) throw new Error('latest_session_calendar_unverified')
  if (!observations.some(o=>o.localSessionDate===selected)) throw new Error('requested_session_price_missing')
  return {series:{version:CLP_PRICE_VERSION,currency:'CLP',sourceAdapter:'bcch-bde-api/1',
    url:BCCH_API_DOC_URL,capturedAt:snapshot.capturedAt,rawSha256:snapshot.rawResponseSha256,
    priceRowsSha256:createHash('sha256').update(JSON.stringify(values)).digest('hex'),methodology:BCCH_METHOD,
    observations,blankDates:[...snapshot.missingDates],calendarUnverified:observations.filter(o=>!o.localSessionDate).map(o=>o.effectiveDate),
    status:'collected_local_review_only',publicReuseApproved:false,publicationApproved:false},throughSessionDate:selected}
}
