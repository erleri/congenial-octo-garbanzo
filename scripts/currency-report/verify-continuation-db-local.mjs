// Transactional test against the fixed isolated DB. No model transport,
// credentials, policy activation, migration, public records or committed writes.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {reuseOperatingSources} from './operating-source-cache.js'
import {fingerprint} from './research-harness.js'

const docker=process.platform==='win32'?'C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe':'docker'
const container='supabase_db_latamfx-2x-isolated'
const command=(args,input)=>{
 const r=spawnSync(docker,args,{input,encoding:'utf8',maxBuffer:16000000,windowsHide:true})
 if(r.status!==0)throw Error('isolated_continuation_db_check_failed')
 return r.stdout
}
const ports=JSON.parse(command(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
assert.ok(ports['5432/tcp']?.some(p=>p.HostPort==='56322'),'fixed isolated DB port required')
const sql=text=>command(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-A','-t'],text)
const directory=await fs.mkdtemp('.local-reports/private/continuation-db-')
const snapshot=()=>sql(`select json_build_object(
 'reviews',(select md5(coalesce(string_agg(cache_key||md5(record::text),'|' order by cache_key),'empty')) from app_private.currency_report_operating_source_reviews),
 'control',(select md5(row_to_json(c)::text) from app_private.currency_report_runtime_control c),
 'runs',(select md5(coalesce(string_agg(id::text||md5(row_to_json(r)::text),'|' order by id),'empty')) from public.currency_report_runs r),
 'reports',(select md5(coalesce(string_agg(run_id::text||md5(row_to_json(r)::text),'|' order by run_id),'empty')) from public.currency_reports r),
 'judgments',(select md5(coalesce(string_agg(id::text||md5(row_to_json(r)::text),'|' order by id),'empty')) from public.currency_report_reviews r));`).trim()
const before=snapshot(),nonce=randomUUID(),bad=await operatingFixture({nonce}),send=bad.send
await runOperatingCycle({...bad,execute:true,send:async args=>{
 const response=await send(args)
 if(args.body.response_format.json_schema.name!=='original_news_compare')return response
 const output=JSON.parse(response.payload.choices[0].message.content)
 output.decision='hold';output.limitations=[{kind:'price_basis',blocking:true,reason:'Synthetic conflicting price basis for immutable DB verification.'}]
 return {...response,payload:{choices:[{message:{content:JSON.stringify(output)}}]}}
}})
const good=await operatingFixture({nonce})
await runOperatingCycle({...good,execute:true})
const resolved=await operatingFixture({nonce})
resolved.state.sourceCache=structuredClone([...bad.state.sourceCache,...good.state.sourceCache])
await runOperatingCycle({...resolved,execute:true})
const records=resolved.state.sourceCache
assert.equal(records.length,18)
assert.equal(new Set(records.map(r=>r.key)).size,18)
const quote=v=>"'"+v.replaceAll("'","''")+"'"
const save=r=>`select public.save_currency_report_operating_source_review(${quote(JSON.stringify({...r,serializedSourceReview:JSON.stringify(r)}))}::jsonb);`
const keys=records.map(r=>quote(r.key)).join(',')
const output=sql(`begin; set local role service_role;
${[...records,records[0]].map(save).join('\n')}
select 'RESULT:'||coalesce(jsonb_agg(record)::text,'[]') from app_private.currency_report_operating_source_reviews where cache_key in (${keys});
rollback;`)
const stored=JSON.parse(output.split(/\r?\n/).find(s=>s.startsWith('RESULT:')).slice(7)).map(r=>JSON.parse(r.serializedSourceReview))
assert.equal(stored.length,18)
for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS']){
 const cache=stored.filter(r=>r.currency===currency)
 const reused=reuseOperatingSources(resolved.collections[currency],cache,resolved.state.policy.processingRulesBinding)
 assert.equal(reused.savedSourceReviews.length,1)
 assert.ok(reused.savedSourceReviews[0].receipt)
 assert.equal(fingerprint(cache.find(r=>r.review.heldStatus)),fingerprint(bad.state.sourceCache.find(r=>r.currency===currency)))
}
assert.equal(snapshot(),before,'transaction must preserve existing data and controls')
const result={target:container,port:56322,evidence:'synthetic_protocol_records_not_real_content_quality',
 sixCurrencies:true,rejectionAndSuccessCoexist:true,repeatedSaveDidNotDuplicate:true,
   exactSerializedRecordsPreserved:true,independentlyResolvedEditionSelected:true,allWritesRolledBack:true,
 oldRecordsAndControlsPreserved:true,actualModelCalls:0,actualPaidUsd:0,productionChanges:0}
await fs.writeFile(directory+'/result.json',JSON.stringify(result,null,2),{flag:'wx'})
console.log(JSON.stringify({...result,directory}))
