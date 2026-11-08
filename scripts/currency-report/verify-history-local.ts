// Explicit isolated local verification. Public synthetic fixtures only; zero model calls.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {assertLocalApi,syntheticDbReport} from './local-db.js'
import {currencyReportPage,currencyReportPeriods,currencyReportNeighbors,resolveCurrencyReport,latestCurrencySummary} from '../../src/local-report/report-queries'
const directory='.local-reports/private/report-history-20261031'
async function main(){
 const keys=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
 assertLocalApi(keys.url)
 const options={auth:{persistSession:false,autoRefreshToken:false}}
 const service=createClient(keys.url,keys.serviceKey,options),anon=createClient(keys.url,keys.anonKey,options)
 const ok=<T>(r:{data:T;error:unknown})=>{assert.equal(r.error,null);return r.data}
 const publicRows=ok(await service.from('currency_reports').select('*'))
 const originalsFile=directory+'/original-record-hashes.json'
 let originals:{table:string;key:string;hash:string}[]
 try{originals=JSON.parse(await fs.readFile(originalsFile,'utf8'))}catch(error){
  if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error
  const ids=publicRows.map(r=>r.run_id)
  const sources=[{table:'currency_reports',key:'run_id',rows:publicRows},
   {table:'currency_report_runs',key:'id',rows:ok(await service.from('currency_report_runs').select('*').in('id',ids))},
   {table:'currency_report_reviews',key:'id',rows:ok(await service.from('currency_report_reviews').select('*').in('run_id',ids))}]
  originals=sources.flatMap(s=>s.rows.map(r=>({table:s.table,key:String(r[s.key]),hash:createHash('sha256').update(JSON.stringify(r)).digest('hex')})))
  await fs.mkdir(directory,{recursive:true});await fs.writeFile(originalsFile,JSON.stringify(originals,null,2))
 }
 if(process.argv.includes('--seed')){
  const accounts=JSON.parse(await fs.readFile('.local-reports/private/local-db/accounts.json','utf8'))
  const admin=createClient(keys.url,keys.anonKey,options)
  ok(await admin.auth.signInWithPassword(accounts.admin))
  try{for(let i=0;i<65;i++){
   const date=new Date(Date.UTC(2084,11,1+i)).toISOString().slice(0,10),id='HISTORY-UI-CLP-'+date
   const existing=ok(await service.from('currency_reports').select('report').eq('currency','CLP').eq('base_date',date))
   if(existing.length){assert.equal(existing[0].report.id,id);continue}
   const candidate=syntheticDbReport('CLP',date,1);candidate.id=id
   candidate.content.title=`합성 이력 연결 시험 · ${date}`
   candidate.content.summary='AI 미사용 · 페이지·기간·이전/다음 연결을 확인하기 위한 별도 합성 자료입니다.'
   const runId=randomUUID()
   ok(await service.from('currency_report_runs').insert({id:runId,currency:'CLP',base_date:date,attempt:1,rule_version:'history-ui/1',event_binding:'synthetic-only',packet:{synthetic:true},candidate,
    validation:{structureValid:true,contentReview:'passed',criticalErrors:0,qualityAverage:4,evidenceScore:4,synthetic:true},cost:{modelCalls:0,costUsd:0}}))
   ok(await admin.rpc('review_currency_report_version',{p_run_id:runId,p_decision:'approved',p_report_kind:'periodic'}))
  }}finally{await admin.auth.signOut()}
 }
 let concurrentOneWinner=false
 if(process.argv.includes('--concurrency')){
  const accounts=JSON.parse(await fs.readFile('.local-reports/private/local-db/accounts.json','utf8'))
  const admins=[createClient(keys.url,keys.anonKey,options),createClient(keys.url,keys.anonKey,options)]
  await Promise.all(admins.map(async c=>ok(await c.auth.signInWithPassword(accounts.admin))))
  try{
   const date='2086-03-01',existing=ok(await service.from('currency_report_runs').select('attempt').eq('currency','COP').eq('base_date',date))
   const current=ok(await service.from('currency_reports').select('report').eq('currency','COP').eq('base_date',date))
   const attempt=Math.max(0,...existing.map(r=>r.attempt))+1,runIds=[randomUUID(),randomUUID()]
   for(let i=0;i<2;i++){
    const candidate=syntheticDbReport('COP',date,attempt+i);candidate.id='HISTORY-CONCURRENT-'+runIds[i]
    ok(await service.from('currency_report_runs').insert({id:runIds[i],currency:'COP',base_date:date,attempt:attempt+i,rule_version:'history-concurrency/1',event_binding:'synthetic-only',packet:{synthetic:true},candidate,
     validation:{structureValid:true,contentReview:'passed',criticalErrors:0,qualityAverage:4,evidenceScore:4,synthetic:true},cost:{modelCalls:0,costUsd:0}}))
   }
   const outcomes=await Promise.all(admins.map((client,i)=>client.rpc('review_currency_report_version',{p_run_id:runIds[i],p_decision:'approved',p_expected_public_id:current[0]?.report.id??null,p_revision_kind:current.length?'replacement':null})))
   assert.equal(outcomes.filter(r=>!r.error&&r.data==='published').length,1)
   assert.equal(outcomes.filter(r=>r.error?.code==='55000').length,1)
   const winner=outcomes.findIndex(r=>!r.error)
   ok(await admins[winner].rpc('review_currency_report_version',{p_run_id:runIds[winner],p_decision:'withdrawn',p_reason:'합성 동시 승인 시험 완료'}))
   ok(await admins[1-winner].rpc('review_currency_report_version',{p_run_id:runIds[1-winner],p_decision:'rejected',p_reason:'합성 중복 승인 차단 확인'}))
   concurrentOneWinner=true
  }finally{await Promise.all(admins.map(c=>c.auth.signOut()))}
 }
 const pages=[],ids=new Set<string>();let cursor:string|undefined
 do{const p=await currencyReportPage(anon,{currency:'CLP',includeTest:true,cursor});pages.push(p.items.length);for(const r of p.items){assert(!ids.has(r.id));ids.add(r.id)}cursor=p.nextCursor??undefined}while(cursor)
 assert.equal([...ids].filter(id=>id.startsWith('HISTORY-UI-')).length,65)
 const old=await resolveCurrencyReport(anon,'CLP','2084-12-01','HISTORY-UI-CLP-2084-12-01',true)
 assert.equal(old.state,'active');assert(old.report?.testOnly)
 assert.equal((await resolveCurrencyReport(anon,'CLP','2084-12-01')).state,'not_found')
 const real=await resolveCurrencyReport(anon,'CLP','2026-10-09')
 assert.equal(real.report?.id,'CLP-2026-10-09-1791893507884');assert(real.report.historicalReview)
 assert.equal(await latestCurrencySummary(anon,'CLP'),null)
 const periods=await currencyReportPeriods(anon,'CLP',true)
 for(const p of ['2084-12','2085-01','2085-02'])assert(periods.includes(p))
 const december=await currencyReportPage(anon,{currency:'CLP',year:2084,month:12,includeTest:true})
 assert.equal(december.items.length,30);assert(december.nextCursor)
 const rest=await currencyReportPage(anon,{currency:'CLP',year:2084,month:12,includeTest:true,cursor:december.nextCursor})
 assert.equal(rest.items.length,1);assert.equal(rest.nextCursor,null)
 const neighbors=await currencyReportNeighbors(anon,'CLP','2084-12-01',{year:2084},true)
 assert.equal(neighbors.older,null);assert.equal(neighbors.newer?.baseDate,'2084-12-02')
 assert((await anon.from('currency_report_runs').select('id').limit(1)).error)
 for(const row of originals){
  const key=row.table==='currency_reports'?'run_id':'id'
  const current=ok(await service.from(row.table).select('*').eq(key,row.key).single())
  assert.equal(createHash('sha256').update(JSON.stringify(current)).digest('hex'),row.hash,`${row.table} original changed`)
 }
 const result={checkedAt:new Date().toISOString(),status:'passed',syntheticDates:65,pages,duplicateIds:0,oldDirectLink:true,periodFilters:true,neighbors:true,concurrentOneWinner,actualHistoricalBodyPreserved:true,originalRecordHashes:originals.length,privateReadDenied:true,modelCalls:0,productionWrites:0}
 await fs.writeFile(directory+'/rest-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
main().catch(()=>{console.error('Isolated history verification failed; no credentials printed.');process.exitCode=1})
