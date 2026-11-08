// Fixed isolated container only. All synthetic records and control changes roll
// back. --install adds the reviewed migration disabled, never activates a worker.
import fs from 'node:fs/promises'
import {writeFileSync} from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const root=process.cwd(),directory=path.join(root,'.local-reports/private/runtime-20261031')
await fs.mkdir(directory,{recursive:true})
const out=await fs.mkdtemp(path.join(directory,'db-'))
const run=(args,input)=>{
 const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:32_000_000,windowsHide:true})
 if(r.status!==0){writeFileSync(path.join(out,'error.log'),r.stderr??String(r.error));throw Error('isolated_runtime_db_command_failed')}
 return r.stdout
}
const container='supabase_db_latamfx-2x-isolated'
const ports=JSON.parse(run(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
if(!ports['5432/tcp']?.some(p=>p.HostPort==='56322'))throw Error('isolated_runtime_database_port_required')
const sql=text=>run(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-A','-t'],text)
const dump=()=>run(['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema=public','--schema=app_private','--no-owner','--no-privileges'])
const tables=raw=>Object.fromEntries([...raw.matchAll(/COPY ([^\n]+) FROM stdin;\r?\n([\s\S]*?)\\\.\r?\n/g)].map(m=>[m[1],createHash('sha256').update(m[2]).digest('hex')]))
const before=dump()
await fs.writeFile(path.join(out,'db-before.sql'),before,{flag:'wx'})
const migration=await fs.readFile('supabase/migrations/20261031133808_currency_report_runtime.sql','utf8')
const test=await fs.readFile('supabase/tests/currency_report_runtime.sql','utf8')
const existing=process.argv.includes('--existing')
if(existing&&process.argv.includes('--install'))throw Error('existing_runtime_must_not_be_reinstalled')
const tests=process.argv.includes('--suite')?(await fs.readdir('supabase/tests')).filter(f=>f.endsWith('.sql')).sort():['currency_report_runtime.sql']
let probe=existing?(await Promise.all(tests.map(f=>fs.readFile(path.join('supabase/tests',f),'utf8')))).map(sql).join('\n')
 :sql('begin;\n'+migration+'\n'+test.replace(/^begin;\s*/,'').replace(/rollback;\s*$/,'')+'\nrollback;\n')
await fs.writeFile(path.join(out,'db-probe.tap'),probe)
if(/^not ok\b/m.test(probe)||/Looks like|Failed test/.test(probe)||!/^1\.\.\d+$/m.test(probe))throw Error('runtime_database_test_failed')
const first=tables(before),after=tables(dump())
if(Object.keys(first).some(k=>first[k]!==after[k]))throw Error('existing_database_rows_changed')
const installed=process.argv.includes('--install')
if(installed)sql('begin;\n'+migration+'\ncommit;\n')
const result={date:'2026-10-31',directory:path.relative(root,out),target:container,port:56322,installed,existing,suite:tests,enabled:false,
 checks:(probe.match(/^ok \d+/gm)??[]).length,existingTablesCompared:Object.keys(first).length,
 existingRowsPreserved:true,syntheticRecordsRolledBack:true,modelCalls:0,paidCostUsd:0,productionChanges:0}
await fs.writeFile(path.join(out,'db-result.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
