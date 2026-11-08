// One transaction in the fixed isolated local DB. Migration, fake records,
// role decisions and SMTP-ledger mutations all roll back. No network email.
import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
const docker='C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
const container='supabase_db_latamfx-2x-isolated'
const run=(args,input)=>{const r=spawnSync(docker,args,{input,encoding:'utf8',windowsHide:true,maxBuffer:15000000});if(r.status!==0)throw Error(String(r.stderr??r.error?.message).slice(0,2500));return r.stdout}
const ports=JSON.parse(run(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
if(!ports['5432/tcp']?.some(p=>p.HostPort==='56322'))throw Error('fixed_isolated_database_required')
const sql=input=>run(['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],input)
const directory='.local-reports/private/admin-review-notification-20261109'
await fs.mkdir(directory,{recursive:true})
const snapshot="select jsonb_build_object('reports',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')) from public.currency_reports r),'runs',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')) from public.currency_report_runs r),'plans',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')) from public.business_plan_rates r));"
const before=sql(snapshot)
const dependencies=[]
for(const [table,file] of [['currency_report_source_monitors','20261108120546_currency_report_source_monitor.sql'],['currency_report_source_policies','20261108124341_currency_report_source_admission.sql']]){
 if(sql(`select to_regclass('app_private.${table}') is not null;`).trim()!=='t')dependencies.push(await fs.readFile('supabase/migrations/'+file,'utf8'))
}
const migration=await fs.readFile('supabase/migrations/20261108150645_admin_review_notifications.sql','utf8')
const tests=await fs.readFile('supabase/tests/admin_review_notifications.sql','utf8')
const output=sql('begin;\n'+dependencies.join('\n')+'\n'+migration+'\n'+tests.replace(/^begin;\s*/,'').replace(/rollback;\s*$/,'')+'\nrollback;')
await fs.writeFile(directory+'/database.tap',output)
if(/^not ok|Looks like|Failed test/m.test(output))throw Error('admin_review_database_tests_failed')
const after=sql(snapshot)
if(before!==after)throw Error('existing_local_records_changed')
const result={checks:(output.match(/^ok \d+/gm)??[]).length,existingRecordsPreserved:true,rolledBack:true,productionChanges:0,emailSent:0,modelCalls:0}
await fs.writeFile(directory+'/database-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
