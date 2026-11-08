import {afterEach,describe,it,expect,vi} from 'vitest'
import {createClient} from '@supabase/supabase-js'
import {reportHistoryProvider,trimReportCache} from './history-provider'
function setup(){
 const store=new Map<string,string>()
 vi.stubGlobal('sessionStorage',{get length(){return store.size},key:(i:number)=>[...store.keys()][i]??null,getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)})
 const fetcher=vi.fn(),client=createClient('http://127.0.0.1:56321','local-public-test-key',{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false}})
 return {store,fetcher,provider:reportHistoryProvider(async()=>client)}
}
const active=(id:string)=>({state:'active',id,currency:'CLP',baseDate:'2026-09-10',version:1,report:{id,currency:'CLP',baseDate:'2026-09-10',schemaVersion:'currency-report/1',status:'approved',publishedAt:'2026-09-11T00:00:00Z',content:{title:'saved'}}})
afterEach(()=>vi.restoreAllMocks())
describe('public history cache and state precedence',()=>{
 it('rechecks a missing identity later and keeps exact detail independent of index failure',async()=>{
  const {fetcher,provider}=setup()
  fetcher.mockResolvedValueOnce(Response.json({state:'not_found'})).mockResolvedValueOnce(Response.json(active('recheck-id')))
  expect((await provider.resolve('CLP','2026-09-10','recheck-id')).data.state).toBe('not_found')
  expect((await provider.resolve('CLP','2026-09-10','recheck-id')).data.report?.id).toBe('recheck-id')
  expect(fetcher.mock.calls.every(([url])=>String(url).includes('resolve_currency_report'))).toBe(true)
 })
 it('invalidates all matching body/page caches and rejects a late active response after confirmed withdrawal',async()=>{
  const {fetcher,provider,store}=setup()
  fetcher.mockResolvedValueOnce(Response.json(active('terminal-id'))).mockResolvedValueOnce(Response.json({state:'withdrawn',id:'terminal-id',currency:'CLP',baseDate:'2026-09-10',version:3})).mockResolvedValueOnce(Response.json(active('terminal-id'))).mockResolvedValueOnce(Response.json({state:'superseded',id:'terminal-id',currency:'CLP',baseDate:'2026-09-10',version:2}))
  await provider.resolve('CLP','2026-09-10','terminal-id')
  store.set('latamfx:public-report-history:v1:cache:page:CLP',JSON.stringify({version:1,category:'page',checkedAt:Date.now(),usedAt:Date.now(),data:{items:[{id:'terminal-id'}]}}))
  const removed=await provider.resolve('CLP','2026-09-10','terminal-id')
  expect(removed.data.state).toBe('withdrawn')
  expect([...store.values()].join()).not.toContain('"title":"saved"')
  expect((await provider.resolve('CLP','2026-09-10','terminal-id')).data.state).toBe('withdrawn')
  expect((await provider.resolve('CLP','2026-09-10','terminal-id')).data.state).toBe('withdrawn')
  expect([...store.values()].join()).not.toContain('"items":[{"id":"terminal-id"}]')
 })
 it('uses an explicit stale cache on outage, expires it, and bounds bytes and entry counts',async()=>{
  const {fetcher,provider,store}=setup();let now=Date.parse('2026-10-31T00:00:00Z');vi.spyOn(Date,'now').mockImplementation(()=>now)
  fetcher.mockResolvedValueOnce(Response.json(active('offline-id'))).mockRejectedValue(Error('offline'))
  await provider.resolve('CLP','2026-09-10','offline-id')
  expect((await provider.resolve('CLP','2026-09-10','offline-id')).cached).toBe(true)
  now+=25*3600000;await expect(provider.resolve('CLP','2026-09-10','offline-id')).rejects.toThrow()
  for(let i=0;i<15;i++)store.set('latamfx:public-report-history:v1:cache:body:'+i,JSON.stringify({version:1,category:'body',checkedAt:now,usedAt:now+i,data:'x'.repeat(600000)}))
  trimReportCache(now)
  expect(store.size).toBeLessThanOrEqual(10)
  expect([...store.values()].reduce((n,s)=>n+new TextEncoder().encode(s).byteLength,0)).toBeLessThan(5*1024*1024)
 })
 it('isolates one failed currency and tolerates unavailable browser storage',async()=>{
  const {fetcher,provider}=setup()
  vi.stubGlobal('sessionStorage',{getItem:()=>{throw Error('disabled')},setItem:()=>{throw Error('disabled')}})
  fetcher.mockImplementation(async (url:unknown)=>String(url).includes('currency=eq.COP')?new Response('{}',{status:403}):Response.json([]))
  const result=await provider.latestAll()
  expect(result.failed).toEqual(['COP']);expect(result.items).toEqual([])
 })
})
