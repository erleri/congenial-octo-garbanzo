// Scheduled/legacy manual runs keep their existing behavior. The explicit
// data-check mode is main-only and cannot opt in to mail or model execution.
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
export function dailyRunScope({eventName,ref,inputScope=''}) {
 if(!['schedule','workflow_dispatch'].includes(eventName))throw Error('unsupported_daily_trigger')
 const scope=eventName==='schedule'?'daily':inputScope||'daily'
 if(!['daily','data-check'].includes(scope)||eventName==='schedule'&&inputScope)throw Error('invalid_daily_run_scope')
 if(scope==='data-check'&&ref!=='refs/heads/main')throw Error('data_check_requires_main')
 return {scope,mailAllowed:scope==='daily',modelExecutionAllowed:scope==='daily'}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const result=dailyRunScope({eventName:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,inputScope:process.env.FX_REQUESTED_RUN_SCOPE})
 if(!process.env.GITHUB_OUTPUT)throw Error('workflow_output_required')
 await fs.appendFile(process.env.GITHUB_OUTPUT,`scope=${result.scope}\n`)
 console.log(JSON.stringify(result))
}
