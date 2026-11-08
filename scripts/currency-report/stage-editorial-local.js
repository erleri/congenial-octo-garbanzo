// One explicitly accepted saved copy, isolated DB only. Never invokes a model.
import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertLocalApi } from './local-db.js'

const file='.local-reports/reviewable/CLP-2026-10-09-1791893507884.json'
const sha=value=>createHash('sha256').update(value).digest('hex')
const bytes=await fs.readFile(file), candidate=JSON.parse(bytes)
assert.equal(candidate.id,'CLP-2026-10-09-1791893507884')
assert.equal(candidate.comparison.editorialRevision,true)
assert.equal(candidate.status,'pending_review')
const cfg=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
const api=assertLocalApi(cfg.url)
const service=createClient(api,cfg.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const existing=await service.from('currency_report_runs').select('id,status,attempt').eq('candidate->>id',candidate.id)
if(existing.error) throw new Error('local_lookup_failed')
if(existing.data.length) { console.log(JSON.stringify({status:'already_staged',runs:existing.data,modelCalls:0,costUsd:0})); process.exit(0) }
const ipc=await fs.readFile('.local-reports/private/source-review-2026-10-11/cl-ipc-followup.html','utf8')
const wage=await fs.readFile('.local-reports/private/source-review-2026-10-11/cl-wage-followup.html','utf8')
assert.ok(ipc.includes('variación mensual de 0,4%') && ipc.includes('seguros y servicios financieros'))
assert.ok(wage.includes('agosto de 2026') && wage.includes('creció 3,4% en doce meses'))
const sources=new Set(candidate.evidence.map(e=>e.id)), facts=new Set(candidate.facts.map(f=>f.id))
for(const claim of [candidate.content.change,...candidate.content.drivers,...candidate.content.implications,...candidate.content.watch]) {
  assert.ok(claim.evidenceIds.every(id=>sources.has(id)) && claim.factIds.every(id=>facts.has(id)))
}
const original=JSON.parse(await fs.readFile('.local-reports/reviewable/CLP-2026-10-09-1791888644987.json','utf8'))
for(const field of ['facts','series','evidence','baseDate','observedDate','marketData']) assert.deepEqual(candidate[field],original[field])
const validation={structureValid:true,contentReview:'passed',criticalErrors:0,qualityAverage:4,evidenceScore:4,
  reviewScope:'historical economic-context brief, not FX causation or sales prediction',
  scores:{explanation:4,change:4,businessRelevance:4,readability:4,evidence:4},
  evaluator:'agent manual review; user accepted edited copy', inheritedScore:3.8,
  findings:['CPI and real-pay claims checked against retained official originals','August and September periods separated','No income/sales outcome or FX cause asserted','Conditional limitations retained'],
  reviewedAt:new Date().toISOString(),inputHash:sha(bytes),ruleVersion:'manual-editorial-local/1'}
const history=await service.from('currency_report_runs').select('attempt').eq('currency','CLP').eq('base_date',candidate.baseDate)
if(history.error) throw new Error('local_history_failed')
const runId=randomUUID(), attempt=Math.max(0,...history.data.map(r=>r.attempt))+1
const staged={...candidate,authorship:'ai_with_manual_edit',comparison:{...candidate.comparison,historicalReview:true}}
const result=await service.from('currency_report_runs').insert({id:runId,currency:'CLP',base_date:candidate.baseDate,attempt,
  rule_version:validation.ruleVersion,event_binding:'accepted-editorial-copy:'+sha(bytes),
  packet:{parentId:original.id,sourceCopyId:candidate.id,sourceHash:sha(bytes),manual:true,localOnly:true},
  candidate:staged,validation,cost:{newCostUsd:0,modelCalls:0,originalGenerationCostUsd:candidate.comparison.costUsd}})
if(result.error) throw new Error('local_stage_failed')
assert.equal(sha(await fs.readFile(file)),sha(bytes))
const dir=await fs.mkdtemp('.local-reports/private/local-approval-')
await fs.writeFile(dir+'/staging.json',JSON.stringify({runId,attempt,reportId:candidate.id,validation,sourceHash:sha(bytes),modelCalls:0,costUsd:0,approved:false},null,2),{flag:'wx'})
console.log(JSON.stringify({runId,attempt,reportId:candidate.id,directory:dir,status:'pending_review',modelCalls:0,costUsd:0}))
