import { expect, it, vi } from 'vitest'
import { createUsageRecorder, usagePayload, pageUsage, observeReportDwell } from './usage'
import { initialFxNavigation } from './fxNavigation'
it('counts actual return navigation but not repeated effects, and retries rejected/failed writes',async()=>{
 const send=vi.fn().mockResolvedValue(false),record=createUsageRecorder(send),input={event:'page_view' as const,screen:'dashboard' as const}
 await record(input,'dashboard','email');send.mockResolvedValue(true)
 await record(input,'dashboard','email');await record(input,'dashboard','email');expect(send).toHaveBeenCalledTimes(2)
 await record({...input,screen:'trends'},'trends','email');await record(input,'dashboard','email');expect(send).toHaveBeenCalledTimes(4)
 expect(send.mock.calls[0][0]).toMatchObject({p_entry_source:'email'})
})
it('coalesces concurrent sends and retries after transport failure without personal data',async()=>{
 let resolve!:(value:boolean)=>void;const send=vi.fn().mockImplementation(()=>new Promise<boolean>(r=>{resolve=r})),record=createUsageRecorder(send)
 const input={event:'report_open' as const,screen:'reports' as const,currency:'CLP' as const,reportId:'CLP.2026-11-02_1'}
 const first=record(input,'CLP','email');await record(input,'CLP','email');expect(send).toHaveBeenCalledTimes(1);resolve(true);await first
 expect(Object.keys(send.mock.calls[0][0]).sort()).toEqual(['p_currency','p_entry_source','p_event','p_report_id','p_screen','p_view'])
})
it('matches public IDs, rejects unknown dimensions and shares the actual trend selection',()=>{
 expect(usagePayload({event:'report_open',screen:'reports',currency:'BRL',reportId:'BRL.'+'a'.repeat(196)})).not.toBeNull()
 expect(usagePayload({event:'report_open',screen:'reports',currency:'BRL',reportId:'bad?token=x'})).toBeNull()
 expect(pageUsage({...initialFxNavigation,screen:'trends',view:'monthly',currency:'BRL',monthlyCurrency:'CLP'})).toMatchObject({view:'monthly',currency:'CLP'})
 expect(pageUsage({...initialFxNavigation,screen:'admin'})).toBeNull()
})
it('requires a continuous visible interval and cleans up timers',()=>{
 vi.useFakeTimers();let listener:()=>void=()=>{};const onDwell=vi.fn()
 const doc={visibilityState:'visible',addEventListener:(_e:string,fn:()=>void)=>{listener=fn},removeEventListener:vi.fn()} as unknown as Document
 const stop=observeReportDwell(doc,onDwell);vi.advanceTimersByTime(29000)
 Object.defineProperty(doc,'visibilityState',{value:'hidden',configurable:true});listener();vi.advanceTimersByTime(40000);expect(onDwell).not.toHaveBeenCalled()
 Object.defineProperty(doc,'visibilityState',{value:'visible',configurable:true});listener();vi.advanceTimersByTime(30000);expect(onDwell).toHaveBeenCalledTimes(1)
 stop();vi.advanceTimersByTime(60000);expect(onDwell).toHaveBeenCalledTimes(1);vi.useRealTimers()
})
