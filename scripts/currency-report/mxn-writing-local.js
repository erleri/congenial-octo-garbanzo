// Explicit saved preparation. Never reads keys, dispatches or changes a report.
import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {parseBanxicoCloseTable,BANXICO_CLOSE_METHOD} from './mxn-official-price.js'
import {prepareMxnWritingInput,BANXICO_POLICY_REVIEWED} from './mxn-writing-input.js'

export async function prepareMxnWritingLocal({input,workspace=process.cwd()}={}) {
 const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
 if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('private_root_unsafe')
 const readBytes=async(file,max=16_000_000)=>{
  const resolved=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!stat.isFile()||stat.size>max)throw new Error('private_mxn_input_required')
  return fs.readFile(resolved)
 }
 const read=async file=>JSON.parse((await readBytes(file)).toString('utf8'))
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
 const config=await read(input)
 if(config.version!=='mxn-writing-local-input/1')throw new Error('mxn_writing_config_required')
 const table=await readBytes(config.price.tableFile,2_000_000),method=await readBytes(config.price.methodologyFile,2_000_000)
 if(hash(table)!==config.price.tableSha256||hash(method)!==BANXICO_CLOSE_METHOD.sha256)throw new Error('mxn_price_document_changed')
 const priceSnapshot=parseBanxicoCloseTable({raw:table,url:config.price.url,capturedAt:config.price.capturedAt})
 const news={...config.news,collection:await read(config.news.collectionFile),receipt:await read(config.news.receiptFile),useJudgment:await read(config.news.useJudgmentFile)}
 const savedConsumer=await read(config.consumerInputFile)
 if(savedConsumer.version!=='inegi-writing-local-input/1'||savedConsumer.statisticReviews?.length>4||savedConsumer.documents?.length>3)throw new Error('mxn_consumer_config_required')
 const consumer={collection:await read(savedConsumer.collectionFile),statisticReviews:[],releaseReviews:await read(savedConsumer.releaseReviewsFile),sourceUse:await read(savedConsumer.sourceUseFile)}
 for(const r of savedConsumer.statisticReviews)consumer.statisticReviews.push({cardId:r.cardId,receipt:await read(r.receiptFile)})
 const documents=[]
 for(const d of savedConsumer.documents)documents.push({url:d.url,sha256:hash(await readBytes(d.file,2_000_000))})
 if(consumer.releaseReviews.some(r=>!documents.some(d=>d.url===r.url&&d.sha256===r.documentSha256))
  ||consumer.sourceUse.reviews.some(r=>!documents.some(d=>d.url===r.terms.url&&r.terms.version===`sha256:${d.sha256}`)))throw new Error('mxn_consumer_document_changed')
 let policy=null
 if(config.policy) {
  const bytes=await readBytes(config.policy.file,2_000_000)
  if(hash(bytes)!==BANXICO_POLICY_REVIEWED.sha256)throw new Error('mxn_policy_document_changed')
  policy={documentSha256:hash(bytes),collectedAt:config.policy.collectedAt,review:config.policy.review}
 }
 const result=prepareMxnWritingInput({priceSnapshot,throughSessionDate:config.throughSessionDate,asOf:config.asOf,news,consumer,policy,
  contentReview:config.contentReview,priceUseJudgment:await read(config.priceUseJudgmentFile),
  policyUseJudgment:config.policy?await read(config.policy.useJudgmentFile):null,writer:config.writer})
 const parent=path.join(privateRoot,'mxn-writing-runs')
 await fs.mkdir(parent,{recursive:true});if(await fs.realpath(parent)!==parent)throw new Error('private_output_unsafe')
 const directory=await fs.mkdtemp(path.join(parent,'prepare-'))
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
 await fs.writeFile(path.join(directory,'writer-input-preview.json'),JSON.stringify(result.writerPreview??null,null,2),{flag:'wx'})
 return {directory:path.relative(root,directory),status:result.status,holds:result.holds,writerInputPrepared:!!result.writerPreview,
  movement:result.assessment?.priceMovement,decision:null,generationRequest:null,paidCallAuthorized:false,publicationApproved:false,
  networkCalls:0,modelCalls:0,newPaidCostUsd:0,productionChanged:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
 const {values}=parseArgs({options:{input:{type:'string'}},strict:true})
 prepareMxnWritingLocal(values).then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{
  console.error('mxn_writing_preparation_failed; verify saved price, time, scope and use records');process.exitCode=1
 })
}
