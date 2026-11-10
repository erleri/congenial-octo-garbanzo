import {expect,it,vi} from 'vitest'
import {createReviewedNewsEvidence} from './reviewed-news-notes.js'
import {bindEvidenceScope} from './evidence-scope.js'
import {sourceUseBinding} from './source-use.js'
import {fingerprint} from './research-harness.js'
import {assertProviderSchema} from './paid-comparison.js'
import {prepareNewsNotesModelReview,inspectNewsNotesModelResponse,inspectNewsModelEndpoint,executeNewsModelReview,NEWS_REVIEW_POLICY} from './news-model-review.js'

function fixture(currency='COP'){
 const source={id:'news-scope-fixture',country:currency,publisher:'Synthetic public publisher',author:'Synthetic reporter',url:'https://example.org/market',
   publishedAt:'2026-10-26T20:00:00Z',publicationDisplay:'Synthetic fixed publisher time',eventDate:'2026-10-26',collectedAt:'2026-10-27T10:00:00Z'}
 const notes=[{id:'n0',kind:'fact',text:'합성 사례에서 달러 표시 가격이 상승했다고 보도한 사실만 요지로 보존한다.',attribution:null,
   reportedPrice:currency==='CLP'?{previous:900,current:901,delta:1,unit:'CLP_per_USD',basis:'reported_market_close',observedAt:null}:null},
   {id:'n1',kind:'attributed_view',text:'합성 전문가가 해당 움직임을 달러 수요와 연결한 견해이며 확정된 기여도가 아니다.',
     attribution:{person:'Synthetic analyst',organization:'Synthetic institution'},reportedPrice:null}]
 const evidence=createReviewedNewsEvidence(source,notes,{origin:'agent',status:'checked',reason:'Synthetic note support judgment, not a real publication approval.',
   supportingContentChecked:true,contentAccess:'publisher_page',independentlyWorded:true,notTranslation:true,notArticleSubstitute:true,checkedOn:'2026-10-27'})
 const scope=bindEvidenceScope(evidence,{passageIds:['n0','n1'],scope:{subject:`${currency} market`,metric:'qualitative',unit:'reported_direction',comparison:'same_day'},
   admittedClaims:notes.map(n=>({id:`claim-${n.id}`,kind:n.kind==='fact'?'source_fact':'source_interpretation',text:n.text,passageIds:[n.id]})),
   allowedUse:'합성 자료의 가격 방향과 귀속 견해 범위 안에서만 사용한다.',countercontext:'실제 역사 자료·확정적 원인·기여도 분석으로 확대하지 않는다.',
   excludedExpansions:[],coverageGaps:[],crossSourceClaims:[]},{origin:'agent',status:'checked',reason:'Synthetic scope check for a fixed interface test.'})
 const sourceUse={evaluatedOn:'2026-10-27',reviews:[{version:'source-use/1',resourceId:evidence.id,resourceBinding:sourceUseBinding(evidence),
   terms:{url:'https://example.org/terms',version:'synthetic-test-only',reviewedOn:'2026-10-27'},scope:'Synthetic authored notes only, no article text or publication rights.',
   review:{origin:'agent',status:'checked',reason:'Synthetic use judgment, not a publisher licence.'},conditions:[],
   uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(use=>[use,{status:use==='public_display'?'pending':'allowed',
     reason:'Synthetic scope-limited use decision for this fixture only.',conditionIds:[]}]))}]}
 return {packet:{currency,baseDate:'2026-10-27',observedDate:'2026-10-26',evidence:[evidence],evidenceScopeCards:[scope]},sourceUse,asOf:'2026-10-28T04:00:00Z'}
}
function output(plan:ReturnType<typeof prepareNewsNotesModelReview>){
 const input=JSON.parse(plan.body.messages[1].content)
 return {sources:input.sources.map((s:{resourceId:string,sourceEventDate:string,passages:{id:string}[]})=>({resourceId:s.resourceId,
   role:'market_explanation',eventDate:s.sourceEventDate,priceKind:'not_stated',causeSupport:'reported_link',
   claims:s.passages.map(p=>({passageId:p.id,judgment:'supported_in_notes',reason:'Synthetic judgment is limited to the provided note and scope.'})),
   observations:[],materialGaps:[],reason:'Synthetic attributed explanation is consistent with the supplied notes.'}))}
}
const endpoint=()=>({model:NEWS_REVIEW_POLICY.model,route:NEWS_REVIEW_POLICY.route,zdr:true,dataCollection:'deny'})
function execution(plan:ReturnType<typeof prepareNewsNotesModelReview>){
 return {plan,approval:{authorized:true,planHash:fingerprint(plan),budgetUsd:1},journal:[],preflight:vi.fn(async()=>endpoint()),
   claim:vi.fn(async()=>{}),invoke:vi.fn(async()=>({valid:true,actualModel:NEWS_REVIEW_POLICY.model,costUsd:.001,
     partialText:JSON.stringify(output(plan)),usage:{prompt_tokens:100,completion_tokens:100},responseId:'gen-synthetic',latencyMs:10}))}
}

it('projects only canonical reviewed notes, scope and credits; excludes private review and raw source data',()=>{
 const data=fixture(),before=structuredClone(data),plan=prepareNewsNotesModelReview(data)
 expect(plan.status).toBe('prepared_not_called')
 const sent=JSON.parse(plan.body.messages[1].content)
 expect(sent.sourceMode).toBe('reviewer_authored_notes')
 expect(JSON.stringify(sent)).not.toContain('Synthetic note support judgment')
 expect(JSON.stringify(sent)).not.toContain('sourceContext')
 expect(sent.sources[0].passages).toHaveLength(2)
 expect(()=>assertProviderSchema(plan.body.response_format.json_schema.schema)).not.toThrow()
 expect(data).toEqual(before)
 const raw=fixture();delete raw.packet.evidence[0].newsNotes
 expect(()=>prepareNewsNotesModelReview(raw)).toThrow('reviewed_news_notes_required')
})

it('holds an absent external-use decision before a budget approval can dispatch it',async()=>{
 const data=fixture();data.sourceUse.reviews=[]
 const plan=prepareNewsNotesModelReview(data),args=execution(plan)
 expect(plan.status).toBe('source_or_input_hold')
 await expect(executeNewsModelReview(args)).rejects.toThrow('budget_or_source_gate')
 expect(args.preflight).not.toHaveBeenCalled();expect(args.claim).not.toHaveBeenCalled();expect(args.invoke).not.toHaveBeenCalled()
})

it('requires each note exactly once and records card consistency without original entailment or publication approval',()=>{
 const plan=prepareNewsNotesModelReview(fixture()),result=inspectNewsNotesModelResponse(plan,output(plan))
 expect(result).toMatchObject({status:'notes_consistency_checked',originalEntailmentVerified:false,publicationApproved:false})
 const repeated=output(plan);repeated.sources[0].claims[1].passageId='n0'
 expect(()=>inspectNewsNotesModelResponse(plan,repeated)).toThrow('reference_or_scope')
 const incomplete=output(plan);incomplete.sources[0].claims.pop()
 expect(()=>inspectNewsNotesModelResponse(plan,incomplete)).toThrow('reference_or_scope')
 const gap=output(plan);gap.sources[0].claims[0].judgment='unverified'
 expect(inspectNewsNotesModelResponse(plan,gap).status).toBe('scope_review_needed')
 const limited=output(plan);limited.sources[0].materialGaps=['합성 카드의 원문은 이 입력에 제공되지 않았다는 공통 한계를 보존한다.']
 expect(inspectNewsNotesModelResponse(plan,limited)).toMatchObject({status:'notes_consistency_checked_with_limitations',
   originalEntailmentVerified:false,writingEligibility:'not_assessed',publicationApproved:false})
 const global=output(plan);global.sources[0].role='global_context'
 const checked=inspectNewsNotesModelResponse(plan,global)
 expect(checked.items[0]).toMatchObject({role:'global_context',causeSupport:'reported_link',localCauseSupport:false})
})

it('rejects a fabricated observation timestamp and price-only causal promotion while preserving unknown time',()=>{
 const plan=prepareNewsNotesModelReview(fixture()),invented=output(plan)
 invented.sources[0].observations=[{passageId:'n0',priceKind:'intraday',localSessionDate:'2026-10-26',observedAt:'2026-10-26T15:00:00Z'}]
 expect(()=>inspectNewsNotesModelResponse(plan,invented)).toThrow('price_time_mismatch')
 invented.sources[0].observations[0].observedAt=''
 expect(()=>inspectNewsNotesModelResponse(plan,invented)).not.toThrow()
 const causal=output(plan);causal.sources[0].role='price_only'
 expect(()=>inspectNewsNotesModelResponse(plan,causal)).toThrow('reference_or_scope')
 const clp=prepareNewsNotesModelReview(fixture('CLP')),missing=output(clp)
 expect(()=>inspectNewsNotesModelResponse(clp,missing)).toThrow('reference_or_scope')
 missing.sources[0].observations=[{passageId:'n0',priceKind:'market_close',localSessionDate:'2026-10-26',observedAt:''}]
 expect(()=>inspectNewsNotesModelResponse(clp,missing)).not.toThrow()
 missing.sources[0].observations.push({...missing.sources[0].observations[0]})
 expect(()=>inspectNewsNotesModelResponse(clp,missing)).toThrow('reference_or_scope')
})

it('binds source material independently of the execution timestamp to prevent date-only duplicate-call bypass',async()=>{
 const data=fixture(),plan=prepareNewsNotesModelReview(data),later=prepareNewsNotesModelReview({...data,asOf:'2026-10-28T05:00:00Z'})
 expect(later.requestHash).not.toBe(plan.requestHash);expect(later.dedupKey).toBe(plan.dedupKey)
 const args=execution(later)
 await expect(executeNewsModelReview({...args,journal:[{requestHash:plan.requestHash,dedupKey:plan.dedupKey,maximumUsd:plan.maximumUsd,costUsd:.001}]})).rejects.toThrow('duplicate_unresolved')
 expect(args.invoke).not.toHaveBeenCalled()
 const insufficient=execution(plan);insufficient.approval.budgetUsd=.0001
 await expect(executeNewsModelReview(insufficient)).rejects.toThrow('budget_or_source_gate')
 expect(insufficient.claim).not.toHaveBeenCalled()
})

it('checks live endpoint capability, price and ZDR for the exact provider before reservation',()=>{
 const plan=prepareNewsNotesModelReview(fixture()),p=NEWS_REVIEW_POLICY
 const e={model_id:p.model,tag:p.route,status:0,supported_parameters:['reasoning','response_format','structured_outputs',p.outputField],
   context_length:100000,max_completion_tokens:8192,pricing:{prompt:'0.000002',completion:'0.000010'}}
 const catalog={data:{endpoints:[e]}},zdr={data:[{model_id:p.model,tag:p.route}]}
 expect(inspectNewsModelEndpoint(plan,catalog,zdr).route).toBe('azure')
 expect(()=>inspectNewsModelEndpoint(plan,catalog,{data:[]})).toThrow('source_endpoint_')
 e.pricing.completion='0.000011'
 expect(()=>inspectNewsModelEndpoint(plan,catalog,zdr)).toThrow('source_endpoint_')
})

it('retains unknown cost reservations and blocks subsequent work rather than retrying',async()=>{
 const plan=prepareNewsNotesModelReview(fixture()),args=execution(plan)
 args.invoke.mockRejectedValueOnce(new Error('lost response'))
 const result=await executeNewsModelReview(args)
 expect(result).toMatchObject({status:'cost_unresolved',costUsd:null,reservedUsd:plan.maximumUsd})
 expect(args.claim).toHaveBeenCalledTimes(1);expect(args.invoke).toHaveBeenCalledTimes(1)
 const next=execution(plan)
 await expect(executeNewsModelReview({...next,journal:[{...result,maximumUsd:plan.maximumUsd}]})).rejects.toThrow('duplicate_unresolved')
 expect(next.invoke).not.toHaveBeenCalled()
})

it('preserves real spend when output is invalid, and records valid scope review without a writer/public result',async()=>{
 const plan=prepareNewsNotesModelReview(fixture()),bad=execution(plan)
 bad.invoke.mockResolvedValueOnce({valid:true,actualModel:NEWS_REVIEW_POLICY.model,costUsd:.001,
   partialText:'not JSON',usage:{prompt_tokens:100,completion_tokens:100},responseId:'gen-synthetic',latencyMs:10})
 const held=await executeNewsModelReview(bad)
 expect(held).toMatchObject({status:'output_hold',costUsd:.001,reservedUsd:0,publicationApproved:false})
 expect(bad.invoke).toHaveBeenCalledTimes(1)
 const valid=await executeNewsModelReview(execution(plan))
 expect(valid).toMatchObject({status:'review_result_recorded',costUsd:.001,originalEntailmentVerified:false,
   review:{status:'notes_consistency_checked'},publicationApproved:false})
})
