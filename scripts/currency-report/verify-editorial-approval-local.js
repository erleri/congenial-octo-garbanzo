// Reads the real local acceptance result; no publication or model calls.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertLocalApi } from './local-db.js'
const dir='.local-reports/private/local-approval-aJ3zMb'
const staged=JSON.parse(await fs.readFile(dir+'/staging.json','utf8'))
const source=await fs.readFile('.local-reports/reviewable/'+staged.reportId+'.json')
assert.equal(createHash('sha256').update(source).digest('hex'),staged.sourceHash)
const candidate=JSON.parse(source),cfg=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
const api=assertLocalApi(cfg.url),options={auth:{persistSession:false,autoRefreshToken:false}}
const anon=createClient(api,cfg.anonKey,options),service=createClient(api,cfg.serviceKey,options)
const pub=await anon.from('currency_reports').select('report').eq('run_id',staged.runId).single()
assert.equal(pub.error,null)
assert.equal(pub.data.report.status,'approved')
assert.equal(pub.data.report.authorship,'ai_with_manual_edit')
assert.equal(pub.data.report.historicalReview,true)
for(const key of ['content','facts','series','baseDate','observedDate','marketData']) assert.deepEqual(pub.data.report[key],candidate[key])
assert.deepEqual(pub.data.report.evidence.map(e=>[e.id,e.url,e.period]),candidate.evidence.map(e=>[e.id,e.url,e.period]))
assert.ok(!pub.data.report.comparison && !pub.data.report.validation && !pub.data.report.packet)
const audits=await service.from('currency_report_reviews').select('decision').eq('run_id',staged.runId)
assert.deepEqual(audits.data,[{decision:'approved'}])
const privateRead=await anon.from('currency_report_runs').select('id')
assert.ok(privateRead.error || privateRead.data.length===0)
const accounts=JSON.parse(await fs.readFile('.local-reports/private/local-db/accounts.json','utf8'))
const admin=createClient(api,cfg.anonKey,options),reader=createClient(api,cfg.anonKey,options)
assert.equal((await admin.auth.signInWithPassword(accounts.admin)).error,null)
assert.equal((await reader.auth.signInWithPassword(accounts.reader)).error,null)
assert.equal((await admin.rpc('review_currency_report',{p_run_id:staged.runId,p_decision:'approved'})).error?.code,'55000')
assert.equal((await reader.rpc('review_currency_report',{p_run_id:staged.runId,p_decision:'approved'})).error?.code,'42501')
assert.deepEqual((await reader.from('currency_report_runs').select('id')).data,[])
await Promise.all([admin.auth.signOut(),reader.auth.signOut()])
const result={checkedAt:new Date().toISOString(),reportId:staged.reportId,status:'passed',publicContentMatches:true,
  originalUnchanged:true,privateAccessDenied:true,duplicateApprovalBlocked:true,oneAuditRecord:true,authorshipPreserved:true,modelCalls:0,costUsd:0}
await fs.writeFile(dir+'/verification.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
