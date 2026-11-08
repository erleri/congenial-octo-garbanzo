// Local-only entry point. Reads no env or keys, writes new private directories.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {planResearchSourceSelection,compileResearchSourceCatalog,countryNewsCollectionSources} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {saveChileMonthlyCapture} from './chile-monthly-store.js'
import {beginManagedOutput,completeManagedOutput,verifyManagedFile} from './managed-output.js'

export async function collectSelectedLocal({input,sources,saved,url,mode='saved',workspace=process.cwd(),fetchImpl=fetch,maxNetworkRequests}) {
  const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
  if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('unsafe_private_root')
  async function privateFile(file,maxBytes=5_000_000) {
    const resolved=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,resolved)
    const stat=await fs.stat(resolved)
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!stat.isFile()||stat.size>maxBytes)
      throw new Error('private_input_required')
    return resolved
  }
  const readPrivate=async file=>{const resolved=await privateFile(file);await verifyManagedFile(resolved,{workspace:root});return JSON.parse(await fs.readFile(resolved,'utf8'))}
  const data=await readPrivate(input)
  // Fixed local catalog paths, not a remote configuration or arbitrary endpoint.
  const sourcePlan=JSON.parse(await fs.readFile(path.join(root,'docs/2.0/six-currency-explanation-sources-20261027.json'),'utf8'))
  const sourceRegister=JSON.parse(await fs.readFile(path.join(root,'docs/2.0/six-currency-source-register-20261027.json'),'utf8'))
  const selection=planResearchSourceSelection({input:data,sourcePlan,sourceRegister})
  const selected=sources==='country-news'
    ?countryNewsCollectionSources(selection,compileResearchSourceCatalog(sourcePlan,sourceRegister))
    :typeof sources==='string'?sources.split(','):sources
  if(!Array.isArray(selected)||!selected.length||selected.length>8||new Set(selected).size!==selected.length
    ||selected.some(s=>!selection.sourceRequests.some(r=>r.sourceId===s)))throw new Error('selected_source_ids_required')
  if(url&&selected.length!==1)throw new Error('single_source_for_direct_article_required')
  const captures=[],pdfCaptures=[]
  if(saved) {
    const manifest=await readPrivate(saved)
    if(manifest.version!=='selected-material-cache/1'||!Array.isArray(manifest.captures)||manifest.captures.length>32
      ||!Array.isArray(manifest.monthlyCaptures??[])||(manifest.monthlyCaptures??[]).length>4)throw new Error('invalid_saved_manifest')
    for(const item of manifest.captures) {
      const metadata=await readPrivate(item.metadataFile)
      const text=await fs.readFile(await privateFile(item.bodyFile,2_000_000),'utf8')
      captures.push({sourceId:item.sourceId,url:metadata.url,collectedAt:metadata.collectedAt,httpStatus:metadata.status,
        sha256:metadata.sha256,text})
    }
    for(const location of manifest.monthlyCaptures??[]) {
      const file=path.join(location,'manifest.json'),monthly=await readPrivate(file)
      if(monthly.version!=='chile-monthly-originals/1'||!Array.isArray(monthly.results)||monthly.results.length>2)throw new Error('invalid_saved_monthly_manifest')
      for(const result of monthly.results)for(const original of result.originals??[]) {
        if(!original.file||path.basename(original.file)!==original.file)throw new Error('invalid_saved_monthly_file')
        const raw=await fs.readFile(await privateFile(path.join(location,original.file),2_000_000))
        pdfCaptures.push({...original,sourceId:result.sourceId,rawBase64:raw.toString('base64')})
      }
    }
  }
  const parent=path.join(privateRoot,'selected-source-runs')
  await fs.mkdir(parent,{recursive:true})
  if(await fs.realpath(parent)!==parent||(await fs.lstat(parent)).isSymbolicLink())throw new Error('unsafe_private_output')
  const directory=await fs.mkdtemp(path.join(parent,'collection-')),manifest={version:'selected-material-cache/1',captures:[]},pdfs=[]
  await beginManagedOutput(directory)
  let sequence=0
  const result=await collectSelectedResearch({input:data,sourcePlan,sourceRegister,captures,pdfCaptures,mode,fetchImpl,
    maxNetworkRequests:maxNetworkRequests??(sources==='country-news'?16:8),fairSourceBudgets:sources==='country-news',
    articleUrls:url?[{sourceId:selected[0],url}]:[],
    requestIds:selection.sourceRequests.filter(r=>selected.includes(r.sourceId)).map(r=>r.requestId),checkpoint:async(kind,value)=>{
      if(kind==='capture') {
        const {text,...metadata}=value,prefix=`capture-${sequence++}`
        const body=path.join(directory,`${prefix}.body`),meta=path.join(directory,`${prefix}.json`)
        await fs.writeFile(body,text,{flag:'wx'})
        await fs.writeFile(meta,JSON.stringify({...metadata,status:value.httpStatus},null,2),{flag:'wx'})
        manifest.captures.push({sourceId:value.sourceId,bodyFile:path.relative(root,body),metadataFile:path.relative(root,meta)})
      }
      if(kind==='pdf') {
        const {sourceId,...original}=value
        // Exact existing monthly capture shape: the existing extraction/review
        // command can consume this output; do not invent a parallel PDF parser.
        pdfs.push(await saveChileMonthlyCapture({version:'chile-monthly-originals/1',results:[{sourceId,originals:[original]}]},root))
      }
    }})
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,'review-queue.json'),JSON.stringify({version:result.version,cards:result.reviewQueue,
    monthlyCaptures:pdfs.map(p=>p.directory),publicationApproved:false},null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,'captures.json'),JSON.stringify(manifest,null,2),{flag:'wx'})
  const storageReceipt=await completeManagedOutput({directory,workspace:root,kind:'source_collection',currency:result.currency})
  return {directory:path.relative(root,directory),currency:result.currency,mode,result:result.outcomes.map(o=>({sourceId:o.sourceId,
    status:o.status,reason:o.reason,originals:o.originalIds.length})),pendingReviewCards:result.reviewQueue.length,
    sourceSelection:sources==='country-news'?'all_enabled_country_news':'explicit_source_ids',
    storageReceipt,networkCalls:result.networkCalls,modelCalls:0,newPaidCostUsd:0,publicationApproved:false}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{input:{type:'string'},sources:{type:'string'},saved:{type:'string'},url:{type:'string'},mode:{type:'string'}},strict:true})
  collectSelectedLocal(values).then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{
    console.error('selected_collection_failed: check explicit private input, source selection and saved receipt integrity');process.exitCode=1
  })
}
