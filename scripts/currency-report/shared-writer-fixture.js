// Synthetic contract fixture only; never a reviewed historical market case.
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {fingerprint} from './research-harness.js'
export function sharedWriterFixture(currency='BRL',background=true) {
 const dataset={baseDate:'2026-10-28',fetchedAt:'2026-10-28T02:00:00Z',dailyRates:[27,28].map(day=>({currency,date:`2026-10-${day}`,
  rateType:'LOCAL_PER_USD',value:day===27?100:101,status:'ok',source:'API',imputationMethod:'NONE'}))}
 const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf:'2026-10-28T12:00:00Z'})
 const base={evidenceId:'news-synthetic',country:currency,publisher:'Synthetic publisher',sourceUrl:'https://example.org/synthetic',publishedAt:'2026-10-27',
  collectedAt:'2026-10-28T01:00:00Z',referencePeriod:'2026-10-27',sourceSessionDate:'2026-10-27',
  scope:{subject:currency,metric:'market commentary',unit:'qualitative',comparison:'same session interpretation'},
  articlePriceBasis:'Synthetic article quote, not a reference value.',sourceCredit:null,evidenceBinding:'a'.repeat(64),scopeBinding:'b'.repeat(64),
  allowedUse:'Synthetic stated scope only.',countercontext:'Synthetic condition retained.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[],attributions:[],
  sourceUses:{external_model:{status:'allowed'}},privateOriginalBody:'RAW-DO-NOT-COPY'}
 const connection={version:'reference-materials/2',ruleVersion:snapshot.ruleVersion,currency,referenceSnapshotId:snapshot.snapshotId,
  referenceDate:'2026-10-28',commentaryDate:'2026-10-27',sections:{market_observation:[{...base,role:'market_observation',claimId:'n0',
   kind:'source_fact',text:'시장 보도는 당일 달러 수요의 변화를 기록했습니다.'}],attributed_fx_explanation:[{...base,role:'attributed_fx_explanation',claimId:'n1',
   kind:'source_interpretation',text:'분석가는 달러 수요와 금리 기대가 현지 통화의 부담으로 이어지는 경로를 설명했습니다.'}],
   consumer_background:background?[{...base,evidenceId:'news-background',role:'consumer_background',claimId:'n0',referencePeriod:'2026-08',sourceSessionDate:null,
    kind:'source_fact',text:'별도 소매 자료는 조사 대상 기간의 구매 여건을 설명합니다.'}]:[]},holds:[],archive:[],held:[]}
 return {materialConnection:{...connection,binding:fingerprint(connection)},reportPriceSnapshot:snapshot,
  priorApproval:{authorized:true},originalResponse:'PRIVATE-OLD-RESPONSE',oldQualityScore:5,request:{mustNotExecute:true}}
}
export function sharedDraftFixture(plan) {
 const notes=plan.packet.evidence.flatMap(e=>e.sharedNotes.claims),cause=notes.find(n=>n.role==='attributed_fx_explanation'),background=notes.find(n=>n.role==='consumer_background')
 const d={title:'달러 흐름과 국내 구매 여건의 차이',summary:'시장 해석과 별도 소비 자료를 구분해 읽습니다.',
  drivers:[{title:'달러 수요와 금리 기대',text:cause.text,kind:'interpretation',evidenceIds:[cause.evidenceId]}],
  implications:background?[{title:'조사 기간의 구매 여건',text:background.text,kind:'fact',evidenceIds:[background.evidenceId]}]:[],watch:[]}
 const links=[['title',cause,'interpretation'],['summary',cause,'interpretation'],['drivers.0.title',cause,'interpretation'],['drivers.0.text',cause,'interpretation'],
  ...(background?[['implications.0.title',background,'fact'],['implications.0.text',background,'fact']]:[])]
 d.ruleLedger={version:'writer-links/1',claims:links.map(([target,n,kind])=>({target,kind,evidenceIds:[n.evidenceId],
  materialClaimIds:[n.claimId],mechanismId:'',applicationId:''}))}
 for(const [field,{max}]of Object.entries(plan.outputContract.sections)){
  const list=d[field];d[field]=Object.fromEntries(Array.from({length:max},(_,i)=>[`slot_${i}`,list[i]??null]))
 }
 return d
}
