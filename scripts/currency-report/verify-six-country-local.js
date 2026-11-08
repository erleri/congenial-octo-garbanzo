// Local DB contract probe. New synthetic attempts only; no historical manuscript edits.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {assertLocalApi,syntheticDbReport} from './local-db.js'

async function main(){
  const cfg=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
  const url=assertLocalApi(cfg.url),accounts=JSON.parse(await fs.readFile('.local-reports/private/local-db/accounts.json','utf8'))
  const options={auth:{persistSession:false,autoRefreshToken:false}}
  const client=key=>createClient(url,key,options)
  const service=client(cfg.serviceKey),anon=client(cfg.anonKey),admin=client(cfg.anonKey),other=client(cfg.anonKey),reader=client(cfg.anonKey)
  const ok=r=>{assert.equal(r.error,null);return r.data}
  const checks=[],countries=[],created=[]
  const check=(name,value)=>{assert.ok(value,name);checks.push(name)}
  const priorAdmin=ok(await service.from('business_plan_admins').select('active').eq('email',accounts.admin.email).single()).active
  assert.equal(priorAdmin,true,'local_test_admin_must_already_be_active')
  const before=ok(await anon.from('currency_reports').select('run_id,report').order('run_id'))
  let revoked=false
  try{
    ok(await admin.auth.signInWithPassword(accounts.admin));ok(await other.auth.signInWithPassword(accounts.admin));ok(await reader.auth.signInWithPassword(accounts.reader))
    const privateAnon=await anon.from('currency_report_runs').select('id')
    check('anon_private_hidden',!!privateAnon.error||privateAnon.data.length===0)
    check('non_admin_private_hidden',ok(await reader.from('currency_report_runs').select('id')).length===0)
    for(const currency of ['BRL','MXN','CLP','COP','PEN','ARS']){
      const baseDate='2098-11-28',attempts=ok(await service.from('currency_report_runs').select('attempt').eq('currency',currency).eq('base_date',baseDate))
      const attempt=Math.max(0,...attempts.map(r=>r.attempt))+1,id=randomUUID()
      const insert=await service.from('currency_report_runs').insert({id,currency,base_date:baseDate,attempt,rule_version:'six-country-local-probe/1',
        event_binding:'synthetic-only',packet:{raw:'PRIVATE_FIXTURE_ORIGINAL'},candidate:syntheticDbReport(currency,baseDate,attempt),
        validation:{structureValid:true,contentReview:'passed',criticalErrors:0,qualityAverage:4,evidenceScore:4,synthetic:true},cost:{costUsd:0,modelCalls:0}})
      if(insert.error){countries.push({currency,status:'blocked',databaseCode:insert.error.code,reason:insert.error.code==='23514'?'currency_constraint_not_expanded':'local_insert_failed'});continue}
      created.push(id)
      check(currency+'_reader_approval_denied',(await reader.rpc('review_currency_report',{p_run_id:id,p_decision:'approved'})).error?.code==='42501')
      const concurrent=await Promise.all([admin,other].map(c=>c.rpc('review_currency_report',{p_run_id:id,p_decision:'approved'})))
      check(currency+'_one_approval',concurrent.filter(r=>!r.error&&r.data==='published').length===1&&concurrent.some(r=>r.error?.code==='55000'))
      check(currency+'_one_audit',ok(await service.from('currency_report_reviews').select('id').eq('run_id',id)).length===1)
      const published=ok(await anon.from('currency_reports').select('report').eq('run_id',id).single()).report
      check(currency+'_public_sanitized',published.testOnly===true&&!JSON.stringify(published).includes('PRIVATE_FIXTURE_'))
      ok(await admin.rpc('review_currency_report',{p_run_id:id,p_decision:'withdrawn',p_reason:'Synthetic local verification complete.'}))
      check(currency+'_withdrawn_hidden',ok(await anon.from('currency_reports').select('run_id').eq('run_id',id)).length===0)
      countries.push({currency,status:'local_contract_passed',synthetic:true})
    }
    ok(await service.from('business_plan_admins').update({active:false}).eq('email',accounts.admin.email));revoked=true
    check('existing_session_revocation',ok(await admin.from('currency_report_runs').select('id')).length===0)
    check('revoked_review_denied',(await admin.rpc('review_currency_report',{p_run_id:created[0],p_decision:'rejected'})).error?.code==='42501')
  }finally{
    if(revoked)ok(await service.from('business_plan_admins').update({active:priorAdmin}).eq('email',accounts.admin.email))
    // Preserve audit history and withdraw only our new test attempts if interrupted.
    for(const id of created){const visible=ok(await anon.from('currency_reports').select('run_id').eq('run_id',id));
      if(visible.length)ok(await admin.rpc('review_currency_report',{p_run_id:id,p_decision:'withdrawn',p_reason:'Interrupted synthetic probe cleanup.'}))}
    await Promise.all([admin,other,reader].map(c=>c.auth.signOut()))
  }
  const loggedOut=await admin.from('currency_report_runs').select('id')
  check('logout_private_hidden',!!loggedOut.error||loggedOut.data.length===0)
  assert.deepEqual(ok(await anon.from('currency_reports').select('run_id,report').order('run_id')),before)
  check('previous_public_reports_unchanged',true)
  const directory=await fs.mkdtemp('.local-reports/private/six-country-db-')
  const result={checkedAt:new Date().toISOString(),countries,checks,modelCalls:0,newPaidCostUsd:0,productionChanged:false,synthetic:true}
  await fs.writeFile(directory+'/result.json',JSON.stringify(result,null,2),{flag:'wx'})
  console.log(JSON.stringify({directory,...result}))
}
main().catch(()=>{console.error('local_six_country_contract_probe_failed');process.exitCode=1})
