// Offline release rehearsal against a NEW database in the existing 1.x local
// container. Never accepts a cloud URL, writes the source DB, starts a model,
// changes runtime controls, or restores into an existing database.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {parseArgs} from 'node:util'
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto'

const {values}=parseArgs({options:{'execute-local':{type:'boolean',default:false},cli:{type:'string',default:'supabase'},resume:{type:'string'},'seed-synthetic':{type:'boolean',default:false}}})
const docker=process.env.FX_LOCAL_DOCKER??'docker',container='supabase_db_latamfx-1x-staging'
const root=await fs.realpath(process.cwd()),parent=path.join(root,'.local-reports/private/operating-readiness-20261103')
await fs.mkdir(parent,{recursive:true})
const out=values.resume?await fs.realpath(values.resume):await fs.mkdtemp(path.join(parent,'upgrade-'))
if(path.dirname(out)!==parent||!path.basename(out).startsWith('upgrade-'))throw Error('private_rehearsal_directory_required')
const digest=v=>createHash('sha256').update(v).digest('hex')
const write=(name,value)=>fs.writeFile(path.join(out,name+'.json'),JSON.stringify(value,null,2),{flag:'wx'})
function command(executable,args,input){
 const r=spawnSync(executable,args,{input,maxBuffer:256000000,timeout:180000,windowsHide:true})
 if(r.status!==0){const e=Error('local_release_command_failed');e.diagnostic={executable:path.basename(executable),status:r.status,signal:r.signal,error:r.error?.code??null,stderr:r.stderr?.toString().slice(-5000)};throw e}
 return r.stdout
}
function assertLocalContainer(){
 const info=JSON.parse(command(docker,['inspect','--format','{{json .NetworkSettings.Ports}}',container]).toString())
 if(!info['5432/tcp']?.some(p=>p.HostPort==='55322'))throw Error('fixed_local_1x_container_required')
}
function sql(db,statement,{mutation=false}={}){
 if(db!=='postgres'&&!/^latamfx_release_20261103_[a-f0-9]{12}$/.test(db))throw Error('isolated_database_name_required')
 if(mutation&&db==='postgres')throw Error('source_database_write_forbidden')
 assertLocalContainer()
 return command(docker,['exec','-i',container,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],
  Buffer.from((mutation?'':'set default_transaction_read_only=on;\n')+statement)).toString().trim()
}
function snapshot(db){
 const tables=JSON.parse(sql(db,"select coalesce(json_agg(tablename order by tablename),'[]') from pg_tables where schemaname='public';"))
 return tables.map(table=>{
  if(!/^[a-z_]+$/.test(table))throw Error('known_table_identifier_required')
  return {table,...JSON.parse(sql(db,`select json_build_object('rows',count(*),'hash',md5(coalesce(string_agg(v,E'\\n' order by v),''))) from (select to_jsonb(t)::text v from public."${table}" t)x;`))}
 })
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
let target=null
let preservedTarget=null
try{
 if(values.resume&&await fs.stat(path.join(out,'result.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error}))
  throw Error('completed_rehearsal_requires_new_directory')
 assertLocalContainer()
 const baseline=JSON.parse(await fs.readFile(path.join(parent,'baseline.json'),'utf8'))
 const expected=baseline.production.appliedMigrations.map(m=>m.version).sort()
 const current=JSON.parse(sql('postgres',"select json_agg(version order by version) from supabase_migrations.schema_migrations;"))
 if(!same(expected,current))throw Error('local_source_must_match_verified_production_migrations')
 const directory=await fs.realpath(path.join(root,'supabase/migrations'))
 const names=(await fs.readdir(directory)).filter(f=>/^\d{14}_[a-z0-9_]+\.sql$/.test(f)).sort()
 const pending=[]
 for(const name of names)if(!current.includes(name.slice(0,14))){
  const file=await fs.realpath(path.join(directory,name));if(path.dirname(file)!==directory)throw Error('migration_scope_required')
  const bytes=await fs.readFile(file);pending.push({file:'supabase/migrations/'+name,version:name.slice(0,14),sha256:digest(bytes)})
 }
 const before=snapshot('postgres'),plan={version:'local-release-rehearsal/1',sourceMigrations:current,pending,sourceWrites:0,productionWrites:0}
 if(values.resume){
  if(!same(before,JSON.parse(await fs.readFile(path.join(out,'source-before.json'),'utf8')))
   ||!same(plan,JSON.parse(await fs.readFile(path.join(out,'migration-plan.json'),'utf8'))))throw Error('frozen_rehearsal_source_or_files_changed')
 }else{await write('source-before',before);await write('migration-plan',plan)}
 if(!values['execute-local']){console.log(JSON.stringify({status:'prepared_no_changes',pending:pending.length,sourceMigrations:current.length,directory:out}));process.exit(0)}
 if(values.resume){
  const saved=JSON.parse(await fs.readFile(path.join(out,'scratch-database.json'),'utf8'))
  target=saved.database
  if(!/^latamfx_release_20261103_[a-f0-9]{12}$/.test(target)||sql('postgres',`select count(*) from pg_database where datname='${target}';`)!=='1')throw Error('existing_rehearsal_database_required')
  const receipt=JSON.parse(await fs.readFile(path.join(out,'backup-receipt.json'),'utf8'))
  const encrypted=await fs.readFile(path.join(out,'source-database.encrypted'))
  if(digest(encrypted)!==receipt.encryptedHash)throw Error('authenticated_backup_required')
  const key=await fs.readFile(receipt.keyPath),decipher=createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12))
  decipher.setAuthTag(encrypted.subarray(-16))
  const restored=Buffer.concat([decipher.update(encrypted.subarray(12,-16)),decipher.final()])
  if(digest(restored)!==receipt.sha256)throw Error('authenticated_backup_required')
  preservedTarget=JSON.parse(await fs.readFile(path.join(out,'target-before.json'),'utf8').catch(error=>{if(error.code==='ENOENT')return JSON.stringify(before);throw error}))
  const prior=snapshot(target).filter(row=>preservedTarget.some(b=>b.table===row.table))
  if(!same(prior,preservedTarget))throw Error('existing_application_rows_changed')
 }else{
 target='latamfx_release_20261103_'+randomBytes(6).toString('hex')
 if(sql('postgres',`select count(*) from pg_database where datname='${target}';`)!=='0')throw Error('new_database_required')
 const dump=command(docker,['exec',container,'pg_dump','-U','postgres','-d','postgres','--format=custom','--no-publications','--no-subscriptions','--serializable-deferrable','--lock-wait-timeout=10000'])
 if(dump.subarray(0,5).toString()!=='PGDMP'||!same(before,snapshot('postgres')))throw Error('consistent_source_backup_required')
 // Backups contain local Auth records. Persist only authenticated ciphertext,
 // with the key outside the repository. No credential files are included.
 const keys=path.resolve(root,'../latamfx-release-private-keys');await fs.mkdir(keys,{recursive:true})
 const key=randomBytes(32),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce)
 const encrypted=Buffer.concat([nonce,cipher.update(dump),cipher.final(),cipher.getAuthTag()])
 const keyPath=path.join(keys,target+'.key');await fs.writeFile(keyPath,key,{flag:'wx',mode:0o600})
 await fs.writeFile(path.join(out,'source-database.encrypted'),encrypted,{flag:'wx',mode:0o600})
 await write('backup-receipt',{localOnly:true,sourceDatabase:'postgres',sourceContainer:container,sha256:digest(dump),encryptedHash:digest(encrypted),keyPath,rawDumpOnDisk:false})
 assertLocalContainer();command(docker,['exec',container,'createdb','-U','postgres','--template=template0',target])
 await write('scratch-database',{database:target,sourceWrites:0,addedNetworkExposure:false})
 command(docker,['exec','-i',container,'pg_restore','-U','supabase_admin','-d',target,'--single-transaction','--exit-on-error','--no-publications','--no-subscriptions'],dump)
 if(!same(before,snapshot(target)))throw Error('initial_clone_must_match_source')
 if(values['seed-synthetic']){
  // Only this NEW clone receives nonempty legacy fixtures. They exercise
  // upgrade preservation even when the pre-production local source is empty.
  sql(target,`begin;
   insert into public.business_plan_admins(email,active) values('upgrade-preservation@example.test',false);
   insert into public.business_plan_rates(period_month,plan_type,currency,rate_value,created_by_email)
    values('2094-03-01','leading','BRL',6.125,'upgrade-preservation@example.test');
   insert into public.fx_daily_rates(rate_date,currency,rate_type,rate_value,status,source,imputation_method)
    values('2094-03-01','BRL','LOCAL_PER_USD',6.125,'ok','API','NONE');
   insert into public.fx_monthly_rates(period_month,currency,rate_type,rate_value,status,source,imputation_method)
    values('2094-03-01','BRL','LOCAL_PER_USD',6.125,'ok','API','NONE');
   insert into public.fx_dataset_state(dataset_key,base_date,fetched_at,data_version,daily_row_count,monthly_row_count,load_status)
    values('primary','2094-03-01','2094-03-02T00:00:00Z','SYNTHETIC_UPGRADE_PRESERVATION',1,1,'ready');
   insert into public.fx_report_runs(base_date,attempt,schema_version,generation_mode,publish_mode,status,evidence,deterministic_content,selected_content)
    values('2094-03-01',1,'SYNTHETIC_UPGRADE_PRESERVATION','deterministic','review','pending_review','{}','{}','{}');
   commit;`,{mutation:true})
 }
 preservedTarget=snapshot(target);await write('target-before',preservedTarget)
 }
 // Official CLI applies the exact repository files and migration history only
 // to the checked new loopback database. Never use --linked or db reset.
 const url=`postgresql://postgres:postgres@127.0.0.1:55322/${target}`
 await fs.writeFile(path.join(out,'migration-up-'+Date.now()+'.log'),command(values.cli,['migration','up','--db-url',url,'--yes']))
 const applied=JSON.parse(sql(target,"select json_agg(version order by version) from supabase_migrations.schema_migrations;"))
 if(!same(applied,names.map(n=>n.slice(0,14))))throw Error('migration_history_must_match_exact_files')
 const after=snapshot(target)
 if(!same(preservedTarget,after.filter(row=>preservedTarget.some(b=>b.table===row.table))))throw Error('existing_application_rows_changed')
 if(!same(before,snapshot('postgres')))throw Error('source_application_rows_changed')
 const control=JSON.parse(sql(target,"select json_build_object('enabled',enabled,'reviewEnabled',review_enabled,'monthlyNano',monthly_limit_nano) from app_private.currency_report_runtime_control;"))
 if(control.enabled||control.reviewEnabled||Number(control.monthlyNano)!==0)throw Error('migration_activated_generation')
 // pgTAP is a test-only dependency. Install it in the disposable database,
 // as `supabase test db` does; never add it to the source or production DB.
 sql(target,'create extension if not exists pgtap with schema extensions;', {mutation:true})
 const tests=[]
 for(const file of (await fs.readdir(path.join(root,'supabase/tests'))).filter(f=>f.endsWith('.sql')).sort()){
  const output=sql(target,'set search_path=public,extensions,pg_catalog;\n'+await fs.readFile(path.join(root,'supabase/tests',file),'utf8'),{mutation:true})
  await fs.writeFile(path.join(out,'test-'+Date.now()+'-'+file+'.log'),output)
  if(/(?:^|\n)not ok\b/.test(output)||!/(?:^|\n)1\.\.\d+/.test(output))throw Error('database_contract_test_failed_'+file)
  tests.push({file,plan:output.match(/(?:^|\n)1\.\.(\d+)/)[1],passed:true})
 }
 if(!same(after,snapshot(target))||!same(before,snapshot('postgres')))throw Error('test_transaction_did_not_preserve_application_rows')
 const result={status:'local_upgrade_rehearsal_passed',database:target,sourceMigrationCount:current.length,additionalMigrations:pending.length,
  tests,existingApplicationRowsUnchanged:true,syntheticLegacyRows:preservedTarget.reduce((n,r)=>n+r.rows,0)-before.reduce((n,r)=>n+r.rows,0),sourceUnchanged:true,generationEnabled:false,paidCalls:0,productionWrites:0,directory:out}
 await write('result',result);console.log(JSON.stringify(result))
}catch(error){
 await write('failure-'+Date.now(),{reason:error.message,diagnostic:error.diagnostic??null,database:target,productionWrites:0,paidCalls:0})
 console.error(JSON.stringify({status:'local_upgrade_hold',reason:error.message,database:target,directory:out}));process.exitCode=1
}
