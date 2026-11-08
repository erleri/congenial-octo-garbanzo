// Explicit saved review receipt -> new local evidence bundle. No remote dispatch.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {reviewSelectedNewsMaterial,reviewSelectedStatisticMaterial} from './selected-material-review.js'
import {beginManagedOutput,completeManagedOutput,verifyManagedFile} from './managed-output.js'

export async function reviewSelectedLocal({collection,card,receipt,workspace=process.cwd()}) {
  const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
  if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('private_root_unsafe')
  async function read(file) {
    const resolved=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!stat.isFile()||stat.size>16_000_000)
      throw new Error('private_review_input_required')
    await verifyManagedFile(resolved,{workspace:root})
    return JSON.parse(await fs.readFile(resolved,'utf8'))
  }
  const original=await read(collection),review=await read(receipt)
  const selected=original.reviewQueue?.find(item=>item.id===card)
  if(!selected)throw new Error('selected_review_card_required')
  const apply=selected.materialKind==='statistic'?reviewSelectedStatisticMaterial:reviewSelectedNewsMaterial
  const result=apply({collection:original,card:selected,receipt:review})
  const parent=path.join(privateRoot,'selected-source-reviews')
  await fs.mkdir(parent,{recursive:true})
  if(await fs.realpath(parent)!==parent||(await fs.lstat(parent)).isSymbolicLink())throw new Error('private_output_unsafe')
  const directory=await fs.mkdtemp(path.join(parent,'review-'))
  await beginManagedOutput(directory)
  await fs.writeFile(path.join(directory,'receipt.json'),JSON.stringify(review,null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,'evidence.json'),JSON.stringify(result,null,2),{flag:'wx'})
  const storageReceipt=await completeManagedOutput({directory,workspace:root,kind:'evidence_review',currency:result.currency})
  return {directory:path.relative(root,directory),storageReceipt,currency:result.currency,evidence:result.evidence.length,
    sourceUseStatus:result.sourceUseStatus,writingEligibility:result.writingEligibility,publicationApproved:false,
    networkCalls:0,modelCalls:0,newPaidCostUsd:0}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{collection:{type:'string'},card:{type:'string'},receipt:{type:'string'}},strict:true})
  reviewSelectedLocal(values).then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{
    console.error('selected_review_failed: verify private receipt, original binding, support references and scope checks');process.exitCode=1
  })
}
