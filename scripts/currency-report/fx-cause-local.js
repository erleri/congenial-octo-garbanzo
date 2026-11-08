// Local preparation only. Does not load keys or invoke any transport.
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {assessFxCauseInput} from './fx-cause-input.js'
import {prepareEventTrial} from './lifecycle-control.js'

export async function prepareFxCauseLocal(inputFile) {
  const root=await fs.realpath('.local-reports/private'),file=await fs.realpath(inputFile)
  const relative=path.relative(root,file),stat=await fs.stat(file)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!stat.isFile()||stat.size>5_000_000) throw new Error('private_fx_input_required')
  const raw=await fs.readFile(file),data=JSON.parse(raw)
  if(!data.fxCauseInput) throw new Error('explicit_fx_purpose_review_required')
  const assessment=assessFxCauseInput({packet:data.packet,dossier:data.dossier,...data.fxCauseInput})
  const plan=prepareEventTrial(data)
  const directory=await fs.mkdtemp(path.join(root,'fx-cause-preparation-'))
  await fs.writeFile(path.join(directory,'assessment.json'),JSON.stringify(assessment,null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,'trial-input.json'),JSON.stringify({...data,plan,
    approval:{authorized:false,budgetUsd:null}},null,2),{flag:'wx'})
  if(!raw.equals(await fs.readFile(file))) throw new Error('fx_original_input_changed')
  return {directory,status:plan.status,contentReadiness:assessment.contentReadiness,holds:assessment.holds,
    movement:assessment.priceMovement,modelCalls:0,newApiCostUsd:0,publicationApproved:false,
    maximumUsd:plan.maximumUsd??null,requestPrepared:plan.status==='prepared_not_called'}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
  prepareFxCauseLocal(values.input).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{
    console.error(/^[a-z_]+$/.test(e.message)?e.message:'fx_preparation_failed');process.exitCode=1
  })
}
