// Reads saved, private review outputs only. No env, outbound transport, DB or model.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {prepareResearchMaterials} from './research-materials.js'
import {beginManagedOutput,completeManagedOutput,verifyManagedFile} from './managed-output.js'

export async function reviewMaterialsLocal({input,monthly,uses,asOf,period,workspace=process.cwd()}) {
  const workspaceRoot=await fs.realpath(workspace),expected=path.join(workspaceRoot,'.local-reports','private')
  const root=await fs.realpath(expected)
  if(root!==expected) throw new Error('private_path_unsafe')
  async function read(file) {
    const resolved=await fs.realpath(path.resolve(workspaceRoot,file)),rel=path.relative(root,resolved),stat=await fs.stat(resolved)
    if(!rel || rel==='..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || !stat.isFile()
      || stat.size>5_000_000 || path.extname(resolved)!=='.json') throw new Error('private_material_input_required')
    await verifyManagedFile(resolved,{workspace:workspaceRoot})
    return JSON.parse(await fs.readFile(resolved,'utf8'))
  }
  const prepared=await read(input),sourceUse=await read(uses),monthlyRun=monthly?await read(monthly):null
  if(monthlyRun && monthlyRun.version!=='chile-monthly-review-run/1') throw new Error('invalid_monthly_material_file')
  const result=prepareResearchMaterials({prepared,sourceUse,monthlyBundles:monthlyRun?.bundles??[],asOf,consumerPeriod:period})
  const directory=await fs.mkdtemp(path.join(root,'research-materials-'))
  await beginManagedOutput(directory)
  const file=path.join(directory,'result.json')
  await fs.writeFile(file,JSON.stringify(result,null,2),{flag:'wx'})
  const storageReceipt=await completeManagedOutput({directory,workspace:workspaceRoot,kind:'research_materials'})
  return {directory:path.relative(workspaceRoot,directory),storageReceipt,file:path.relative(workspaceRoot,file),status:result.materialStatus,
    availableMaterials:result.contentReviewMaterials.length,
    questions:result.questions.map(({id,status,blockedEvidenceIds})=>({id,status,blockedCount:blockedEvidenceIds.length})),
    consumer:result.consumerNeeds?.questions.filter(q=>!q.required).map(({id,status,action})=>({id,status,action}))??[],
    writingEligibility:result.writingEligibility,publicationApproved:false,networkCalls:0,modelCalls:0,newApiCostUsd:0}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{input:{type:'string'},monthly:{type:'string'},uses:{type:'string'},asOf:{type:'string'},period:{type:'string'}},strict:true})
  reviewMaterialsLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{console.error('material_review_failed: verify saved private inputs and explicit use records');process.exitCode=1})
}
