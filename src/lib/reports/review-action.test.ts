import {expect,it,vi} from 'vitest'
import {createReviewActionGate,reviewFailureMessage} from './review-action'

it('keeps a slow approval separate from polling and blocks a second write',async()=>{
 const gate=createReviewActionGate();let finish!:(value:string)=>void
 const write=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve})),poll=vi.fn()
 const pending=gate.run(write)
 await Promise.resolve()
 if(!gate.busy)poll()
 expect(poll).not.toHaveBeenCalled()
 expect(await gate.run(write)).toEqual({state:'busy'})
 finish('published');expect(await pending).toEqual({state:'received',value:'published'})
 expect(write).toHaveBeenCalledTimes(1);expect(gate.busy).toBe(false)
})
it('bounds a lost approval acknowledgement without retrying or claiming failure',async()=>{
 vi.useFakeTimers()
 try{
  const gate=createReviewActionGate(100),write=vi.fn(()=>new Promise<string>(()=>{}))
  const pending=gate.run(write)
  await vi.advanceTimersByTimeAsync(101)
  expect(await pending).toEqual({state:'unknown'})
  expect(write).toHaveBeenCalledTimes(1);expect(gate.busy).toBe(false)
 }finally{vi.useRealTimers()}
})
it('explains a public projection rejection without exposing arbitrary server text',()=>{
 expect(reviewFailureMessage({code:'22023',message:'invalid public field type'})).toContain('숫자·날짜')
 expect(reviewFailureMessage({code:'XX000',message:'PRIVATE SERVER DETAIL'})).not.toContain('PRIVATE')
 expect(reviewFailureMessage({code:'55000'})).toContain('다시 읽은')
})
