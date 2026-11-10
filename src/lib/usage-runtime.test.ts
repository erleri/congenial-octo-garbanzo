import {afterEach,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({getSession:vi.fn(),rpc:vi.fn(),local:vi.fn()}))
vi.mock('./reports/client',()=>({localReportMode:()=>mocks.local(),getReportClient:async()=>({auth:{getSession:mocks.getSession},rpc:mocks.rpc})}))
async function setup(search='?entry=email'){
 vi.resetModules();vi.stubEnv('VITE_USAGE_ENABLED','true')
 const win:{top?:unknown}={};win.top=win;vi.stubGlobal('window',win)
 vi.stubGlobal('location',{hostname:'latamforex.netlify.app',hash:'#dashboard',search})
 vi.stubGlobal('navigator',{doNotTrack:'0',globalPrivacyControl:false})
 mocks.local.mockReturnValue(false);mocks.getSession.mockResolvedValue({data:{session:null},error:null});mocks.rpc.mockResolvedValue({data:true,error:null});mocks.rpc.mockClear()
 return await import('./usage')
}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
it('does not consume a visit while logged in; logout records once and email entry once',async()=>{
 const u=await setup(),{initialFxNavigation:n}=await import('./fxNavigation')
 mocks.getSession.mockResolvedValue({data:{session:{user:{}}},error:null})
 await u.recordPageUsage(n);expect(mocks.rpc).not.toHaveBeenCalled()
 mocks.getSession.mockResolvedValue({data:{session:null},error:null})
 await u.recordPageUsage(n);await u.recordPageUsage(n)
 expect(mocks.rpc.mock.calls.map(c=>c[1].p_event)).toEqual(['page_view','email_entry'])
 expect(mocks.rpc.mock.calls.every(c=>c[1].p_entry_source==='email')).toBe(true)
})
it('rejects local, iframe, DNT, GPC and nonproduction without even reading auth',async()=>{
 const u=await setup();mocks.getSession.mockClear();const input={event:'page_view' as const,screen:'dashboard' as const}
 mocks.local.mockReturnValue(true);await u.recordUsage(input);mocks.local.mockReturnValue(false)
 Object.assign(navigator,{doNotTrack:'1'});await u.recordUsage(input);Object.assign(navigator,{doNotTrack:'0',globalPrivacyControl:true});await u.recordUsage(input)
 Object.assign(navigator,{globalPrivacyControl:false});window.top={} as Window;await u.recordUsage(input);window.top=window
 location.hostname='preview.netlify.app';await u.recordUsage(input)
 expect(mocks.getSession).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled()
})
it('does not infer email from arbitrary markers and retries failed acknowledgement',async()=>{
 const u=await setup('?entry=https://example.com/private'),{initialFxNavigation:n}=await import('./fxNavigation')
 mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'unavailable'}})
 await u.recordPageUsage(n);await u.recordPageUsage(n);await u.recordPageUsage(n)
 expect(mocks.rpc).toHaveBeenCalledTimes(2);expect(mocks.rpc.mock.calls[1][1].p_entry_source).toBe('direct_or_unknown')
})
