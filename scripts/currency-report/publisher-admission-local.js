// Saved-input-only runner. No credentials, outbound transport or manuscript writes.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {collectOriginal} from './public-research-adapter.js'
import {admissionHash,publisherReviewTemplate,preparePublisherAdmission} from './publisher-admission.js'

export async function reviewPublisherLocal({input,research:researchFile,ledger:ledgerFile,receipt:receiptFile,workspace=process.cwd()}) {
  const workspaceRoot=await fs.realpath(workspace),expected=path.join(workspaceRoot,'.local-reports','private')
  const root=await fs.realpath(expected)
  if(root!==expected) throw new Error('private_path_unsafe')
  async function read(file,max=3_000_000) {
    const resolved=await fs.realpath(path.resolve(workspaceRoot,file)),rel=path.relative(root,resolved)
    if(!rel || rel==='..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
      || !(await fs.stat(resolved)).isFile() || (await fs.stat(resolved)).size>max) throw new Error('private_input_required')
    return fs.readFile(resolved)
  }
  const json=async file=>JSON.parse((await read(file)).toString('utf8'))
  const {packet}=await json(input),research=await json(researchFile),ledger=await json(ledgerFile)
  if(!Array.isArray(ledger) || ledger.length>16 || new Set(ledger.map(r=>r.url)).size!==ledger.length)
    throw new Error('invalid_capture_ledger')
  // Re-extract each admitted-capable source from its saved HTML. A changed
  // extractor/metadata result requires a new review rather than an old receipt.
  for(const original of research.originals) {
    if(original.status!=='collected_pending_review') continue
    const row=ledger.find(r=>r.url===original.url)
    if(row?.status!=='captured' || row.httpStatus!==200 || !/^\d{3}\.body$/.test(row.file??'')) throw new Error('capture_not_available')
    const raw=await read(path.join(path.dirname(path.resolve(workspaceRoot,ledgerFile)),row.file),4_000_000)
    const hash=createHash('sha256').update(raw).digest('hex')
    if(hash!==row.sha256 || hash!==original.capturedTextSha256 || row.capturedAt!==original.fetchedAt) throw new Error('capture_identity_mismatch')
    const replay=await collectOriginal({candidate:{url:original.url,questionIds:['market']},currency:packet.currency,
      baseDate:packet.baseDate,timeScope:research.timeScope,fetchImpl:async url=>{
        if(String(url)!==original.url) throw new Error('replay_url_mismatch')
        return new Response(raw)
      }})
    if(replay.status!==original.status || replay.bodyHash!==original.bodyHash
      || admissionHash(replay.metadata)!==admissionHash(original.metadata)) throw new Error('original_reextraction_changed')
  }
  const result=receiptFile?preparePublisherAdmission({packet,research,receipt:await json(receiptFile)})
    :publisherReviewTemplate(packet,research)
  const directory=await fs.mkdtemp(path.join(root,'publisher-admission-'))
  const file=path.join(directory,receiptFile?'review-input.json':'receipt-template.json')
  await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx'})
  return {directory,file,status:result.status??'explicit_review_required',
    decisions:result.decisions?.map(({id,decision})=>({id,decision})),
    writingEligibility:result.writingEligibility??{eligible:false},
    networkCalls:0,modelCalls:0,newApiCostUsd:0,publicationApproved:false}
}

async function main() {
  const {values}=parseArgs({options:{input:{type:'string'},research:{type:'string'},ledger:{type:'string'},receipt:{type:'string'}},strict:true})
  console.log(JSON.stringify(await reviewPublisherLocal(values),null,2))
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(e=>{console.error(`publisher_admission_failed:${/^[a-z_]+$/.test(e.message)?e.message:'local_input_or_io_failed'}`);process.exitCode=1})
