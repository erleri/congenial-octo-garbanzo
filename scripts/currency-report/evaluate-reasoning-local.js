// Explicit offline replay. Writes a NEW private record; never edits manuscripts.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {replayReasoningCases} from './reasoning-replay.js'
import {REASONING_CASES} from './reasoning-cases.js'

globalThis.fetch=()=>{throw Error('offline_only')}
const args=process.argv.slice(2)
if(args.length!==2||args[0]!=='--out')throw Error('usage: node scripts/currency-report/evaluate-reasoning-local.js --out .local-reports/private/NEW-DIRECTORY')
const root=path.resolve('.local-reports/private'),out=path.resolve(args[1]),relative=path.relative(root,out)
if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('private_output_required')
const bundleFile='docs/2.0/clp-news-notes-20260910.json',bytes=await fs.readFile(bundleFile)
const hash=b=>createHash('sha256').update(b).digest('hex'),preserved={[bundleFile]:hash(bytes)}
for(const sample of REASONING_CASES.filter(c=>c.sourceReportId)){
  const file=path.join('.local-reports/reviewable',sample.sourceReportId+'.json'),raw=await fs.readFile(file)
  assert.ok(JSON.stringify(JSON.parse(raw).content).includes(sample.quote),`saved_case_quote_changed:${sample.id}`)
  preserved[file]=hash(raw)
}
const result=replayReasoningCases(JSON.parse(bytes))
const expected={expertComparison:{rewrite:1,keep:2},causalScope:{rewrite:2},observationScope:{keep:2},caveatPlacement:{refine:1,keep:1}}
for(const c of result.cases){
  assert.deepEqual(c.prepared.automatic,{valid:true,errors:[]},c.id)
  assert.deepEqual(c.prepared.editorial.blockers,[],c.id)
  assert.deepEqual(c.errors,[]);assert.equal(c.publicationApproved,false)
}
const counts={}
for(const c of result.cases){const row=counts[c.rule]??={};row[c.adjudication.decision]=(row[c.adjudication.decision]??0)+1}
assert.deepEqual(counts,expected)
for(const [file,checksum]of Object.entries(preserved))assert.equal(hash(await fs.readFile(file)),checksum,file)
await fs.mkdir(out,{recursive:true})
await fs.writeFile(path.join(out,'reasoning-replay.json'),JSON.stringify({createdAt:new Date().toISOString(),...result,preservation:preserved},null,2),{flag:'wx'})
console.log(JSON.stringify({output:path.join(out,'reasoning-replay.json'),cases:result.cases.length,savedCases:6,syntheticBoundaries:3,
  knownJudgmentRouting:counts,modelCalls:0,newApiCostUsd:0,publicationApproved:false,
  limitation:'Offline adjudication and contract checks; not evidence of new model-output quality.'},null,2))
