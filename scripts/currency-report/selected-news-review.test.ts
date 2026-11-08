import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {expect,it,vi} from 'vitest'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {planResearchSourceSelection} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {prepareSelectedReviewBatch} from './selected-review-batch.js'
import {prepareSelectedNewsReview,validateSelectedNewsReview,runSelectedNewsReviews,SELECTED_NEWS_REVIEW_VERSION} from './selected-news-review.js'

const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))

it('feeds saved claim-by-claim review responses into the common batch without inheriting source use or publication approval',async()=>{
 const data=await collection(),card=data.reviewQueue[0],job=prepareSelectedNewsReview({collection:data,card})
 const response=proposed(job),saved={cardBinding:card.binding,response}
 expect(prepareSelectedReviewBatch({collection:data}).items[0].status).toBe('automatic_review_unavailable')
 expect(prepareSelectedReviewBatch({collection:data,newsResponses:[saved]}).items[0])
  .toMatchObject({status:'review_judgment_recorded',sourceUseStatus:'not_assessed',writingEligibility:'not_assessed',publicationApproved:false})
 const unsupported=structuredClone(saved);unsupported.response.claimChecks[0].allSubclaimsSupported=false
 expect(prepareSelectedReviewBatch({collection:data,newsResponses:[unsupported]}).items[0].status).toBe('review_result_invalid')
 const stale=structuredClone(saved);stale.response.jobBinding='a'.repeat(64)
 expect(prepareSelectedReviewBatch({collection:data,newsResponses:[stale]}).items[0].status).toBe('review_result_invalid')
 expect(()=>prepareSelectedReviewBatch({collection:data,receipts:[response.receipt],newsResponses:[saved]})).toThrow('duplicate_review_response')
})

it('preserves global background as global in the common review result rather than upgrading it to a local cause',async()=>{
 const data=await collection(),card=data.reviewQueue[0],job=prepareSelectedNewsReview({collection:data,card})
 const response=proposed(job);response.assessment.role='global_context'
 const result=prepareSelectedReviewBatch({collection:data,newsResponses:[{cardBinding:card.binding,response}]})
 expect(result.items[0]).toMatchObject({status:'review_judgment_recorded',assessment:{role:'global_context',causeSupport:'no_reported_link'}})
 response.assessment.causeSupport='reported_link'
 expect(prepareSelectedReviewBatch({collection:data,newsResponses:[{cardBinding:card.binding,response}]}).items[0].status).toBe('review_result_invalid')
})
async function collection(count=1,published='2026-10-26T12:00:00Z'){
 const input=sourceSelectionFixture('COP',{metric:'market_quote',period:'2026-10-26',purpose:'fx_explanation'})
 const plan=planResearchSourceSelection({input,sourcePlan,sourceRegister})
 const urls=Array.from({length:count},(_,i)=>`https://www.larepublica.co/finanzas/dolar-peso-prueba-${12345+i}`)
 const captures=[['https://www.larepublica.co/finanzas',urls.map(url=>`<a href="${url}">Dólar en Colombia cambia por nueva información</a>`).join('')],
   ...urls.map(url=>[url,'<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',datePublished:published})+'</script>'
     +'<div class="html-content"><p>Synthetic dollar observation, not historical news.</p><p>Synthetic attributed explanation with an important condition.</p></div>'])]
   .map(([url,text])=>({sourceId:'cop-larepublica',url,text,collectedAt:'2026-10-28T10:00:00Z',httpStatus:200,
     sha256:createHash('sha256').update(text).digest('hex')}))
 return collectSelectedResearch({input,sourcePlan,sourceRegister,captures,now:()=> '2026-10-28T11:00:00Z',
   requestIds:plan.sourceRequests.filter(r=>r.sourceId==='cop-larepublica').map(r=>r.requestId)})
}
function proposed(job:ReturnType<typeof prepareSelectedNewsReview>){
 const text='합성 원문에서 확인한 해당 날짜의 가격 방향만 검토 요지로 기록한다.'
 return {version:SELECTED_NEWS_REVIEW_VERSION,jobBinding:job.binding,decision:'propose_notes',reason:'Synthetic source judgment, not evidence of real report quality.',
   assessment:{role:'price_only',eventDate:'2026-10-26',priceKind:'intraday',observedAt:null,causeSupport:'no_reported_link',
     supportingBlockPositions:[0],reason:'Synthetic original supports the quote only; no cause is approved.'},
   claimChecks:[{noteId:'n0',allSubclaimsSupported:true,blockPositions:[0],reason:'Every synthetic subclaim is bound to the first original block.'}],
   receipt:{cardBinding:job.cardBinding,checkedChecks:[...job.requiredChecks],
     source:{id:'news-synthetic-review',country:'COP',publisher:'Synthetic publisher',author:'Synthetic author',url:job.url,
       publishedAt:job.time.publishedAt,publicationDisplay:'Explicit synthetic publisher timestamp',eventDate:'2026-10-26',collectedAt:job.time.collectedAt},
     notes:[{id:'n0',kind:'fact',text,attribution:null,reportedPrice:null}],
     review:{origin:'agent',status:'checked',reason:'Synthetic support judgment for the adapter contract only.',supportingContentChecked:true,
       contentAccess:'publisher_page',independentlyWorded:true,notTranslation:true,notArticleSubstitute:true,checkedOn:'2026-10-28'},
     supportingReferences:[{noteId:'n0',blockPositions:[0],reason:'Synthetic source locator, not a live semantic review.'}],
     scopeDraft:{passageIds:['n0'],scope:{subject:'currency_market',metric:'reported_direction',unit:'qualitative',comparison:'same_day'},
       admittedClaims:[{id:'synthetic-fact',kind:'source_fact',text,passageIds:['n0']}],allowedUse:'합성 검사에서 지정한 당일 가격 방향 검토에만 사용한다.',
       countercontext:'합성 판단을 실제 환율 원인 또는 기여도 분석으로 확대하지 않는다.',excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]},
     scopeReview:{origin:'agent',status:'checked',reason:'Synthetic scope judgment for contract verification only.'}}}
}

it('prepares the complete bound local body while separating publication, collection, event and price time',async()=>{
 const data=await collection(),before=structuredClone(data),card=data.reviewQueue[0]
 const job=prepareSelectedNewsReview({collection:data,card})
 expect(job.time).toMatchObject({publicationDate:'2026-10-26',collectionCutoffRelation:'after_cutoff',
   availabilityAtCutoff:'unverified',eventDate:null,priceObservationAt:null})
 expect(job.blocks.map(b=>b.text)).toEqual(data.originals[0].blocks.map(b=>b.text))
 expect(job.sourceUses).toEqual({localAnalysis:'pending',externalModel:'pending',publicDisplay:'pending'})
 const batch=prepareSelectedReviewBatch({collection:data})
 expect(batch.items[0]).toMatchObject({status:'automatic_review_unavailable',newsReviewPreparation:{jobBinding:job.binding,rawBodyIncluded:false}})
 expect(JSON.stringify(batch)).not.toContain('Synthetic dollar observation')
 expect(data).toEqual(before)
})

it('uses the country calendar and keeps date-only publication precision unresolved',async()=>{
 const nearMidnight=await collection(1,'2026-10-27T00:30:00Z')
 expect(prepareSelectedNewsReview({collection:nearMidnight,card:nearMidnight.reviewQueue[0]}).time.publicationDate).toBe('2026-10-26')
 const dateOnly=await collection(1,'2026-10-26')
 expect(prepareSelectedNewsReview({collection:dateOnly,card:dateOnly.reviewQueue[0]}).time).toMatchObject({publicationCutoffRelation:'exact_time_unverified'})
})

it('rejects altered originals and instructions instead of reusing a valid-looking response binding',async()=>{
 const data=await collection(),card=data.reviewQueue[0],job=prepareSelectedNewsReview({collection:data,card}),response=proposed(job)
 const changed=structuredClone(data);changed.originals[0].blocks[0].text+=' revised'
 expect(()=>prepareSelectedNewsReview({collection:changed,card})).toThrow('stale')
 expect(()=>validateSelectedNewsReview({collection:data,card,job:{...job,instructions:'changed'},response})).toThrow('invalid_news_review_response')
})

it('routes a supported price-only judgment through existing note/scope checks without granting source use or writing approval',async()=>{
 const data=await collection(),before=structuredClone(data)
 const result=await runSelectedNewsReviews({collection:data,reviewer:job=>({...proposed(job),publicationApproved:true})})
 expect(result.items[0]).toMatchObject({status:'review_judgment_recorded',assessment:{role:'price_only',causeSupport:'no_reported_link'},
   sourceUseStatus:'not_assessed',writingEligibility:'not_assessed',publicationApproved:false})
 expect(result.items[0].evidence.evidence[0].newsNotes.notes[0].reportedPrice).toBeNull()
 expect(result).toMatchObject({reviewerInvocations:1,retries:0,manualUserTasks:[],externalDispatchAllowed:false})
 expect(data).toEqual(before)
})

it('rejects unsupported subclaims, wrong block locators, invented observation time and wrong-session cause links',async()=>{
 const data=await collection(),card=data.reviewQueue[0],job=prepareSelectedNewsReview({collection:data,card}),response=proposed(job)
 const unsupported=structuredClone(response);unsupported.claimChecks[0].allSubclaimsSupported=false
 expect(()=>validateSelectedNewsReview({collection:data,card,job,response:unsupported})).toThrow('news_claim_support_required')
 const wrongBlock=structuredClone(response);wrongBlock.claimChecks[0].blockPositions=[1]
 expect(()=>validateSelectedNewsReview({collection:data,card,job,response:wrongBlock})).toThrow('news_claim_support_required')
 const wrongTime=structuredClone(response);Object.assign(wrongTime.assessment,{observedAt:'2026-10-27T15:00:00Z'})
 expect(()=>validateSelectedNewsReview({collection:data,card,job,response:wrongTime})).toThrow('invalid_news_review_assessment')
 const wrongDay=structuredClone(response);Object.assign(wrongDay.assessment,{role:'market_explanation',causeSupport:'reported_link',eventDate:'2026-10-25'})
 wrongDay.receipt.source.eventDate='2026-10-25'
 expect(()=>validateSelectedNewsReview({collection:data,card,job,response:wrongDay})).toThrow('news_event_day_mismatch')
 const manufactured=structuredClone(response);manufactured.assessment.causeSupport='reported_link'
 expect(()=>validateSelectedNewsReview({collection:data,card,job,response:manufactured})).toThrow('invalid_news_review_assessment')
})

it('keeps source non-relevance distinct from unavailable review and never creates evidence from a rejection',async()=>{
 const data=await collection()
 const unavailable=await runSelectedNewsReviews({collection:data})
 expect(unavailable).toMatchObject({reviewerInvocations:0,meaningVerification:'not_performed',manualUserTasks:[]})
 expect(unavailable.items[0].status).toBe('automatic_review_unavailable')
 const result=await runSelectedNewsReviews({collection:data,reviewer:job=>{
   const response=proposed(job)
   return {...response,decision:'no_relevant_support',receipt:null,claimChecks:[],assessment:{...response.assessment,role:'unrelated'}}
 }})
 expect(result.items[0]).toMatchObject({status:'no_relevant_support',evidence:null,publicationApproved:false})
})

it('continues after invalid review output within the batch cap, without retries or repeated collection questions',async()=>{
 const data=await collection(2),reviewer=vi.fn(job=>reviewer.mock.calls.length===1?{}:proposed(job))
 expect(data.reviewQueue).toHaveLength(2)
 const result=await runSelectedNewsReviews({collection:data,reviewer})
 expect(result.items.map(i=>i.status)).toEqual(['review_failed','review_judgment_recorded'])
 expect(reviewer).toHaveBeenCalledTimes(2)
 const capped=await runSelectedNewsReviews({collection:data,maxReviews:1,reviewer:proposed})
 expect(capped.items.map(i=>i.status)).toEqual(['review_judgment_recorded','not_attempted'])
 expect(capped.items[1].reason).toBe('review_batch_limit')
})

it('aborts and stops the remaining batch after an unresolved timeout instead of launching overlapping work',async()=>{
 const data=await collection(2),signals:AbortSignal[]=[]
 const reviewer=vi.fn((_job,{signal})=>{signals.push(signal);return new Promise(()=>{})})
 const result=await runSelectedNewsReviews({collection:data,reviewer,timeoutMs:5})
 expect(result.items.map(i=>i.status)).toEqual(['review_timeout','not_attempted'])
 expect(result.items[1].reason).toBe('prior_reviewer_timeout')
 expect(reviewer).toHaveBeenCalledTimes(1);expect(signals[0].aborted).toBe(true)
 expect(result.retries).toBe(0)
})
