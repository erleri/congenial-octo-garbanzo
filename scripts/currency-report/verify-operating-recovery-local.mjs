// Fixed isolated local DB, synthetic transactions only. No cloud/key/model use.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const directory=await fs.mkdtemp('.local-reports/private/operating-recovery-db-')
const docker='C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe',container='supabase_db_latamfx-2x-isolated'
const run=(args,input)=>{const r=spawnSync(docker,args,{input,encoding:'utf8',maxBuffer:64000000,windowsHide:true});if(r.status!==0)throw Error((r.stderr??'isolated DB unavailable').slice(0,1200));return r.stdout}
const ports=JSON.parse(run(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
if(!ports['5432/tcp']?.some(p=>p.HostPort==='56322'))throw Error('isolated_database_required')
const sql=text=>run(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-A','-t'],text)
const dump=()=>run(['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema=public','--schema=app_private','--no-owner','--no-privileges'])
const hashes=raw=>Object.fromEntries([...raw.matchAll(/COPY ([^\n]+) FROM stdin;\r?\n([\s\S]*?)\\\.\r?\n/g)].map(m=>[m[1],createHash('sha256').update(m[2]).digest('hex')]))
const before=dump();await fs.writeFile(path.join(directory,'before.sql'),before,{flag:'wx'})
let migration=await fs.readFile('supabase/migrations/20261101090428_operating_reference_refresh_recovery.sql','utf8')
// Reapply the current local definitions without creating migration history.
migration=migration.replace(/create function /g,'create or replace function ').replace('create unique index ','create unique index if not exists ')
for(const file of ['currency_report_operating.sql','currency_report_operating_recovery.sql']){
 const tests=await fs.readFile('supabase/tests/'+file,'utf8')
 const result=sql('begin;\n'+migration+'\n'+tests.replace(/^begin;\s*/,'').replace(/rollback;\s*$/,'')+'\nrollback;')
 await fs.writeFile(path.join(directory,file+'.tap'),result)
 if(/^not ok\b/m.test(result)||/Looks like|Failed test/.test(result))throw Error('operating recovery test failed: '+directory)
}
if(process.argv.includes('--install'))sql('begin;\n'+migration+'\ncommit;')
const old=hashes(before),after=hashes(dump())
if(Object.entries(old).some(([key,value])=>after[key]!==value))throw Error('existing_records_changed')
const result={directory,target:container,port:56322,oldRecordsPreserved:true,syntheticDataRolledBack:true,installed:process.argv.includes('--install'),actualModelCalls:0,actualPaidUsd:0,productionChanges:0}
await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
