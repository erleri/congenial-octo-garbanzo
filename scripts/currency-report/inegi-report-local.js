// Explicit local authentication boundary. The generic collector never reads keys.
import fs from 'node:fs/promises'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {pathToFileURL} from 'node:url'
import {readLocalResearchTokens} from './research-credentials-local.js'
import {fetchInegiSeries} from './inegi-api.js'
import {INEGI_REPORT_INDICATORS,inegiScopeMatches,verifyInegiReportSeries} from './inegi-report-indicators.js'
import {planResearchSourceSelection} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'

export async function collectInegiLocal({input,mode='saved',saved,workspace=process.cwd(),fetchImpl=fetch}={}) {
  if(!['saved','live'].includes(mode)||mode==='saved'&&!saved||mode==='live'&&saved)throw new Error('explicit_inegi_mode_required')
  const root=await fs.realpath(workspace),privateRoot=path.join(root,'.local-reports','private')
  if(await fs.realpath(privateRoot)!==privateRoot)throw new Error('unsafe_private_root')
  const read=async file=>{
    const resolved=await fs.realpath(path.resolve(root,file)),relative=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
    if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!stat.isFile()||stat.size>5_000_000)throw new Error('private_input_required')
    return JSON.parse(await fs.readFile(resolved,'utf8'))
  }
  const data=await read(input)
  if(data.packet?.currency!=='MXN')throw new Error('mexico_input_required')
  const sourcePlan=JSON.parse(await fs.readFile(path.join(root,'docs/2.0/six-currency-explanation-sources-20261027.json'),'utf8'))
  const sourceRegister=JSON.parse(await fs.readFile(path.join(root,'docs/2.0/six-currency-source-register-20261027.json'),'utf8'))
  const selection=planResearchSourceSelection({input:data,sourcePlan,sourceRegister})
  const requests=selection.sourceRequests.filter(r=>r.sourceId==='mxn-consumer')
  const scopes=selection.questions.flatMap(q=>q.targets.filter(t=>t.sources.some(s=>requests.some(r=>r.requestId===s.requestId))).map(t=>t.scope))
  const definitions=INEGI_REPORT_INDICATORS.filter(d=>scopes.some(scope=>inegiScopeMatches(scope,d)))
  if(!definitions.length||requests.length>8)throw new Error('exact_inegi_scope_required')
  const checks=[];let settings={}
  if(mode==='live') {
    ;({settings}=await readLocalResearchTokens(root))
    for(const definition of definitions)checks.push(verifyInegiReportSeries(await fetchInegiSeries({
      token:settings.INEGI_INDICATORS_TOKEN,indicatorId:definition.indicatorId,recent:false,fetchImpl})))
  }else {
    const prior=await read(saved)
    if(prior.version!=='inegi-report-local-check/1'||!Array.isArray(prior.checks)||prior.checks.length>3)throw new Error('invalid_inegi_saved_check')
    checks.push(...prior.checks.map(verifyInegiReportSeries))
  }
  const collection=await collectSelectedResearch({input:data,sourcePlan,sourceRegister,requestIds:requests.map(r=>r.requestId),inegiCaptures:checks})
  // Only live checks enter health history; replay must not refresh success time.
  const parent=path.join(privateRoot,mode==='live'?'mexico-api-checks':'selected-source-runs')
  await fs.mkdir(parent,{recursive:true})
  if(await fs.realpath(parent)!==parent)throw new Error('unsafe_private_output')
  const directory=await fs.mkdtemp(path.join(parent,mode==='live'?'check-':'collection-'))
  const result={version:'inegi-report-local-check/1',checkedAt:new Date().toISOString(),mode,checks,
    networkCalls:mode==='live'?checks.reduce((sum,c)=>sum+c.networkCalls,0):0,modelCalls:0,newPaidCostUsd:0,productionChanged:false}
  const output=JSON.stringify({result,collection})
  for(const secret of Object.values(settings).filter(Boolean))if(output.includes(secret)||output.includes(encodeURIComponent(secret)))throw new Error('unsafe_inegi_projection')
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
  await fs.writeFile(path.join(directory,'collection.json'),JSON.stringify(collection,null,2),{flag:'wx'})
  return {directory:path.relative(root,directory),mode,checks:checks.map(c=>({seriesId:c.seriesId,status:c.status,
    dataStatus:c.dataStatus,latestPeriod:c.observations?.at(-1)?.period??null})),outcomes:collection.outcomes.map(o=>({period:o.period,status:o.status,reason:o.reason})),
    pendingReviewCards:collection.reviewQueue.length,networkCalls:result.networkCalls,modelCalls:0,newPaidCostUsd:0,publicationApproved:false}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{input:{type:'string'},mode:{type:'string'},saved:{type:'string'}},strict:true})
  collectInegiLocal(values).then(result=>console.log(JSON.stringify(result,null,2))).catch(()=>{
    console.error('inegi_local_collection_failed; credential values and remote errors suppressed');process.exitCode=1
  })
}
