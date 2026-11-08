// Offline evaluation plumbing: gold semantic judgments are explicit inputs.
// This proves routing of those judgments, never autonomous semantic accuracy.
import {createReviewedNewsEvidence} from './reviewed-news-notes.js'
import {prepareClaimReview,assessClaimReview,correctionPlan,claimReviewContract,correctionContract,CLAIM_REVIEW_VERSION} from './claim-review.js'
import {REASONING_POLICY_VERSION} from './reasoning-policy.js'
import {REASONING_CASES,REASONING_CASES_VERSION} from './reasoning-cases.js'

export function replayReasoningCases(bundle) {
  const evidence=bundle.entries.map(e=>createReviewedNewsEvidence(e.source,e.notes,e.review))
  // One preserved price fact supplies the existing report schema, not a new price audit.
  const packet={currency:'CLP',baseDate:'2026-09-10',observedDate:'2026-09-10',facts:[{id:'spot',value:937.17,label:'1 USD = 937.17 CLP'}],evidence,
    limitations:['저장 문장과 검토 요지의 범위를 대조하는 로컬 고정 사례입니다.']}
  const results=REASONING_CASES.map(sample=>{
    const target=sample.target??'drivers.0.text',section=target.split('.')[0]
    const block={title:'근거 범위를 확인하는 검토 사례',text:[sample.context,sample.quote].filter(Boolean).join(' '),kind:'interpretation',factIds:[],evidenceIds:[...new Set(sample.refs.map(([id])=>id))]}
    const content={title:'저장 문장 범위 재검토',summary:sample.summaryContext??'실제 보고서 발행이 아닌 고정 사례 재평가다.',
      change:{title:'보존된 가격 사실',text:'보존된 환율은 {{spot}}이다.',kind:'fact',factIds:['spot'],evidenceIds:[]},
      drivers:[],implications:[],watch:[],limitations:[...packet.limitations]}
    if (['title', 'summary'].includes(target)) {
      content[target] = sample.quote
      content.drivers = [{ ...block, text: '출처에 귀속한 시장 해석의 범위를 별도로 검토한다.' }]
    } else content[section]=[block]
    if(section==='watch')content.drivers=[{
      title:'기사에서 제시한 구리 경로',
      text:'Capitaria는 구리 조정으로 페소 지지력이 약해졌다고 해석했다. 유가와 미국 금리 기대에 따른 대외 달러 압력도 함께 설명했다.',
      kind:'interpretation',factIds:[],evidenceIds:['news-emol-20260910'],
    }]
    const prepared=prepareClaimReview(packet,content)
    const anchors=sample.refs.map(([id,noteId])=>{
      const s=prepared.sources.find(s=>s.id===id),p=s?.sourceContext?.passages.find(p=>p.id===noteId)
      if(!p)throw Error('missing_reasoning_case_note')
      return {evidenceId:id,passageId:p.id,passageHash:s.sourceContext.passageHash,quote:p.text}
    })
    // All non-target claims stay unverified; these samples cannot approve a report.
    const review={version:CLAIM_REVIEW_VERSION,binding:prepared.binding,origin:'agent',reviewer:'Codex fixed-case source-note adjudication 2026-10-27',
      claims:prepared.claims.map(c=>{
        const known=c.target===target&&c.quote===sample.quote
        const row=known?{support:sample.support,decision:sample.decision,issue:sample.issue,reason:sample.reason,anchors}
          :{support:'unverified',decision:'keep',issue:'verification_gap',reason:'이 고정 사례는 본문 대상 문장만 검토하며 다른 위치를 승인하지 않는다.',anchors:[]}
        return {id:c.id,claimHash:c.claimHash,...row,applicationIds:[],subclaims:[{quote:c.quote,support:row.support,reason:row.reason,anchors:row.anchors,applicationIds:[]}]}
      })}
    const assessment=assessClaimReview(prepared,review),plan=correctionPlan(prepared,review)
    const row=assessment.rows.find(c=>c.target===target&&c.quote===sample.quote)
    return {id:sample.id,origin:sample.origin,rule:sample.rule,quote:sample.quote,context:sample.context??null,
      adjudication:{support:sample.support,decision:sample.decision,reason:sample.reason},
      disposition:row?.disposition,errors:assessment.errors,correctionRequired:plan.items.some(c=>c.target===target),
      optionalRefinement:assessment.optionalRefinements.includes(row?.id),
      publicationApproved:assessment.publicationApproved,
      packet,content,prepared,review,reviewContract:claimReviewContract(prepared),
      ...(plan.items.length?{plan,correctionContract:correctionContract(plan)}:{})}
  })
  return {version:REASONING_CASES_VERSION,reasoningPolicyVersion:REASONING_POLICY_VERSION,
    scope:'Fixed human-readable gold adjudications + existing contract/correction routing; no live model evaluation.',
    cases:results,modelCalls:0,newApiCostUsd:0,publicationApproved:false}
}
