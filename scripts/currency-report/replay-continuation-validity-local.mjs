// Actual saved responses, offline only. Preserve old decisions; evaluate reuse
// eligibility separately. No environment/keys, DB or external transport.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {applyMaterialProcessing} from './material-processing.js'
import {completeOriginalNewsReview,prepareOriginalNewsCase} from './original-news-pipeline.js'
import {operatingSourceKey,reuseOperatingSources} from './operating-source-cache.js'
import {fingerprint} from './research-harness.js'
const root='.local-reports/private/stage6-20261102/live-qXNDNm/continuation-1'
const names=['jobs.json','frozen-batch.json','execution-result.json','closeout.json']
const hashInputs=async()=>Object.fromEntries(await Promise.all(names.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex')])))
const before=await hashInputs(),read=async file=>JSON.parse(await fs.readFile(file,'utf8'))
const jobs=await read(path.join(root,'jobs.json')),batch=await read(path.join(root,'frozen-batch.json'))
const frozen=JSON.parse(batch.payload.serializedOperatingPayload),rules=await read('docs/2.0/material-processing-rules.json'),registry=await read('docs/2.0/original-news-source-policy-20261028.json')
const plans=(await read('.local-reports/private/source-readiness-JED93f/prospective-source-plans.json')).plans
let preservedV3=0,knownConflictHeld=false
for(const oldPlan of plans){
 const country=frozen.prepared.privateCountries.find(c=>c.currency===oldPlan.currency),collection=country.collection
 const card=collection.reviewQueue.find(c=>c.binding===oldPlan.cardBinding)
 const sourceUse=applyMaterialProcessing({collection,legacyRegistry:registry,rules,evaluatedOn:frozen.prepared.asOf.slice(0,10)})
 const rebuilt=prepareOriginalNewsCase({collection,card,sourceUse,version:oldPlan.version})
 assert.equal(fingerprint(rebuilt),fingerprint(oldPlan),'historical v3 request must remain byte-bound')
 preservedV3++
 if(country.currency!=='MXN'||!oldPlan.job.url.includes('eleconomista'))continue
 const extraction=jobs.find(j=>j.currency==='MXN'&&j.stage==='writer'&&j.purpose==='original_source_review'&&frozen.prepared.sourcePlans.find(p=>p.binding===j.planBinding)?.job.url===oldPlan.job.url)
 const compare=jobs.find(j=>j.parentId===extraction.id),decode=j=>JSON.parse(j.response.payload.choices[0].message.content)
 if(!compare||!decode(compare).limitations.some(l=>l.kind==='price_basis'&&l.reason.includes('18.7796')))continue
 const originalPlan=frozen.prepared.sourcePlans.find(p=>p.binding===extraction.planBinding)
 const old=completeOriginalNewsReview({collection,card,sourceUse,plan:originalPlan,candidate:decode(extraction),comparison:decode(compare),checkedOn:frozen.prepared.asOf.slice(0,10)})
 assert.equal(old.status,'source_card_prepared') // preserve the historical result, not its current eligibility
 const original=collection.originals.find(o=>o.id===card.originalId)
 const legacy={key:operatingSourceKey(original,fingerprint(rules)),currency:'MXN',rulesBinding:fingerprint(rules),original,card,
  review:{cardBinding:card.binding,receipt:old.receipt,assessment:old.assessment,materialInput:null}}
 const current=reuseOperatingSources(collection,[legacy],fingerprint(rules))
 assert.equal(current.savedSourceReviews.length,0)
 assert(current.collection.reviewRevalidations.some(r=>r.cardBinding===card.binding&&r.reason==='revalidation_required'))
 knownConflictHeld=true
}
assert(knownConflictHeld);assert.deepEqual(await hashInputs(),before)
const directory=await fs.mkdtemp('.local-reports/private/continuation-validity-replay-')
const result={evidence:'saved_real_responses_not_new_quality_test',historicalV3RequestsPreserved:preservedV3,
 knownMxnLegacyVerdictPreservedButReuseHeld:knownConflictHeld,allOldInputHashesPreserved:true,newModelCalls:0,actualPaidUsd:0,productionChanges:0,inputHashes:before}
await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
console.log(JSON.stringify({directory,...result}))
