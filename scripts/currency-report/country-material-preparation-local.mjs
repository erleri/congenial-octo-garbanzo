// Offline-only entry point. Private reviewed inputs, append-only private output.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {prepareCountryMaterials} from './country-material-preparation.js'

export async function prepareCountryMaterialsLocal({input,workspace=process.cwd()}) {
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
 if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('private_root_required')
 const file=await fs.realpath(path.resolve(root,input)),relative=path.relative(privateRoot,file),stat=await fs.stat(file)
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!stat.isFile()||stat.size>3_000_000)throw new Error('private_material_input_required')
 const config=JSON.parse(await fs.readFile(file,'utf8'))
 if(Object.keys(config).some(k=>!['currency','baseDate','asOf','packet','materials','sourceUse','attempts','causeContext','priceInput','writer','selection'].includes(k)))throw new Error('material_config_fields_required')
 const result=prepareCountryMaterials(config)
 const parent=path.join(privateRoot,'country-material-runs')
 await fs.mkdir(parent,{recursive:true})
 if(await fs.realpath(parent)!==parent)throw new Error('private_output_required')
 const directory=await fs.mkdtemp(path.join(parent,`${result.currency}-`))
 await fs.writeFile(path.join(directory,'prepared.json'),JSON.stringify(result,null,2),'utf8')
 return {directory,status:result.status,currency:result.currency,holds:result.holds,
  modelCalls:0,networkCalls:0,newPaidCostUsd:0,publicationApproved:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const {values}=parseArgs({options:{input:{type:'string'}}})
  if(!values.input)throw new Error('private_input_path_required')
  console.log(JSON.stringify(await prepareCountryMaterialsLocal({input:values.input})))
 }catch {console.error('Local material preparation failed; inspect the private input and review records.');process.exitCode=1}
}
