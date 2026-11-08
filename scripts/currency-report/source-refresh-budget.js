// One optional phase after registered-country acquisition. The clock is elapsed
// time, independent of the market date in historical/saved-data replays.
export const SOURCE_REFRESH_MAX_MS=30000
export function sourceRefreshBudget({maxDurationMs=SOURCE_REFRESH_MAX_MS,clock=()=>performance.now()}={}) {
 if(!Number.isInteger(maxDurationMs)||maxDurationMs<1||maxDurationMs>SOURCE_REFRESH_MAX_MS)throw Error('source_refresh_budget_invalid')
 const deadline=clock()+maxDurationMs
 const remaining=()=>Math.max(0,Math.floor(deadline-clock()))
 return {remaining,child(maxMs){return sourceRefreshBudget({maxDurationMs:Math.min(maxMs,remaining()),clock})},async run(work){
  const ms=remaining();if(ms<=0)throw Error('source_refresh_time_budget')
  const controller=new AbortController();let timer
  try{
   const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{
    controller.abort();reject(Error('source_refresh_time_budget'))
   },ms)})
   const value=await Promise.race([Promise.resolve().then(()=>work(controller.signal,remaining)),expired])
   if(remaining()<=0)throw Error('source_refresh_time_budget')
   return value
  }finally{clearTimeout(timer)}
 }}
}
