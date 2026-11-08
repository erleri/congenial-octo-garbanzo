// Common writer input assembly over reviewed saved sources. No I/O or calls.
import {prepareMxnPricePacket} from './mxn-official-price.js'
import {reviewSelectedNewsMaterial} from './selected-material-review.js'
import {prepareInegiConsumerContext} from './inegi-writing-context.js'
import {createSourceContext} from './source-context.js'
import {bindEvidenceScope} from './evidence-scope.js'
import {fingerprint,evidenceBinding,HARNESS_VERSION} from './research-harness.js'
import {packetBinding} from './rules.js'
import {priceUseResource} from './research-materials.js'
import {sourceUseBinding} from './source-use.js'
import {bindFxWritingBackground} from './fx-writing-background.js'
import {assessFxCauseInput,fxCauseBinding,FX_CAUSE_VERSION} from './fx-cause-input.js'
import {harnessRequest} from './report-harness.js'
import {applyWriterPolicy} from './writer-policy.js'

export const MXN_WRITING_VERSION='mxn-writing-input/1'
export const mxnNewsPriceBinding=(basis,card)=>fingerprint({basis,cardBinding:card.binding})
export const BANXICO_POLICY_REVIEWED=Object.freeze({sha256:'7c5708112edc0cccf652a7992af14b77522bf1330bafabdc9eaad4a62044fdc5',
 url:'https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/%7B7D0BDB6E-E519-9C69-04AA-ABD4D31E4850%7D.pdf',decisionDate:'2026-09-24',rate:6.5})
export function prepareMxnPolicyBackground({documentSha256,collectedAt,review}) {
 const document=BANXICO_POLICY_REVIEWED
 if(documentSha256!==document.sha256||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(collectedAt??'')||!Number.isFinite(Date.parse(collectedAt))
  ||!['agent','human'].includes(review?.origin)||review.status!=='checked'||typeof review.reason!=='string'||review.reason.trim().length<10)
  throw new Error('reviewed_banxico_policy_required')
 const text='Banxico는 해당 결정에서 정책 목표금리를 유지했다. 이전 결정의 정책 배경이며 이번 환율 거래일의 새 발표나 시장 반응을 입증하지 않는다.'
 const e={id:'mxn-policy-20260924',country:'MXN',title:'Banxico 이전 정책 결정',publisher:'Banco de México',url:document.url,
  publishedAt:document.decisionDate,eventDate:document.decisionDate,period:document.decisionDate,collectedAt,summary:text,
  review:{originalVerified:true,scope:'공식 결정의 날짜·목표금리 수준만 사용하며 소비자 대출금리나 당일 환율 원인으로 바꾸지 않는다.'},
  provenance:{reportRole:'policy_background',policyVersion:'banxico-policy-background/1',rawSha256:documentSha256,
   sourceAttribution:'Fuente: Banco de México, Anuncio de Política Monetaria, 24 de septiembre de 2026.'},
  sourceContext:createSourceContext({blocks:[{kind:'paragraph',text}],selected:[0]})}
 const scope=bindEvidenceScope(e,{passageIds:['p0'],scope:{subject:'overnight_interbank_target_rate',metric:'policy_target_rate',unit:'percent_per_year',comparison:'decision_level_not_market_reaction'},
  admittedClaims:[{id:'mxn-policy-decision',kind:'source_fact',text:'해당 날짜 결정에서 정책 목표금리는 유지됐다. 확인한 목표금리 수준은 코드의 mxn_policy_rate 사실을 참조한다.',passageIds:['p0']}],
  allowedUse:'이전 정책 결정과 목표금리 수준을 배경으로 설명한다.',countercontext:'관측 계열의 날짜를 결정 발표일로 바꾸지 않고 당일 페소 원인이나 소비자 대출금리로 확대하지 않는다.',
  excludedExpansions:['당일 새 정책 발표·인하 또는 인상','정책금리와 개인 대출금리 동일시'],coverageGaps:[{subject:'exact_decision_publication_time',status:'not_verified'}],crossSourceClaims:[]},review)
 return {evidence:e,scope,fact:{id:'mxn_policy_rate',value:document.rate,label:'2026-09-24 Banxico 정책 목표금리 6.50% · 동결 · 이전 정책 배경'}}
}

export function prepareMxnWritingInput({priceSnapshot,throughSessionDate,asOf,news,consumer,policy=null,contentReview,priceUseJudgment,policyUseJudgment,writer}) {
 const packet=prepareMxnPricePacket(priceSnapshot,{throughSessionDate,asOf})
 const card=news.collection.reviewQueue?.find(c=>c.id===news.cardId)
 const reviewed=reviewSelectedNewsMaterial({collection:news.collection,card,receipt:news.receipt})
 const e=reviewed.evidence[0]
 if(e.country!=='MXN'||e.eventDate!==throughSessionDate||!Array.isArray(news.claims)||!news.claims.length||news.claims.length>8)
  throw new Error('mxn_reviewed_session_news_required')
 const pair=packet.marketData.reportPriceBasis.observations,link=news.priceReview
 if(link?.binding!==mxnNewsPriceBinding(packet.marketData.reportPriceBasis,card)||link.unit!=='MXN_per_USD'
  ||link.priceKind!=='official_closing_reference'||link.previousSessionDate!==pair[0].localSessionDate||link.sessionDate!==pair[1].localSessionDate
  ||link.previous!==pair[0].value||link.current!==pair[1].value||!['agent','human'].includes(link.origin)
  ||link.status!=='checked'||typeof link.reason!=='string'||link.reason.trim().length<10)throw new Error('mxn_news_price_match_review_required')
 packet.evidence.push(e);packet.evidenceScopeCards=[...reviewed.evidenceScopeCards]
 const policyBundle=policy?prepareMxnPolicyBackground(policy):null
 if(policyBundle){packet.evidence.push(policyBundle.evidence);packet.evidenceScopeCards.push(policyBundle.scope);packet.facts.push(policyBundle.fact)}
 const consumption=prepareInegiConsumerContext({...packet,purpose:'economic_update'},{...consumer,asOf})
 if(consumption.holds.length)return {version:MXN_WRITING_VERSION,status:'hold_before_writer',holds:consumption.holds,
  generationRequest:null,decision:null,paidCallAuthorized:false,publicationApproved:false,networkCalls:0,modelCalls:0,newPaidCostUsd:0}
 const combined={...consumption.packet,purpose:'fx_explanation'}
 combined.fxWritingBackground=bindFxWritingBackground({consumerContext:consumption.context,policyEvidenceIds:policyBundle?[policyBundle.evidence.id]:[],asOf})
 const cards=news.claims.map(claim=>{
  const note=e.newsNotes.notes.find(n=>n.id===claim.noteId)
  if(!note||!['market','local','global','counter'].includes(claim.questionId)||!['market','driver','counter'].includes(claim.role)
   ||!['supports','qualifies'].includes(claim.relation)||!['agent','human'].includes(claim.review?.origin)||claim.review.status!=='checked')
   throw new Error('mxn_news_claim_review_required')
  return {id:claim.id,questionId:claim.questionId,evidenceId:e.id,evidenceHash:evidenceBinding(e),passageIds:[note.id],statement:note.text,
   kind:note.kind==='fact'?'fact':'attributed_interpretation',attribution:note.attribution?`${note.attribution.organization} / ${note.attribution.person}`:null,
   allowedUse:'같은 거래일의 검토된 사실과 해당 출처에 귀속한 시장 설명에 사용한다.',limit:'FIX·종가·다른 날짜·실제 자금 유입량·소비 통계로 원인을 바꾸지 않는다.',
   eventKey:claim.eventKey,independenceKey:claim.independenceKey,relation:claim.relation,timeScope:'same_day_context',review:claim.review}
 })
 const dossier={version:HARNESS_VERSION,packetHash:packetBinding(combined),cards}
 const review={version:FX_CAUSE_VERSION,...contentReview,binding:fxCauseBinding(combined,dossier),purpose:'fx_explanation',
  claims:news.claims.map(c=>({cardId:c.id,role:c.role,supported:c.supported,reason:c.review.reason,sessionDate:throughSessionDate,priceConnection:'same_sessions_matching_official_close'}))}
 const resources=[priceUseResource(combined),e,...(policyBundle?[policyBundle.evidence]:[])]
 const judgments=[priceUseJudgment,news.useJudgment,...(policyBundle?[policyUseJudgment]:[])]
 if(judgments.some(j=>!j||j.resourceBinding||j.resourceId||j.version))throw new Error('explicit_mxn_use_judgments_required')
 const sourceUse={evaluatedOn:asOf.slice(0,10),reviews:[...resources.map((r,i)=>({version:'source-use/1',resourceId:r.id,resourceBinding:sourceUseBinding(r),...structuredClone(judgments[i])})),...consumer.sourceUse.reviews]}
 const fxCauseInput={review,sourceUse},assessment=assessFxCauseInput({packet:combined,dossier,...fxCauseInput})
 let writerPreview=null
 if(assessment.status==='ready_for_writer') {
  const prepared=harnessRequest(combined,dossier,writer)
  if(prepared.request) {
   const messages=structuredClone(prepared.request.messages),input=JSON.parse(messages[1].content)
   messages[0].content+='\n'+assessment.instructions
   input.fxExplanation={version:assessment.version,priceMovement:assessment.priceMovement,driverClaimIds:assessment.driverClaimIds,
    counterClaimIds:assessment.counterClaimIds,structure:assessment.structure,businessBackground:assessment.businessBackground}
   messages[1].content=JSON.stringify(input)
   const selected=applyWriterPolicy({...prepared.request,messages},writer)
   writerPreview={version:'fx-writer-input-preview/2',messages,schema:prepared.request.response_format.json_schema.schema,
    writerProfile:selected.profile,requestPreview:selected.body,outputContract:selected.outputContract,
    requestStatus:selected.status,maximumUsd:selected.maximumUsd,timeoutMs:selected.timeoutMs,retries:0,
    generationRequest:null,paidCallAuthorized:false,publicationApproved:false}
  }
 }
 return {version:MXN_WRITING_VERSION,status:assessment.holds.length?'hold_before_writer':writerPreview?'prepared_input_not_called':'research_needed',
  holds:assessment.holds,packet:combined,dossier,fxCauseInput,assessment,writerPreview,decision:null,generationRequest:null,
  historicalReplay:true,writingEligibility:'publication_decision_not_assessed',paidCallAuthorized:false,publicationApproved:false,
  inputBinding:fingerprint({packet:packetBinding(combined),dossier,fxCauseInput}),networkCalls:0,modelCalls:0,newPaidCostUsd:0}
}
