// Existing service-only cache, fixed isolated DB, rollback-only writes.
// No schema/control changes, real model requests or production destination.
import fs from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import {randomUUID,createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {operatingFixture} from './operating-fixture.js'
import {runOperatingCycle} from './operating-cycle.js'
import {unreviewedSourceCapture,reuseOperatingSources} from './operating-source-cache.js'
const docker=process.platform==='win32'?'C:/Users/접근금지/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe':'docker'
const container='supabase_db_latamfx-2x-isolated'
const command=(args,input)=>{
 const r=spawnSync(docker,args,{input,encoding:'utf8',maxBuffer:16000000,windowsHide:true})
 if(r.status!==0)throw Error('isolated_unattended_check_failed')
 return r.stdout
}
const ports=JSON.parse(command(['inspect','--format','{{json .NetworkSettings.Ports}}',container]))
assert.ok(ports['5432/tcp']?.some(p=>p.HostPort==='56322'))
const sql=text=>command(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-A','-t'],text)
const snapshot=()=>sql(`select json_build_object(
 'reviews',(select md5(coalesce(string_agg(cache_key||md5(record::text),'|' order by cache_key),'empty')) from app_private.currency_report_operating_source_reviews),
 'control',(select md5(row_to_json(c)::text) from app_private.currency_report_runtime_control c),
 'jobs',(select md5(coalesce(string_agg(id::text||md5(row_to_json(j)::text),'|' order by id),'empty')) from app_private.currency_report_runtime_jobs j),
 'reports',(select md5(coalesce(string_agg(run_id::text||md5(row_to_json(r)::text),'|' order by run_id),'empty')) from public.currency_reports r));`).trim()
const before=snapshot(),fixture=await operatingFixture({nonce:randomUUID()}),currency='COP',collection=fixture.collections[currency],rules=fixture.state.policy.processingRulesBinding
const pending=unreviewedSourceCapture(collection,collection.reviewQueue[0].binding,rules)
await runOperatingCycle({...fixture,execute:true})
const reviewed=fixture.state.sourceCache.find(r=>r.currency===currency)
assert.equal(pending.sourceKey,reviewed.sourceKey)
const quote=value=>"'"+value.replaceAll("'","''")+"'"
const serialize=r=>quote(JSON.stringify({...r,serializedSourceReview:JSON.stringify(r)}))+'::jsonb'
const pendingSql=serialize(pending),reviewedSql=serialize(reviewed),cache=`public.currency_report_operating_source_cache('${currency}','${rules}')`
const probe=sql(`begin;
 set local search_path=public,extensions,pg_catalog;
 select no_plan();
 select ok(not has_function_privilege('anon','public.save_currency_report_operating_source_review(jsonb)','EXECUTE'),'anonymous cannot enqueue raw bodies');
 select ok(not has_function_privilege('authenticated','public.currency_report_operating_source_cache(text,text)','EXECUTE'),'ordinary users cannot read queued raw bodies');
 set local role service_role;
 select lives_ok($statement$select public.save_currency_report_operating_source_review(${pendingSql})$statement$,'service can preserve an unreviewed capture');
 select lives_ok($statement$select public.save_currency_report_operating_source_review(${pendingSql})$statement$,'same capture is idempotent');
 select is((select count(*)::integer from jsonb_array_elements(${cache}) r where r->>'key'='${pending.key}'),1,'one queued edition');
 select ok((select r->>'kind'='unreviewed_source_capture' and r->'review'->>'receipt' is null from jsonb_array_elements(${cache}) r where r->>'key'='${pending.key}'),'queued capture has no semantic review receipt');
 select throws_ok($statement$select public.save_currency_report_operating_source_review(jsonb_set(${pendingSql},'{original,url}','"https://invalid.example/changed"'))$statement$,'22023','source review cache is immutable','capture mutation remains forbidden');
 select lives_ok($statement$select public.save_currency_report_operating_source_review(${reviewedSql})$statement$,'real review appends beside queued capture');
 select 'RESTORED:'||${cache}::text;
 select * from finish();
 rollback;`)
assert.ok(!/^not ok\b/m.test(probe)&&/^1\.\.\d+$/m.test(probe),'pgTAP checks must pass')
const restored=JSON.parse(probe.split('\n').find(line=>line.startsWith('RESTORED:')).slice('RESTORED:'.length))
 .filter(r=>r.key===pending.key||r.key===reviewed.key).map(r=>JSON.parse(r.serializedSourceReview))
const reuse=reuseOperatingSources(collection,restored,rules)
assert.equal(reuse.savedSourceReviews.length,1)
assert.ok(reuse.savedSourceReviews[0].receipt)
assert.equal(snapshot(),before,'existing private records/control/jobs/publications must be unchanged')
const directory=await fs.mkdtemp('.local-reports/private/unattended-db-')
const result={target:container,port:56322,checks:(probe.match(/^ok \d+/gm)??[]).length,
 queuedCaptureNotApproval:true,realReviewTakesPrecedence:true,serializedRoundTrip:true,rolledBack:true,
 preservedStateHash:createHash('sha256').update(before).digest('hex'),actualModelCalls:0,actualCostUsd:0,productionChanges:0}
await fs.writeFile(directory+'/result.json',JSON.stringify(result,null,2))
console.log(JSON.stringify({...result,directory}))
