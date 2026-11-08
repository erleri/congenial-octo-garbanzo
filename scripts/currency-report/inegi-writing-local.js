// Saved files only. No network/credentials/model imports or production writes.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {prepareInegiConsumerContext} from './inegi-writing-context.js'
import {previewEconomicConsumerInput} from './economic-update.js'

export async function prepareInegiWritingLocal({input,workspace=process.cwd()}={}) {
  const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
  if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('private_root_unsafe')
  const readBytes=async(file,max=5_000_000)=>{
    const location=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,location),stat=await fs.stat(location)
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!stat.isFile()||stat.size>max)throw new Error('private_input_required')
    return fs.readFile(location)
  }
  const read=async file=>JSON.parse((await readBytes(file)).toString('utf8'))
  const config=await read(input)
  if(config.version!=='inegi-writing-local-input/1'||!Array.isArray(config.statisticReviews)||config.statisticReviews.length>4
    ||!Array.isArray(config.documents)||!config.documents.length||config.documents.length>3)throw new Error('inegi_writing_config_required')
  const packet=await read(config.packetFile),collection=await read(config.collectionFile),releaseReviews=await read(config.releaseReviewsFile),sourceUse=await read(config.sourceUseFile)
  const statisticReviews=[]
  for(const r of config.statisticReviews)statisticReviews.push({cardId:r.cardId,receipt:await read(r.receiptFile)})
  const documents=[]
  for(const document of config.documents) {
    const bytes=await readBytes(document.file,2_000_000),sha256=createHash('sha256').update(bytes).digest('hex')
    documents.push({url:document.url,sha256})
  }
  if(releaseReviews.some(r=>!documents.some(d=>d.url===r.url&&d.sha256===r.documentSha256))
    ||sourceUse.reviews.some(r=>!documents.some(d=>d.url===r.terms.url&&r.terms.version===`sha256:${d.sha256}`)))
    throw new Error('inegi_policy_or_release_document_changed')
  const result=prepareInegiConsumerContext(packet,{collection,statisticReviews,releaseReviews,sourceUse,asOf:config.asOf})
  const preview=result.requestInputFragment?previewEconomicConsumerInput(result.packet,result.context):null
  const parent=path.join(privateRoot,'inegi-writing-runs')
  await fs.mkdir(parent,{recursive:true});if(await fs.realpath(parent)!==parent)throw new Error('private_output_unsafe')
  const directory=await fs.mkdtemp(path.join(parent,'prepare-'))
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,'writer-input-preview.json'),JSON.stringify(preview,null,2),{flag:'wx'})
  return {directory:path.relative(root,directory),status:result.status,holds:result.holds,
    reviewedMaterials:result.items.length,writerInputPrepared:!!preview,nextStage:result.nextStage,
    generationRequest:null,networkCalls:0,modelCalls:0,newPaidCostUsd:0,productionChanged:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
  prepareInegiWritingLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(()=>{
    console.error('inegi_writing_preparation_failed; verify saved source, release and use-review bindings');process.exitCode=1
  })
}
