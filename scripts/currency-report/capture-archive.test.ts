import {it,expect} from 'vitest'
import {originalPipelineFixture} from './original-news-pipeline-fixture.js'
import {compileResearchSourceCatalog} from './research-source-selection.js'
import {mergeRegisteredCaptureArchive} from './capture-archive.js'
it('restores exact registered captures without changing current revisions, capture times, approval or source scope',async()=>{
 const f=await originalPipelineFixture(),args={captures:[],archive:[f.capture],catalog:compileResearchSourceCatalog(f.sourcePlan,f.sourceRegister),currency:'COP',asOf:'2026-10-28T02:00:00Z',sourceIds:[f.card.sourceId]}
 const r=mergeRegisteredCaptureArchive(args);expect(r.captures).toEqual([f.capture]);expect(r.added[0].meaning).toContain('not_current_fetch_or_content_approval')
 const current={...f.capture,text:'new current revision'}
 expect(mergeRegisteredCaptureArchive({...args,captures:[current]}).captures).toEqual([current])
 const tampered={...f.capture,text:'tampered archive'}
 expect(mergeRegisteredCaptureArchive({...args,archive:[tampered]})).toMatchObject({captures:[],issues:[{reason:'archive_integrity_or_capture_time_hold'}]})
 expect(mergeRegisteredCaptureArchive({...args,sourceIds:[]}).captures).toEqual([])
 expect(mergeRegisteredCaptureArchive({...args,archive:[{...f.capture,collectedAt:'2026-11-01T10:00:00Z'}]}).captures).toEqual([])
 expect(args.captures).toEqual([])
})
