// Creates a schema-only verification database in the existing isolated cluster.
// No original rows are copied/deleted. All fixtures roll back. No network/model.
import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
const container='supabase_db_latamfx-2x-isolated',database='latamfx_storage_validation_'+randomBytes(4).toString('hex')
const root='.local-reports/private/frozen-storage-20261110'
await fs.mkdir(root,{recursive:true})
const run=(args,input)=>{
 const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true})
 if(r.status!==0)throw Error('isolated_schema_verification_failed: '+String(r.stderr).slice(0,900))
 return r.stdout
}
const ports=JSON.parse(run(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
if(!ports['5432/tcp']?.some(p=>p.HostPort==='56322'))throw Error('isolated_database_required')
const sql=(db,text)=>run(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d',db,'-At'],text)
if(sql('postgres',`select count(*) from pg_database where datname='${database}'`).trim()!=='0')throw Error('verification_database_already_exists')
sql('postgres',`create database ${database} template template0;`)
sql(database,'create schema extensions; create extension pgcrypto with schema extensions; create extension "uuid-ossp" with schema extensions; create extension pgtap with schema extensions;')
const schema=run(['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema-only','--schema=auth','--schema=public','--schema=app_private','--no-owner','--no-privileges'])
// Grants are needed for the authorization checks; restore separately below.
sql(database,schema.replace('CREATE SCHEMA public;','CREATE SCHEMA IF NOT EXISTS public;'))
const grants=run(['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema-only','--schema=auth','--schema=public','--schema=app_private','--no-owner'])
// Existing object grants are the subject of this suite. Supabase internal
// owners' future default grants cannot be changed by the local postgres role.
const acl=grants.split('\n').filter(l=>/^(GRANT|REVOKE) /.test(l)).join('\n')
sql(database,acl+'\ngrant usage on schema extensions to anon,authenticated,service_role; insert into app_private.currency_report_runtime_control(singleton) values(true); insert into app_private.usage_settings(singleton) values(true);')
// Reconstruct the pre-addition shape only in this newly created empty database,
// then apply the actual migration as one transaction. Never run this on postgres.
if(!/^latamfx_storage_validation_[a-f0-9]{8}$/.test(database))throw Error('fresh_validation_database_required')
sql(database,`drop function public.claim_currency_report_operating_batch(text,uuid,bigint,jsonb,bigint,integer);
alter function app_private.claim_currency_report_operating_batch_accounted(text,uuid,bigint,jsonb,bigint,integer) set schema public;
alter function public.claim_currency_report_operating_batch_accounted(text,uuid,bigint,jsonb,bigint,integer) rename to claim_currency_report_operating_batch;
drop function app_private.currency_report_review_items();
alter function app_private.currency_report_review_items_before_storage() rename to currency_report_review_items;
drop function public.currency_report_storage_inspect(text[]),public.prepare_currency_report_storage_object(jsonb),public.put_currency_report_storage_chunk(text,integer,text),public.seal_currency_report_storage_object(text),public.read_currency_report_storage_chunk(text,integer),public.record_currency_report_storage_incident(text,text,boolean,jsonb);
drop table app_private.currency_report_storage_refs,app_private.currency_report_storage_chunks,app_private.currency_report_storage_incidents,app_private.currency_report_storage_objects;`)
sql(database,await fs.readFile('supabase/migrations/20261109150211_currency_operating_frozen_objects.sql','utf8'))
const results=[]
for(const filename of (await fs.readdir('supabase/tests')).filter(f=>f.endsWith('.sql')).sort()){
 const output=sql(database,await fs.readFile('supabase/tests/'+filename,'utf8'))
 await fs.writeFile(root+'/fresh-'+filename+'.tap',output)
 results.push({filename,checks:(output.match(/^ok \d+/gm)??[]).length,passed:!/^not ok|Looks like|Failed test/m.test(output)&&/^1\.\.\d+$/m.test(output)})
}
const result={database,target:container,schemaOnly:true,originalRowsCopied:false,migrationApplied:true,results,modelCalls:0,productionChanges:0}
await fs.writeFile(root+'/schema-suite.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
if(results.some(r=>!r.passed))process.exitCode=1
