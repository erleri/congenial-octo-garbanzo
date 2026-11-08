import {it,expect,vi} from 'vitest'
import {loadOperationalFxDataset} from '../load-fx-dataset.js'
import {operatingEntry} from './operating-entry.js'
import {operatingFixture} from './operating-fixture.js'
import {referenceReadiness,operatingResultState} from './operating-result.js'

vi.mock('../load-fx-dataset.js',()=>({loadOperationalFxDataset:vi.fn()}))

it('plans through the workflow entry using the shared FX loader without a local manifest, model key or sender',async()=>{
 const f=await operatingFixture()
 vi.mocked(loadOperationalFxDataset).mockResolvedValueOnce(f.dataset)
 const acquire=vi.fn(f.acquire),fetchImpl=vi.fn(()=>{throw Error('offline_network_forbidden')})
 const result=await operatingEntry({action:'plan',requireReady:true,workspace:process.cwd(),store:f.store,asOf:f.asOf,acquire,fetchImpl,
  env:{GITHUB_ACTIONS:'true',FX_REPORT_GENERATOR:'currency',FX_REPORT_ENABLED:'true',FX_REPORT_DATA_REFRESH:'committed'}})
 expect(result.collectionResults.map(row=>row.currency)).toEqual(['BRL','MXN','COP','PEN','CLP','ARS'])
 expect(acquire).toHaveBeenCalledTimes(6)
 expect(result.modelCalls).toBe(0)
 expect(result.referenceReadiness).toMatchObject({ready:true,failures:[],contentQualityEvaluated:false})
 expect(f.state.posts).toEqual([])
 expect(fetchImpl).not.toHaveBeenCalled()
 expect(acquire.mock.calls.every(([args])=>args.mode==='live')).toBe(true)
})

it('rejects a readiness check used as execution, before accessing any credentials or store',async()=>{
 await expect(operatingEntry({action:'execute',requireReady:true})).rejects.toThrow('reference_readiness_is_plan_only')
})

it('fails readiness for a missing country, a reference comparison hold or a non-free result without grading content',async()=>{
 const f=await operatingFixture()
 vi.mocked(loadOperationalFxDataset).mockResolvedValueOnce(f.dataset)
 const result=await operatingEntry({action:'plan',workspace:process.cwd(),store:f.store,asOf:f.asOf,acquire:f.acquire,
  env:{GITHUB_ACTIONS:'true',FX_REPORT_DATA_REFRESH:'committed'}})
 const missing={...result,collectionResults:result.collectionResults.slice(1)}
 expect(referenceReadiness(missing)).toMatchObject({ready:false})
 const held=structuredClone(result);held.collectionResults[0].publicationDecision.comparisonHolds.push('anchor_value_revised')
 const readiness=referenceReadiness(held)
 expect(readiness.failures).toContain('BRL:reference_not_ready')
 expect(operatingResultState({...held,referenceReadiness:readiness})).toMatchObject({kind:'failure',exitCode:1})
 expect(referenceReadiness({...result,modelCalls:1}).failures).toContain('non_free_readiness_result')
})

it('keeps free workflow research but sends no original or writing request when the FX refresh was not confirmed',async()=>{
 const f=await operatingFixture()
 vi.mocked(loadOperationalFxDataset).mockResolvedValueOnce(f.dataset)
 const acquire=vi.fn(f.acquire),transport=vi.fn(()=>{throw Error('paid_dispatch_forbidden')})
 const result=await operatingEntry({action:'execute',workspace:process.cwd(),store:f.store,asOf:f.asOf,acquire,transport,
  fetchImpl:()=>{throw Error('endpoint_lookup_forbidden')},
  env:{GITHUB_ACTIONS:'true',FX_REPORT_GENERATOR:'currency',FX_REPORT_ENABLED:'true',FX_REPORT_DATA_REFRESH:'not_confirmed'}})
 expect(acquire).toHaveBeenCalledTimes(6)
 expect(result.collectionResults.every(row=>row.referenceStatus==='upstream_fx_refresh_not_confirmed')).toBe(true)
 expect(result.modelCalls).toBe(0)
 expect(transport).not.toHaveBeenCalled()
 expect(f.store.drafts).toHaveLength(0)
})
