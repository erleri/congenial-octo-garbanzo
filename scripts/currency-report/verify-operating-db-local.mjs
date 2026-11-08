// Fixed isolated DB only. Test controls/data roll back; optional installation
// installs schema with existing enabled flags and budget unchanged.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const directory=await fs.mkdtemp('.local-reports/private/operating-db-')
const docker=process.platform==='win32'?'C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe':'docker'
const container='supabase_db_latamfx-2x-isolated'
const command=(args,input)=>{
 const r=spawnSync(docker,args,{input,encoding:'utf8',maxBuffer:64000000,windowsHide:true})
 if(r.status!==0){throw Error('isolated_database_command_failed: '+(r.stderr??r.error?.message??'').slice(0,1000))}
 return r.stdout
}
const ports=JSON.parse(command(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
if(!ports['5432/tcp']?.some(p=>p.HostPort==='56322'))throw Error('isolated_database_required')
const sql=text=>command(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-A','-t'],text)
const dump=()=>command(['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema=public','--schema=app_private','--no-owner','--no-privileges'])
const hashes=raw=>Object.fromEntries([...raw.matchAll(/COPY ([^\n]+) FROM stdin;\r?\n([\s\S]*?)\\\.\r?\n/g)].map(m=>[m[1],createHash('sha256').update(m[2]).digest('hex')]))
const before=dump();await fs.writeFile(path.join(directory,'before.sql'),before,{flag:'wx'})
const migration=await fs.readFile('supabase/migrations/20261101073703_currency_report_operating_cycle.sql','utf8')
const tests=await fs.readFile('supabase/tests/currency_report_operating.sql','utf8')
const exists=sql("select to_regclass('app_private.currency_report_operating_policies') is not null;").trim()==='t'
const probe=sql(exists?tests:'begin;\n'+migration+'\n'+tests.replace(/^begin;\s*/,'').replace(/rollback;\s*$/,'')+'\nrollback;')
await fs.writeFile(path.join(directory,'probe.tap'),probe)
if(/^not ok\b/m.test(probe)||/Looks like|Failed test/.test(probe)||!/^1\.\.\d+$/m.test(probe))throw Error('operating_database_tests_failed: '+directory)
if(process.argv.includes('--install')&&!exists)sql('begin;\n'+migration+'\ncommit;')
if(process.argv.includes('--install')&&exists){
 const start=migration.indexOf('create function app_private.currency_report_operating_summary()')
 const end=migration.indexOf('\n$$;',start)+4
 if(start<0||end<start)throw Error('local_summary_definition_missing')
 sql('begin;\n'+migration.slice(start,end).replace('create function','create or replace function')+'\ncommit;')
}
const old=hashes(before),after=hashes(dump())
if(Object.entries(old).some(([key,hash])=>after[key]!==hash))throw Error('existing_database_rows_changed')
const result={target:container,port:56322,checks:(probe.match(/^ok \d+/gm)??[]).length,installed:exists||process.argv.includes('--install'),
 oldRecordsPreserved:true,syntheticDataRolledBack:true,actualModelCalls:0,actualCostUsd:0,productionChanges:0,directory}
await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
