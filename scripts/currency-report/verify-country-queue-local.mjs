// Fixed isolated DB only. Test writes/definitions roll back; optional install
// requires disabled controls and changes only the local queue function/index.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const docker='C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe',container='supabase_db_latamfx-2x-isolated'
const run=(args,input)=>{const r=spawnSync(docker,args,{input,encoding:'utf8',windowsHide:true,maxBuffer:64000000});if(r.status!==0)throw Error((r.stderr??r.error?.message??'isolated DB unavailable')+'\n'+(r.stdout??'').slice(-5000));return r.stdout}
const ports=JSON.parse(run(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
assert(ports['5432/tcp']?.some(p=>p.HostPort==='56322'))
const sql=text=>run(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-A','-t'],text)
const tables=['app_private.currency_report_runtime_control','app_private.currency_report_runtime_jobs','app_private.currency_report_runtime_inputs',
 'app_private.currency_report_operating_policies','app_private.currency_report_operating_batches','app_private.currency_report_operating_cases',
 'app_private.currency_report_operating_source_reviews','public.currency_report_runs','public.currency_reports','public.currency_report_reviews','public.currency_report_storage_receipts']
const digest=()=>createHash('sha256').update(sql(tables.map(t=>`select '${t}:'||md5(coalesce(string_agg(md5(row_to_json(r)::text),'' order by md5(row_to_json(r)::text)),'')) from ${t} r;`).join('\n'))).digest('hex')
const definitions=()=>sql("select coalesce(string_agg(oid::regprocedure::text||':'||md5(pg_get_functiondef(oid)),'|' order by oid),'') from pg_proc where pronamespace in ('public'::regnamespace,'app_private'::regnamespace);")
const index=()=>sql("select to_regclass('app_private.currency_operating_pending_revision');")
const before=digest(),schema=definitions(),oldIndex=index(),directory=await fs.mkdtemp('.local-reports/private/country-queue-db-')
const migration=await fs.readFile('supabase/migrations/20261102005736_currency_report_country_queue.sql','utf8')
let assertions=0
for(const file of ['currency_report_country_queue.sql','currency_report_continuation_completion.sql']){
 const test=await fs.readFile('supabase/tests/'+file,'utf8')
 const output=sql('begin;\n'+migration+'\n'+test.replace(/^begin;\s*/,'').replace(/rollback;\s*$/,'')+'\nrollback;')
 await fs.writeFile(directory+'/'+file+'.tap',output)
 if(/^not ok\b/m.test(output)||/Looks like|Failed test/.test(output))throw Error('isolated queue assertions failed: '+directory)
 assertions+=(output.match(/^ok\b/gm)??[]).length
}
assert.equal(digest(),before);assert.equal(definitions(),schema);assert.equal(index(),oldIndex)
if(process.argv.includes('--install')){
 const control=JSON.parse(sql('select row_to_json(c) from app_private.currency_report_runtime_control c;').trim())
 assert.equal(control.enabled,false);assert.equal(control.review_enabled,false);assert.equal(Number(control.monthly_limit_nano),0)
 sql('begin;\n'+migration+'\ncommit;');assert.equal(digest(),before)
}
const result={directory,assertions,target:container,port:56322,allSyntheticTestRowsRolledBack:true,
 definitionsInstalledLocally:process.argv.includes('--install'),oldRecordsAndControlsPreserved:true,
 actualModelCalls:0,actualPaidUsd:0,productionChanges:0}
await fs.writeFile(directory+'/result.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
