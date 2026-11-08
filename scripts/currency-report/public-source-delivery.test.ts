import{it,expect}from'vitest'
import{publicSourceDelivery}from'./public-source-delivery.js'
import{sourceUseBinding}from'./source-use.js'
import{connectSourceAttributionConditions}from'./source-attributions.js'
function fixture(){
 const resource={id:'news-test',url:'https://example.org/market',publisher:'Example',publishedAt:'2026-11-01T10:00:00Z',period:'2026-11-01',summary:'Independently authored source note.'}
 const credit={version:'source-attribution/1',resourceId:resource.id,resourceBinding:sourceUseBinding(resource),sourceUrl:resource.url,
  publisher:resource.publisher,publishedAt:resource.publishedAt,referencePeriod:resource.period,
  attribution:'Source: Example, https://example.org/market',transformation:'Independent synthesis, not article text or a translation.'}
 const use=connectSourceAttributionConditions({resources:[resource],sourceUse:{evaluatedOn:'2026-11-02',reviews:[{
  version:'source-use/1',resourceId:resource.id,resourceBinding:sourceUseBinding(resource),terms:{url:'https://example.org/terms',version:'synthetic-only',reviewedOn:'2026-11-01'},
  scope:'Synthetic permission for testing final delivery only.',review:{origin:'agent',status:'checked',reason:'Synthetic test scope, not permission for an actual publisher.'},conditions:[],
  uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(k=>[k,{status:'allowed',reason:'Synthetic test permission, restricted by exact delivery.',conditionIds:[]}]))
 }]},attributionNotes:[credit]})
 return {task:{sourceUseReview:{externalModel:'pass',publicDisplay:'unverified'},publicUseProofs:[{resource,review:use.reviews[0]}]},
  report:{evidence:[{...resource,sourceCredit:credit,summary:credit.attribution+' '+credit.transformation}]},evaluatedOn:'2026-11-02'}
}
it('verifies the actual final credit instead of treating an early pending delivery as a permanent public-use failure',()=>{
 const f=fixture();expect(publicSourceDelivery(f).publicDisplay).toBe('pass')
 const projected=fixture();projected.task.plan={packet:{evidence:structuredClone(projected.report.evidence)}}
 delete projected.report.evidence[0].sourceCredit
 expect(publicSourceDelivery(projected).publicDisplay).toBe('pass')
 projected.report.evidence[0].url='https://example.org/different-final-url'
 expect(publicSourceDelivery(projected).publicDisplay).toBe('unverified')
 const hidden=structuredClone(f);hidden.report.evidence[0].summary='Credit was not actually included.'
 expect(publicSourceDelivery(hidden).publicDisplay).toBe('unverified')
 const changed=structuredClone(f);changed.report.evidence[0].sourceCredit.sourceUrl='https://example.org/another'
 expect(publicSourceDelivery(changed).publicDisplay).toBe('unverified')
})
it('never upgrades denied use or changed resource bindings just because credits are present',()=>{
 const f=fixture();f.task.publicUseProofs[0].review.uses.public_display.status='denied'
 expect(publicSourceDelivery(f).publicDisplay).toBe('unverified')
 const changed=fixture();changed.task.publicUseProofs[0].resource.summary='An altered independent note without its bound review.'
 expect(publicSourceDelivery(changed).publicDisplay).toBe('unverified')
})
