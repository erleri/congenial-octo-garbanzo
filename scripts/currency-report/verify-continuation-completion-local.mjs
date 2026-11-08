// Fixed isolated DB only. New definitions and synthetic writes all roll back.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const docker='C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe',container='supabase_db_latamfx-2x-isolated'
const run=(args,input)=>{const r=spawnSync(docker,args,{input,encoding:'utf8',maxBuffer:64000000,windowsHide:true});if(r.status!==0)throw Error((r.stderr??r.error?.message??'isolated DB unavailable').slice(0,2000)+(input?'\n'+r.stdout?.slice(-3500):''));return r.stdout}
const ports=JSON.parse(run(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
assert(ports['5432/tcp']?.some(p=>p.HostPort==='56322'),'fixed isolated DB required')
const sql=text=>run(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-A','-t'],text)
const tables=['app_private.currency_report_runtime_control','app_private.currency_report_runtime_jobs','app_private.currency_report_runtime_inputs',
 'app_private.currency_report_operating_policies','app_private.currency_report_operating_batches','app_private.currency_report_operating_cases',
 'app_private.currency_report_operating_source_reviews','public.currency_report_runs','public.currency_reports','public.currency_report_reviews','public.currency_report_storage_receipts']
const dump=()=>sql(tables.map(table=>`select '${table}:'||md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by md5(row_to_json(r)::text)),'')) from ${table} r;`).join('\n'))
const hashes=raw=>createHash('sha256').update(raw).digest('hex')
const before=dump(),schemaBefore=sql("select coalesce(string_agg(oid::regprocedure::text||':'||md5(pg_get_functiondef(oid)),'|' order by oid),'') from pg_proc where pronamespace in ('public'::regnamespace,'app_private'::regnamespace);")
const directory=await fs.mkdtemp('.local-reports/private/continuation-completion-db-')
let migration=await fs.readFile('supabase/migrations/20261101222538_currency_report_continuation_completion.sql','utf8')
const alreadyInstalled=sql("select to_regprocedure('app_private.finish_currency_report_runtime_before_continuation(uuid,jsonb,jsonb,jsonb)') is not null;").trim()==='t'
if(alreadyInstalled)migration=migration.replace(/^alter function app_private\.finish_currency_report_runtime\(uuid,jsonb,jsonb,jsonb\) rename to finish_currency_report_runtime_before_continuation;$/m,'-- Already installed locally; retain the original function identity.').replace(/create function /g,'create or replace function ')
for(const file of ['currency_report_continuation_completion.sql']){
 const tests=await fs.readFile('supabase/tests/'+file,'utf8')
 const result=sql('begin;\n'+migration+'\n'+tests.replace(/^begin;\s*/,'').replace(/rollback;\s*$/,'')+'\nrollback;')
 await fs.writeFile(path.join(directory,file+'.tap'),result,{flag:'wx'})
 if(/^not ok\b/m.test(result)||/Looks like|Failed test/.test(result))throw Error('continuation database assertions failed: '+directory)
}
assert.deepEqual(hashes(dump()),hashes(before),'existing data/control changes must roll back')
assert.equal(sql("select coalesce(string_agg(oid::regprocedure::text||':'||md5(pg_get_functiondef(oid)),'|' order by oid),'') from pg_proc where pronamespace in ('public'::regnamespace,'app_private'::regnamespace);"),schemaBefore,'function changes must roll back')
if(process.argv.includes('--install')){
 const control=JSON.parse(sql('select row_to_json(c) from app_private.currency_report_runtime_control c;').trim())
 assert.equal(control.enabled,false);assert.equal(control.review_enabled,false);assert.equal(Number(control.monthly_limit_nano),0)
 sql('begin;\n'+migration+'\ncommit;')
 assert.deepEqual(hashes(dump()),hashes(before),'install definitions only; leave all old records and controls unchanged')
}
const result={directory,target:container,port:56322,syntheticOnly:true,allTestDataAndDefinitionsRolledBack:true,
 definitionsInstalledLocally:process.argv.includes('--install'),activation:false,oldRecordsAndControlsPreserved:true,actualModelCalls:0,actualPaidUsd:0,productionChanges:0}
await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
console.log(JSON.stringify(result))
