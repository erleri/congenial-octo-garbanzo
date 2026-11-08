// Node-only local command. Credentials, AI, operational data and publication are absent.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {collectPublisherResearch} from './publisher-research.js'

async function main() {
  const {values}=parseArgs({options:{mode:{type:'string',default:'plan'},input:{type:'string'},ledger:{type:'string'}},strict:true})
  if(!['plan','replay','collect'].includes(values.mode)) throw new Error('invalid_publisher_research_mode')
  if(values.mode==='plan') {console.log(JSON.stringify({mode:'plan',tokenRead:false,networkCalls:0,modelCalls:0,publicationApproved:false}));return}
  const root=await fs.realpath('.local-reports/private')
  async function readPrivate(file,maxBytes=2_000_000) {
    const resolved=await fs.realpath(file??''),relative=path.relative(root,resolved)
    if(!relative || relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('private_input_required')
    const stat=await fs.stat(resolved)
    if(!stat.isFile() || stat.size>maxBytes) throw new Error('publisher_input_oversize')
    return fs.readFile(resolved)
  }
  const {packet}=JSON.parse((await readPrivate(values.input)).toString('utf8'))
  const directory=await fs.mkdtemp(path.join(root,'publisher-research-'))
  let sequence=0,newNetworkRequests=0
  const sourceTimes=new Map()
  const save=(name,value)=>fs.writeFile(path.join(directory,`${name}.json`),JSON.stringify(value,null,2),{flag:'wx'})
  await save('request',{mode:values.mode,currency:packet?.currency,modelCalls:0,tokenRead:false,retries:0})
  try {
    let fetchImpl
    if(values.mode==='replay') {
      const entries=JSON.parse((await readPrivate(values.ledger)).toString('utf8'))
      if(!Array.isArray(entries) || entries.length>16) throw new Error('invalid_capture_ledger')
      const ledgerDirectory=path.dirname(await fs.realpath(values.ledger))
      for(const row of entries) sourceTimes.set(row.url,row.capturedAt??null)
      fetchImpl=async url=>{
        const row=entries.find(row=>row.url===String(url))
        if(row?.status!=='captured' || !/^\d{3}\.body$/.test(row.file??'') || !/^[a-f0-9]{64}$/.test(row.sha256??''))
          throw new Error('capture_not_available')
        const raw=await readPrivate(path.join(ledgerDirectory,row.file),4_000_000)
        if(createHash('sha256').update(raw).digest('hex')!==row.sha256) throw new Error('capture_hash_mismatch')
        return new Response(raw,{status:row.httpStatus,headers:{'content-type':row.contentType??''}})
      }
    } else fetchImpl=async(url,options)=>{newNetworkRequests++;return fetch(url,options)}
    const result=await collectPublisherResearch({packet,fetchImpl,checkpoint:async(stage,value)=>{
      if(stage==='capture') {
        const id=String(sequence++).padStart(3,'0'),raw=Buffer.from(value.text)
        await fs.writeFile(path.join(directory,`${id}.body`),raw,{flag:'wx'})
        await save(`${id}-capture`,{kind:value.kind,url:value.url,
          capturedAt:values.mode==='replay'?sourceTimes.get(value.url)??null:value.capturedAt,
          ...(values.mode==='replay'?{replayedAt:value.capturedAt,captureMode:'saved_original_replay'}:{}),
          bodyFile:`${id}.body`,decodedUtf8Sha256:createHash('sha256').update(raw).digest('hex')})
      }
    }})
    // Replaying saved originals does not establish a new source retrieval time.
    if(values.mode==='replay') {
      const ledger=JSON.parse((await readPrivate(values.ledger)).toString('utf8'))
      for(const row of result.originals) {
        row.fetchedAt=ledger.find(entry=>entry.url===row.url)?.capturedAt??null
        row.captureMode='saved_original_replay'
      }
    }
    await save('result',{...result,mode:values.mode,adapterReadRequests:result.networkCalls,
      networkCalls:newNetworkRequests,newNetworkRequests,tokenRead:false})
    console.log(JSON.stringify({directory,mode:values.mode,status:result.status,timeScope:result.timeScope,
      candidates:result.discovery.candidates.length,originals:result.originals.map(r=>({url:r.url,status:r.status,reason:r.reason,
        paragraphs:r.blocks?.length??0,metadata:r.metadata,priceTimeRelation:r.priceTimeRelation})),
      sourceResults:result.discovery.sourceResults,newNetworkRequests,modelCalls:0,newApiCostUsd:0,publicationApproved:false},null,2))
  } catch(error) {
    const reason=/^[a-z_]+$/.test(error.message)?error.message:'publisher_research_failed'
    await save('failure',{status:'failed',reason,newNetworkRequests,modelCalls:0,publicationApproved:false})
    throw new Error(reason)
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error=>{console.error(`publisher_research_failed:${/^[a-z_]+$/.test(error.message)?error.message:'local_io_failed'}`);process.exitCode=1})
