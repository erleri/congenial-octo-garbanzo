import { expect, it, vi } from 'vitest'
const mocked=vi.hoisted(()=>({getSession:vi.fn(),rpc:vi.fn()}))
vi.mock('./reports/client',()=>({localReportMode:()=>true,getReportClient:async()=>({auth:{getSession:mocked.getSession},rpc:mocked.rpc})}))
import { recordUsage } from './usage'
it('excludes tracking opt-out and signed-in sessions, and coalesces repeated anonymous views',async()=>{
  const localWindow:{top?:unknown}={};localWindow.top=localWindow
  vi.stubGlobal('window',localWindow);vi.stubGlobal('navigator',{doNotTrack:'1'});vi.stubGlobal('location',{hostname:'127.0.0.1'})
  await recordUsage({event:'page_view',screen:'dashboard'})
  expect(mocked.getSession).not.toHaveBeenCalled()
  vi.stubGlobal('navigator',{doNotTrack:'0'})
  mocked.getSession.mockResolvedValueOnce({data:{session:{user:{id:'never-send'}}},error:null})
  await recordUsage({event:'page_view',screen:'dashboard'})
  expect(mocked.rpc).not.toHaveBeenCalled()
  mocked.getSession.mockResolvedValue({data:{session:null},error:null});mocked.rpc.mockResolvedValue({data:true,error:null})
  await recordUsage({event:'page_view',screen:'trends',currency:'MXN'})
  await recordUsage({event:'page_view',screen:'trends',currency:'MXN'})
  expect(mocked.rpc).toHaveBeenCalledTimes(1)
  expect(mocked.rpc).toHaveBeenCalledWith('record_app_usage',{p_event:'page_view',p_screen:'trends',p_currency:'MXN',p_report_id:'',p_scope:'local'})
})
