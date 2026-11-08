import {describe,it,expect} from 'vitest'
import {inspectSourceUses,sourceUseBinding} from './source-use.js'
import {projectSourceAttributions,connectSourceAttributionConditions} from './source-attributions.js'

// Synthetic delivery contracts, not source permissions or report quality samples.
function fixture() {
 const e={id:'synthetic-statistic',url:'https://example.org/statistic',publisher:'Synthetic institution',publishedAt:'2026-10-15',period:'2026-08'}
 const n={version:'source-attribution/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),sourceUrl:e.url,publisher:e.publisher,
  publishedAt:e.publishedAt,referencePeriod:e.period,attribution:'Source: Synthetic institution; synthetic example only.',transformation:'Synthetic normalization; not actual economic research.'}
 const r={version:'source-use/1',resourceId:e.id,resourceBinding:sourceUseBinding(e),terms:{url:e.url,version:'synthetic/1',reviewedOn:'2026-10-28'},
  scope:'Synthetic scoped permission judgment used only for a delivery boundary test.',review:{origin:'agent',status:'checked',reason:'Synthetic judgment; no actual publisher approval or publication.'},
  conditions:[{id:'attribution',text:'Preserve the exact synthetic attribution in each permitted delivery.',status:'satisfied',delivery:{field:'attribution',equals:n.attribution,uses:['external_model','public_display']}}],
  uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(use=>[use,{status:'allowed',reason:'Synthetic scoped judgment for this boundary test only.',conditionIds:use==='local_analysis'?[]:['attribution']}]))}
 return {e,n,r}
}
const inspect=(x:ReturnType<typeof fixture>,renderings:Record<string,unknown>={})=>inspectSourceUses({resources:[x.e],reviews:[x.r],evaluatedOn:'2026-10-28',renderings}).items[0]

describe('Bound source attribution delivery',()=>{
 it('retains supplied authors and licence credits beyond a short label without allowing an unbounded field or mismatched delivery',()=>{
  const x=fixture()
  x.n.attribution='Publisher · '+Array.from({length:8},(_,i)=>`Author ${i}: `+'a'.repeat(120)).join(' · ')+' · https://creativecommons.org/licenses/by/4.0/'
  x.r.conditions[0].delivery.equals=x.n.attribution
  const rows=projectSourceAttributions([x.e],[x.n])
  expect(inspect(x,{external_model:rows}).uses.external_model.status).toBe('allowed')
  expect(inspect(x,{external_model:[{...rows[0],attribution:rows[0].attribution.slice(0,480)}]}).uses.external_model.status).toBe('pending')
  expect(()=>projectSourceAttributions([x.e],[{...x.n,attribution:'a'.repeat(4097)}])).toThrow('source_attribution_binding_required')
 })
 it('connects recurring labels in a new review copy without changing scope decisions or duplicating conditions',()=>{
  const x=fixture(),sourceUse={evaluatedOn:'2026-10-28',reviews:[x.r]},before=structuredClone(sourceUse)
  x.r.uses.public_display.status='pending';before.reviews[0].uses.public_display.status='pending'
  const connected=connectSourceAttributionConditions({resources:[x.e],sourceUse,attributionNotes:[x.n]})
  expect(sourceUse).toEqual(before)
  expect(connected.reviews[0].uses.public_display.status).toBe('pending')
  expect(connected.reviews[0].conditions.filter(c=>c.delivery).map(c=>c.id)).toContain('delivery-referencePeriod')
  expect(connectSourceAttributionConditions({resources:[x.e],sourceUse:connected,attributionNotes:[x.n]})).toEqual(connected)
 })
 it('holds an asserted satisfied condition until the exact label accompanies that particular use',()=>{
  const x=fixture(),rows=projectSourceAttributions([x.e],[x.n]),before=structuredClone(x)
  expect(inspect(x).uses.external_model.pendingConditionIds).toEqual(['attribution'])
  const result=inspect(x,{external_model:rows})
  expect(result.uses.external_model.status).toBe('allowed')
  expect(result.uses.public_display.status).toBe('pending')
  expect(result.uses.local_analysis.status).toBe('allowed');expect(x).toEqual(before)
 })
 it('detects a label removed or replaced after projection rather than trusting a reviewer flag',()=>{
  const x=fixture(),rows=projectSourceAttributions([x.e],[x.n])
  rows[0].attribution='A different credit that omits the required source.'
  expect(inspect(x,{external_model:rows}).uses.external_model.reason).toBe('source_use_conditions_pending')
  const missing={...rows[0]};delete missing.attribution
  expect(inspect(x,{external_model:[missing]}).uses.external_model.status).toBe('pending')
 })
 it('does not reuse a delivery for a changed source or accept labels whose dates and URL differ from that source',()=>{
  const x=fixture(),rows=projectSourceAttributions([x.e],[x.n]);x.e.period='2026-09'
  expect(inspect(x,{external_model:rows}).reviewStatus).toBe('binding_changed')
  expect(()=>projectSourceAttributions([x.e],[x.n])).toThrow('source_attribution_binding_required')
  const y=fixture();y.n.sourceUrl='https://example.org/different'
  expect(()=>projectSourceAttributions([y.e],[y.n])).toThrow('source_attribution_binding_required')
  y.n.sourceUrl=y.e.url;y.n.referencePeriod='2026-09'
  expect(()=>projectSourceAttributions([y.e],[y.n])).toThrow('source_attribution_binding_required')
 })
 it('preserves a pending scope decision even when all required text is delivered',()=>{
  const x=fixture();x.r.uses.external_model.status='pending'
  expect(inspect(x,{external_model:projectSourceAttributions([x.e],[x.n])}).uses.external_model.status).toBe('pending')
 })
 it('retains a required delivery condition when its duplicated use reference was accidentally omitted',()=>{
  const x=fixture();x.r.uses.external_model.conditionIds=[]
  expect(inspect(x).uses.external_model.pendingConditionIds).toEqual(['attribution'])
 })
 it('rejects ambiguous duplicate deliveries and non-whitelisted condition fields',()=>{
  const x=fixture(),rows=projectSourceAttributions([x.e],[x.n])
  expect(()=>inspect(x,{external_model:[...rows,...rows]})).toThrow('invalid_source_use_renderings')
  x.r.conditions[0].delivery.field='privateOriginal'
  expect(()=>inspect(x)).toThrow('invalid_source_use_review')
 })
 it('projects no review metadata and refuses secret-bearing or HTML labels',()=>{
  const x=fixture(),rows=projectSourceAttributions([x.e],[x.n])
  expect(Object.keys(rows[0]).sort()).toEqual(['resourceId','resourceBinding','sourceUrl','publisher','publishedAt','referencePeriod','attribution','transformation'].sort())
  x.n.attribution='Source: <script>synthetic</script>'
  expect(()=>projectSourceAttributions([x.e],[x.n])).toThrow('invalid_source_attributions')
  x.n.attribution='https://example.org/?token=synthetic-secret'
  expect(()=>projectSourceAttributions([x.e],[x.n])).toThrow('invalid_source_attributions')
 })
})
