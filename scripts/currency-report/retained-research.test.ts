import {it,expect} from 'vitest'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {ORIGINAL_NEWS_PIPELINE_VERSION} from './original-news-pipeline.js'
import {retainRegisteredResearch} from './retained-research.js'
it('keeps a registered captured candidate inside the research window without granting new approval or overwriting a current revision',async()=>{
 const f=await originalPipelineFixture(),record={key:'a'.repeat(64),sourceKey:'b'.repeat(64),original:f.collection.originals[0],card:f.card,review:{receipt:{synthetic:true}}}
 const current=structuredClone(f.collection);current.originals=[];current.reviewQueue=[structuredClone(f.card)]
 const args={collection:current,cache:[record],asOf:'2026-10-28T02:00:00Z',sourcePlan:f.sourcePlan,sourceRegister:f.sourceRegister}
 const retained=retainRegisteredResearch(args)
 expect(retained.originals).toEqual([record.original]);expect(retained.retainedResearch.retained[0].basis).toContain('not_new_fetch_or_approval')
 expect(current.originals).toEqual([])
 const revised=structuredClone(f.collection);revised.originals[0].text='New revision'
 expect(retainRegisteredResearch({...args,collection:revised}).originals[0].text).toBe('New revision')
 const old=structuredClone(record);old.original.metadata.publishedAt='2026-01-01T10:00:00Z'
 const held=structuredClone(record);held.review.heldStatus='original_support_hold';held.review.pipelineVersion=ORIGINAL_NEWS_PIPELINE_VERSION
 const future=structuredClone(record);future.original.collectedAt='2026-11-01T10:00:00Z'
 for(const invalid of [old,held,future])expect(retainRegisteredResearch({...args,cache:[invalid]}).originals).toEqual([])
 const obsolete=structuredClone(held);obsolete.review.pipelineVersion='original-news-pipeline/7'
 expect(retainRegisteredResearch({...args,cache:[obsolete]}).originals).toHaveLength(1)
 const unproven=structuredClone(record);delete unproven.sourceKey
 expect(retainRegisteredResearch({...args,cache:[unproven]}).originals).toEqual([])
})
