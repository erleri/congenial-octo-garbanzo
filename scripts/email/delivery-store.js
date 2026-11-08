import {createClient} from '@supabase/supabase-js'
import {assertRuntimeDestination} from '../currency-report/runtime-store.js'

// Server-only. No environment loading, implicit cloud destination or public client.
export function createEmailDeliveryStore({url,key,mode,env={},client}) {
  if(!key) throw Error('email_service_key_required')
  const endpoint=assertRuntimeDestination(url,mode,env)
  const db=client??createClient(endpoint,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})
  const call=async(action,input={})=>{
    const {data,error}=await db.rpc('dashboard_email_delivery',{p_action:action,p_input:input}).abortSignal(AbortSignal.timeout(15000))
    if(error) {const e=new Error('email_ledger_'+action+'_failed');e.code=error.code;throw e}
    return data
  }
  return {
    stage:(frame,chartBase64)=>call('stage_edition',{frameJson:JSON.stringify(frame),chartBase64}),
    claim:input=>call('claim',input),candidates:input=>call('candidates',input),
    preview:input=>call('preview',input),freeze:input=>call('freeze',input),
    begin:input=>call('begin',input),finish:input=>call('finish',input),
    inspect:key=>call('inspect',{key}),reconcile:input=>call('reconcile',input),unsuppress:input=>call('unsuppress',input),
  }
}
