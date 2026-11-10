// A fresh schema clone in the existing isolated container. No production reads,
// no mutation/reset of the working local DB, no provider or email transport.
import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
const container='supabase_db_latamfx-2x-isolated'
const target='latamfx_runtime_clean_'+randomBytes(6).toString('hex')
const directory=await fs.mkdtemp('.local-reports/private/runtime-document-db-')
const run=(args,input)=>{
 const r=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024})
 if(r.status!==0)throw Error((r.stderr??'isolated database unavailable').slice(0,1600))
 return r.stdout
}
const ports=JSON.parse(run(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
if(!ports['5432/tcp']?.some(p=>p.HostPort==='56322'))throw Error('isolated_database_required')
const dump=run(['exec',container,'pg_dump','-U','postgres','-d','postgres','--schema-only'])
run(['exec',container,'createdb','-U','postgres','-T','template0',target])
const sql=text=>run(['exec','-i',container,'psql','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d',target],text)
const results=[]
try{
 // Restore ownership/privileges using the local platform's bootstrap role;
 // execute the tests below as the ordinary migration role, postgres.
 run(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d',target],
  dump.replaceAll('CREATE SCHEMA public;','CREATE SCHEMA IF NOT EXISTS public;'))
 sql('insert into app_private.currency_report_runtime_control(singleton) values(true);insert into app_private.usage_settings(singleton) values(true);')
 for(const name of (await fs.readdir('supabase/tests')).filter(n=>n.endsWith('.sql')).sort()){
  const output=sql(await fs.readFile('supabase/tests/'+name,'utf8'))
  await fs.writeFile(directory+'/'+name+'.tap',output)
  const cases=[...output.matchAll(/^ok \d+\b/gm)].length
  const failed=/^not ok\b|Looks like you failed|Failed test/m.test(output)
  results.push({file:name,cases,passed:!failed})
  if(failed)throw Error('database_regression_failed:'+name)
 }
 const result={target,directory,files:results.length,cases:results.reduce((n,r)=>n+r.cases,0),results,
  isolation:'fresh schema clone; original local records untouched',actualModelCalls:0,productionChanges:0}
 await fs.writeFile(directory+'/result.json',JSON.stringify(result,null,2))
 console.log(JSON.stringify({...result,results:undefined}))
}finally{
 // Keep the evidence database recoverable, but stop accidental future use.
 run(['exec',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',`ALTER DATABASE ${target} ALLOW_CONNECTIONS false`])
}
