// Offline preparation only. No environment, token, provider, database or fetch.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {prepareOfficialClpResearch,parseBcchPriceSeries} from './clp-official-price.js'
import {prepareNewsNotesInput} from './news-notes-input.js'
import {prepareEventTrial} from './lifecycle-control.js'
import {fingerprint} from './research-harness.js'
import {validDate} from './core.js'
import {NOTE_AUTHORING_VERSION,NOTE_AUTHORING_GUIDE} from './note-authoring.js'

export async function prepareNewsNotesLocal({caseFile,priceCaptureFile,methodologyFile,asOf}) {
  const root=await fs.realpath('.local-reports/private'),priceFile=await fs.realpath(priceCaptureFile)
  const relative=path.relative(root,priceFile)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.basename(priceFile)!=='capture.json') throw new Error('private_price_capture_required')
  const caseRaw=await fs.readFile(caseFile,'utf8'),priceRaw=await fs.readFile(priceFile,'utf8')
  if(Buffer.byteLength(caseRaw)>100000||Buffer.byteLength(priceRaw)>5000000) throw new Error('news_notes_input_too_large')
  const bundle=JSON.parse(caseRaw),capture=JSON.parse(priceRaw)
  if(!validDate(bundle.reportDate)||bundle.reportDate<bundle.sessionDate||bundle.reportDate>asOf?.slice(0,10))
    throw new Error('historical_news_notes_date_required')
  const descriptor=capture.captures?.find(c=>c.url===capture.series?.url)
  if(!/^original-\d+\.html$/.test(descriptor?.file??'')) throw new Error('original_price_capture_required')
  async function readPrivate(filename) {
    const resolved=await fs.realpath(filename),relative=path.relative(root,resolved),stat=await fs.stat(resolved)
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!stat.isFile()||stat.size>2000000)
      throw new Error('private_price_original_required')
    return fs.readFile(resolved)
  }
  const [priceOriginal,methodologyOriginal]=await Promise.all([
    readPrivate(path.join(path.dirname(priceFile),descriptor.file)),readPrivate(methodologyFile),
  ])
  const series=parseBcchPriceSeries({raw:priceOriginal,url:capture.series.url,year:capture.series.year,
    capturedAt:descriptor.capturedAt,methodologyRaw:methodologyOriginal})
  if(series.rawSha256!==capture.series.rawSha256||fingerprint(series.observations)!==fingerprint(capture.series.observations))
    throw new Error('saved_price_capture_changed')
  const price=prepareOfficialClpResearch(series,{throughSessionDate:bundle.sessionDate,asOf})
  // This is an explicit retrospective display date, not a claim that the
  // later downloaded snapshot was available on that historical day.
  price.packet.baseDate=bundle.reportDate
  price.packet.limitations.push('과거 사례 재구성입니다. 표시 기준일 이후 확보한 스냅샷으로 검토하며 당시 발행·가용성을 재현하지 않습니다.')
  const data=prepareNewsNotesInput(price.packet,bundle),plan=prepareEventTrial(data)
  const input=plan.body?JSON.parse(plan.body.messages[1].content):null
  if(input&&(input.evidence.some(e=>e.sourceContext?.sourceVersion!=='reviewer_authored_notes')
    ||JSON.stringify(input).includes('current_page_not_archived')||JSON.stringify(input).includes('archived_original')))
    throw new Error('original_text_in_news_notes_request')
  const directory=await fs.mkdtemp(path.join(root,'news-notes-preparation-'))
  const result={version:'news-notes-preparation/1',directory,status:plan.status,sessionDate:bundle.sessionDate,
    noteAuthoringVersion:NOTE_AUTHORING_VERSION,noteAuthoringGuide:NOTE_AUTHORING_GUIDE,
    historicalReplay:true,sourceCount:data.packet.evidence.length,cardCount:data.dossier.cards.length,
    price: data.assessment.priceMovement,holds:data.assessment.holds,
    inputBinding:fingerprint(data),requestHash:plan.requestHash??null,requestPrepared:!!plan.body,
    priceOriginalSha256:series.rawSha256,methodologySha256:series.methodology.sha256,
    originalTextIncluded:false,paidCallAuthorized:false,publicationApproved:false,networkCalls:0,modelCalls:0,newApiCostUsd:0}
  await fs.writeFile(path.join(directory,'input.json'),JSON.stringify(data,null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,'plan.json'),JSON.stringify(plan,null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
  if(caseRaw!==await fs.readFile(caseFile,'utf8')||priceRaw!==await fs.readFile(priceFile,'utf8')) throw new Error('news_notes_source_changed')
  return result
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{case:{type:'string'},prices:{type:'string'},methodology:{type:'string'},'as-of':{type:'string'}},strict:true})
  prepareNewsNotesLocal({caseFile:values.case,priceCaptureFile:values.prices,methodologyFile:values.methodology,asOf:values['as-of']}).then(r=>console.log(JSON.stringify(r,null,2))).catch(error=>{
    console.error(/^[a-z_]+$/.test(error.message)?error.message:'news_notes_preparation_failed');process.exitCode=1
  })
}
