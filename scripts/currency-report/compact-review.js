// A transport codec, never a content judgment. The original sentence/subclaim
// validator consumes the decoded verdict, with the exact bound source anchors.
import {claimReviewContract} from './claim-review.js'
import {fingerprint} from './research-harness.js'
export const COMPACT_REVIEW_VERSION='runtime-review-refs/1'
export function compactReviewContract(prepared) {
 const contract=claimReviewContract(prepared),schema=structuredClone(contract.schema),anchors=[]
 for(const source of prepared.sources)for(const p of source.sourceContext?.passages??[]){
  const chunks=p.text.match(/[\s\S]{1,400}/gu)??[]
  if(chunks.length>1&&chunks.at(-1).trim().length<12)chunks.splice(-2,2,chunks.at(-2)+chunks.at(-1))
  for(const quote of chunks)if(quote.trim().length>=12)anchors.push({ref:'a'+anchors.length,evidenceId:source.id,
   passageId:p.id,passageHash:source.sourceContext.passageHash,quote})
 }
 const anchorSchema={type:'array',maxItems:4,uniqueItems:true,items:anchors.length?{type:'string',enum:anchors.map(a=>a.ref)}:{type:'string'}}
 for(const key of ['version','origin','reviewer']){delete schema.properties[key];schema.required=schema.required.filter(k=>k!==key)}
 const row=schema.properties.claims.items
 delete row.properties.claimHash;row.required=row.required.filter(k=>k!=='claimHash')
 row.properties.anchors=anchorSchema;row.properties.reason.maxLength=140
 row.properties.subclaims.items.properties.anchors=anchorSchema
 row.properties.subclaims.items.properties.reason.maxLength=120
 for(const check of Object.values(schema.properties.writingCoverage?.properties??{}))check.properties.reason.maxLength=160
 for(const check of Object.values(schema.properties.periodicChecks?.properties??{}))check.properties.reason.maxLength=160
 const transport={version:COMPACT_REVIEW_VERSION,preparedBinding:prepared.binding,anchors}
 return {...contract,schema,transport,transportBinding:fingerprint(transport),instructions:[
  '검토 전송은 runtime-review-refs/1이다. 각 문장과 모든 세부 주장·조건의 판정을 유지한다. 식별 해시·검토자 신원은 코드가 복원하므로 생성하지 않는다.',
  'anchors는 anchorTable의 ref 문자열 배열이다. 각 ref는 제공된 정확한 근거 구절 전체를 뜻한다. 그 구절이 해당 주장을 지지하는지 판단해 선택하며 원문·검토 요지를 혼동하지 않는다. 참조가 있다는 이유만으로 supported로 판정하지 않는다.',
  '문장 reason은 백사십 자, 세부 주장 reason은 백이십 자, 범위/정기 점검 reason은 백육십 자 이내로 구체적인 지지 또는 문제를 간결히 쓴다. 같은 구절과 공통 경고를 반복하지 않는다. subclaims.quote는 해당 문장을 순서대로 빠짐없이 나눈 정확한 조각이다.',
  '이 전송 형식에서는 anchors의 evidenceId/passageId/passageHash/quote 객체 대신 ref를 반환한다. 각 문장의 support·decision·issue·reason·subclaims와 모든 writingCoverage/periodicChecks는 생략하지 않는다.',
 ].join('\n')}
}
export function decodeCompactReview(prepared,body,transport) {
 const expected=compactReviewContract(prepared)
 if(fingerprint(transport)!==expected.transportBinding||body.review?.binding!==prepared.binding)throw Error('compact_review_binding_changed')
 const expand=refs=>{
  if(!Array.isArray(refs)||new Set(refs).size!==refs.length)throw Error('compact_review_anchor_shape')
  return refs.map(ref=>{const a=expected.transport.anchors.find(a=>a.ref===ref);if(!a)throw Error('compact_review_unknown_anchor')
   const {ref:unused,...anchor}=a;void unused;return anchor})
 }
 const claims=body.review.claims.map(row=>{
  const claim=prepared.claims.find(c=>c.id===row.id)
  if(!claim)throw Error('compact_review_unknown_claim')
  return {...row,claimHash:claim.claimHash,anchors:expand(row.anchors),subclaims:row.subclaims.map(p=>({...p,anchors:expand(p.anchors)}))}
 })
 return {...body,review:{...body.review,version:prepared.version,origin:'agent',claims}}
}
// Test/saved-verdict migration only; real generation always emits compact
// references itself. Never called to repair incomplete or invalid responses.
export function encodeCompactReview(prepared,body) {
 const contract=compactReviewContract(prepared)
 const refs=anchors=>anchors.flatMap(a=>{
  const matches=contract.transport.anchors.filter(r=>r.evidenceId===a.evidenceId&&r.passageId===a.passageId&&r.passageHash===a.passageHash&&r.quote.includes(a.quote))
  if(!matches.length)throw Error('compact_review_exact_anchor_required')
  return [matches[0].ref]
 })
 const {version,origin,reviewer,...rest}=body.review;void version;void origin;void reviewer
 return {...body,review:{...rest,claims:body.review.claims.map(row=>{
  const {claimHash,...r}=row;void claimHash
  return {...r,anchors:[...new Set(refs(r.anchors))],subclaims:r.subclaims.map(p=>({...p,anchors:[...new Set(refs(p.anchors))]}))}
 })}}
}
