import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {prepareSelectedReviewBatch} from './selected-review-batch.js'
import {prepareSelectedNewsReview,runSelectedNewsReviews} from './selected-news-review.js'

export async function reviewSelectedBatchLocal({collection,receipts,news=false,newsResponses,workspace=process.cwd()}) {
  const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
  if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('unsafe_private_root')
  async function read(file) {
    const resolved=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,resolved)
    const stat=await fs.stat(resolved)
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!stat.isFile()||stat.size>16_000_000)
      throw new Error('private_batch_input_required')
    return JSON.parse(await fs.readFile(resolved,'utf8'))
  }
  if(newsResponses&&!news)throw new Error('explicit_news_mode_required')
  const data=await read(collection)
  const responses=newsResponses?await read(newsResponses):[]
  const result=prepareSelectedReviewBatch({collection:data,receipts:receipts?await read(receipts):[],newsResponses:responses})
  const directory=await fs.mkdtemp(path.join(privateRoot,'selected-review-batch-'))
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
  let newsResult
  if(news){
    const bindings=new Set(data.reviewQueue.filter(c=>c.materialKind==='article').map(c=>c.binding))
    if(!Array.isArray(responses)||responses.length>24||new Set(responses.map(r=>r.cardBinding)).size!==responses.length
      ||responses.some(r=>!bindings.has(r.cardBinding)))throw new Error('invalid_saved_news_responses')
    const jobs=[]
    for(const card of data.reviewQueue.filter(c=>c.materialKind==='article')){
      try{jobs.push(prepareSelectedNewsReview({collection:data,card}))}catch{/* Recorded in news result below. */}
    }
    await fs.writeFile(path.join(directory,'news-review-jobs.json'),JSON.stringify(jobs,null,2),{flag:'wx'})
    newsResult=await runSelectedNewsReviews({collection:data,maxReviews:24,
      ...(newsResponses?{reviewer:job=>{
        const saved=responses.find(r=>r.cardBinding===job.cardBinding)
        if(!saved)throw new Error('saved_review_response_missing')
        return saved.response
      }}:{})})
    await fs.writeFile(path.join(directory,'news-review-results.json'),JSON.stringify({...newsResult,
      executionMode:newsResponses?'saved_response_replay':'prepare_only',modelCalls:0,networkCalls:0,newPaidCostUsd:0},null,2),{flag:'wx'})
  }
  return {directory:path.relative(root,directory),currency:result.currency,
    states:result.items.map(i=>({cardId:i.cardId,status:i.status,reason:i.reason})),
    ...(newsResult?{newsReview:{states:newsResult.items.map(i=>({cardId:i.cardId,status:i.status,reason:i.reason})),
      executionMode:newsResponses?'saved_response_replay':'prepare_only',reviewerInvocations:newsResult.reviewerInvocations}}:{}),
    manualUserTasks:[],modelCalls:0,networkCalls:0,newPaidCostUsd:0,publicationApproved:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{collection:{type:'string'},receipts:{type:'string'},news:{type:'boolean'},newsResponses:{type:'string'}},strict:true})
  reviewSelectedBatchLocal(values).then(r=>console.log(JSON.stringify(r))).catch(()=>{
    console.error('selected_review_batch_failed: verify private paths and bound saved receipts');process.exitCode=1
  })
}
