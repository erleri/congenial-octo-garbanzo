import fs from 'node:fs/promises'
import path from 'node:path'
import { fixtures } from './fixtures.js'
import {writeDataBundle,readDataBundle,ledgerRoot,dataHash} from './data-ledger.js'
import {assertOfficialPublicSummary} from './official-publication.js'

export const root = path.resolve('.local-reports')
export const publicDir = path.join(root, 'reviewable')
export const privateDir = path.join(root, 'private')
export const reviewDir = path.join(root, 'review')
export async function readDataset() { return JSON.parse(await fs.readFile('data/fx-full-history.json', 'utf8')) }
function fixtureObservation(dataset, currency, baseDate) {
  const unique = new Map()
  for (const row of dataset.dailyRates ?? []) {
    if (row.currency !== currency || row.rateType !== 'LOCAL_PER_USD' || row.date > baseDate) continue
    const weekday = new Date(`${row.date}T00:00:00Z`).getUTCDay()
    if (!weekday || weekday === 6 || row.source === 'IMPUTED' || (row.imputationMethod && row.imputationMethod !== 'NONE')) continue
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value <= 0) continue
    unique.set(row.date, { date: row.date, value: row.value })
  }
  const rows = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date))
  const last = rows.at(-1)
  if (!last || rows.length < 6) throw new Error('insufficient_fixture_observations')
  const previousMonth = rows.filter(row => row.date.slice(0, 7) < last.date.slice(0, 7)).at(-1)
  const yearFrom = new Date(`${last.date}T00:00:00Z`)
  yearFrom.setUTCDate(yearFrom.getUTCDate() - 364)
  const percent = (value, reference) => ((value - reference) / reference) * 100
  const pct = value => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
  const facts = [
    { id: 'spot', value: last.value, label: `1 USD = ${last.value.toLocaleString('en-US', { maximumFractionDigits: 4 })} ${currency}` },
    { id: 'day', value: percent(last.value, rows.at(-2).value), label: '' },
    { id: 'five', value: percent(last.value, rows.at(-6).value), label: '' },
    ...(previousMonth ? [{ id: 'mtd', value: percent(last.value, previousMonth.value), label: '' }] : []),
  ].map(fact => fact.id === 'spot' ? fact : ({ ...fact, label: `${{ day: '전 관측일 대비', five: '5관측일 대비', mtd: '전월 마지막 관측일 대비' }[fact.id]} ${pct(fact.value)}` }))
  return {
    currency, baseDate, observedDate: last.date, facts,
    series: rows.filter(row => row.date >= yearFrom.toISOString().slice(0, 10)),
    limitations: ['주말·보간값을 제외한 관측일 기준입니다. 국가별 휴일의 API 이월값은 완전히 식별되지 않을 수 있습니다.', '환율은 저장소의 현재 역사 자료로 재구성했습니다. 당시 데이터 버전까지 보장하는 백테스트가 아닙니다.'],
  }
}
export async function fixtureReports() {
  const [snapshot, dataset] = await Promise.all([fs.readFile('scripts/currency-report/fixture-observations.json', 'utf8').then(JSON.parse), readDataset()])
  return fixtures.map(f => ({
    ...(snapshot.reports.find(r => r.currency === f.currency && r.baseDate === f.baseDate) ?? fixtureObservation(dataset, f.currency, f.baseDate)),
    evidence: f.evidence,
    id: `${f.currency}-${f.baseDate}-sample`, schemaVersion: 'currency-report/1', publishedAt: null,
    generationMode: 'editorial_fixture', status: 'sample', content: f.content,
  }))
}
export function summary(report) {
  const { id, currency, baseDate, observedDate, generationMode, status, comparison, purpose } = report
  return { id, currency, baseDate, observedDate, generationMode, status, ...(purpose ? { purpose } : {}), ...(comparison ? { comparison } : {}), title: report.content.title, summary: report.content.summary }
}
export async function localReports({directory=publicDir,ledger=ledgerRoot}={}) {
  let files = []
  try { files = await fs.readdir(directory) } catch (e) { if (e.code !== 'ENOENT') throw e }
  const reports=await Promise.all(files.filter(f => /^(BRL|MXN|CLP|COP|PEN|ARS)-[\d-]+\.json$/.test(f)).map(async f=>{
    const id=f.slice(0,-5),file=path.join(directory,f)
    // Legacy files have no marker. Managed files may never bypass a broken receipt.
    let marker
    try{marker=JSON.parse(await fs.readFile(path.join(directory,`${id}.managed`),'utf8'))}catch(e){if(e.code!=='ENOENT')return null}
    if(marker){try{const b=await readDataBundle(marker.id,{root:ledger});if(b.receipt.manifestHash!==marker.manifestHash||dataHash(await fs.readFile(file))!==b.manifest.resources.find(r=>r.id==='view').hash)return null}catch{return null}}
    return projectReviewReport(JSON.parse(await fs.readFile(file,'utf8')))
  }))
  return reports.filter(Boolean).sort((a,b)=>b.baseDate.localeCompare(a.baseDate))
}
export async function saveReport(report,{directory=publicDir,ledger=ledgerRoot}={}) {
  if (!/^(BRL|MXN|CLP|COP|PEN|ARS)-\d{4}-\d{2}-\d{2}-\d+$/.test(report.id)) throw new Error('invalid_report_id')
  await fs.mkdir(directory, { recursive: true })
  const view=projectReviewReport(report),file=path.join(directory,`${report.id}.json`)
  try{await fs.access(file);throw Error('report_already_exists')}catch(e){if(e.code!=='ENOENT')throw e}
  // Reserve before writing: a crash cannot make a new partial file look legacy.
  const markerFile=path.join(directory,`${report.id}.managed`)
  const marker=await fs.open(markerFile,'wx')
  await marker.close()
  const receipt=await writeDataBundle({root:ledger,id:report.id,kind:'review_draft',currency:report.currency,
    resources:[{id:'original',kind:'manuscript',value:report},{id:'view',kind:'review_projection',value:view}],
    edges:[{from:'original',to:'view',role:'review_projection'}],protection:['pending_review_dependency']})
  // Bundle owns exact compact bytes; keep them identical at the review endpoint.
  await fs.writeFile(file,JSON.stringify(view),{flag:'wx'})
  await fs.writeFile(markerFile,JSON.stringify(receipt))
}
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,structuredClone(value[k])]))
const leaf=(value,keys)=>{
 const result=pick(value,keys)
 if(Object.values(result).some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)))throw Error('invalid_public_field_type')
 return result
}
const strings=value=>{if(!Array.isArray(value)||value.some(v=>typeof v!=='string'))throw Error('invalid_public_field_type');return [...value]}
const claim=c=>({...leaf(c,['title','text','kind']),...Object.fromEntries(['factIds','evidenceIds'].filter(k=>c?.[k]!==undefined).map(k=>[k,strings(c[k])]))})
export function projectPublicReport(report) {
  const publicReport=leaf(report,['id','schemaVersion','currency','baseDate','observedDate','publishedAt','generationMode','status','purpose','testOnly','observationAt'])
  if(report.limitations)publicReport.limitations=strings(report.limitations)
  if(report.assemblyVersion==='currency-assembly/1')publicReport.assemblyVersion=report.assemblyVersion
  if(report.presentationVersion==='monthly-facts/1')publicReport.presentationVersion=report.presentationVersion
  if(report.authorship==='ai_with_manual_edit')publicReport.authorship=report.authorship
  if(report.historicalReview===true||report.comparison?.historicalReview===true)publicReport.historicalReview=true
  if(report.marketData)publicReport.marketData={source:['API','JSON','EXCEL'].includes(report.marketData.source)?report.marketData.source:'UNKNOWN',rateType:'LOCAL_PER_USD',
    fetchedAt:typeof report.marketData.fetchedAt==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(report.marketData.fetchedAt)&&Number.isFinite(Date.parse(report.marketData.fetchedAt))?report.marketData.fetchedAt:null}
  if(report.content){const c=report.content;publicReport.content={...leaf(c,['title','summary']),...(c.limitations?{limitations:strings(c.limitations)}:{}),...(c.change?{change:claim(c.change)}:{}),
    ...Object.fromEntries(['drivers','implications','watch'].filter(k=>Array.isArray(c[k])).map(k=>[k,c[k].map(claim)]))}}
  if(report.facts)publicReport.facts=report.facts.map(r=>leaf(r,['id','value','label']))
  if(report.series)publicReport.series=report.series.map(r=>leaf(r,['date','value']))
  publicReport.evidence = (report.evidence??[]).map(original => {
    assertOfficialPublicSummary(original)
    const e=pick(original,['id','country','title','publisher','url','publishedAt','eventDate','period','collectedAt','summary','eventAt','scope','role','causalStatus','provenance'])
    // Monthly PDF adapters keep their audit hashes in an internal provenance
    // object. Project the established public string contract without rewriting
    // saved manuscripts, response originals or source review receipts.
    const p = original.provenance
    for(const [key,value] of Object.entries(e))if(key!=='provenance'&&value!==null&&typeof value!=='string')throw Error('invalid_public_field_type')
    let officialPdf = false
    let officialInegi = false
    try {
      const url = new URL(e.url)
      if(url.protocol!=='https:'||url.username||url.password)throw Error('invalid_public_source_url')
      officialPdf = e.country === 'CLP' && original.source === 'INE Chile' && url.protocol === 'https:'
        && url.hostname === 'www.ine.gob.cl' && !url.username && !url.password && !url.port
        && /^\/docs\/default-source\/(actividad-mensual-del-comercio|sueldos-y-salarios)\/boletines\//.test(url.pathname)
        && url.pathname.endsWith('.pdf') && p?.manuallyReviewed === true
        && /^[a-f0-9]{64}$/.test(p.pdfHash) && p.documentId === `pdf-${p.pdfHash}`
      officialInegi=e.country==='MXN'&&e.publisher==='INEGI'&&url.protocol==='https:'&&url.hostname==='www.inegi.org.mx'
        &&!url.username&&!url.password&&!url.port&&p?.reportRole==='consumer_background'
        &&p.definitionVersion==='inegi-report-definitions/1'&&p.licenseUrl==='https://www.inegi.org.mx/inegi/terminos.html'
        &&typeof p.sourceAttribution==='string'&&typeof p.transformationDisclosure==='string'
    } catch(error) { if(error.message==='invalid_public_source_url')throw error }
    return officialInegi?{...e,provenance:'official',summary:[e.summary,p.sourceAttribution,p.transformationDisclosure].filter(Boolean).join(' ')}
      :officialPdf ? { ...e, publisher: 'INE Chile', provenance: 'official' }
      : !['official','market_reporting'].includes(p) ? { ...e, provenance: undefined } : e
  })
  const serialized=JSON.stringify(publicReport)
  if(/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|[?&](?:token|api_?key|access_token|signature)=/i.test(serialized))throw Error('private_data_in_public_projection')
  return publicReport
}
// The loopback-only design studio deliberately has review metadata, unlike a public response.
export function projectReviewReport(report){
 const projected=projectPublicReport(report)
 if(report.comparison)projected.comparison=pick(report.comparison,['inputHash','label','model','costUsd','average','preferred','provisional','publicationBlocked','reviewNotes','referenceOnly','citationRevision','editorialRevision','rulesReviewOnly','historicalReview','datasetFetchedAt'])
 return projected
}
export async function localEvidenceReviews() {
  let files = []
  try { files = await fs.readdir(reviewDir) } catch (e) { if (e.code !== 'ENOENT') throw e }
  return (await Promise.all(files.filter(f => /^(BRL|MXN|CLP)-\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(async f => JSON.parse(await fs.readFile(path.join(reviewDir, f), 'utf8'))))).sort((a, b) => b.baseDate.localeCompare(a.baseDate) || a.currency.localeCompare(b.currency))
}
export function evidenceReviewSummary(review) {
  return { id: review.id, currency: review.currency, baseDate: review.baseDate, causalConclusion: review.causalConclusion, publicationBlocked: review.publicationBlocked, candidates: review.candidates.length }
}
