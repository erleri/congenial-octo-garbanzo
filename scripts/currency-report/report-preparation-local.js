// One local pre-generation command. Only BCCh/registered INE source reads.
// OpenRouter credentials, writer transports, DB, publication and email are absent.
import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {parseArgs} from 'node:util'
import {createHash} from 'node:crypto'
import {collectBcchApi,parseBcchTokenFile} from './bcch-api.js'
import {BCCH_METHOD} from './clp-official-price.js'
import {prepareBcchReportInput} from './bcch-report-input.js'
import {refreshMonthlyLocal} from './chile-monthly-refresh-local.js'
import {prepareLatestReportInput,WRITING_ROLES,PREPARATION_VERSION} from './report-preparation.js'
import {summary as reportSummary} from './storage.js'

export function koreanReportCutoff(iso) {
  const value=Date.parse(iso)
  if(!Number.isFinite(value)) throw new Error('invalid_preparation_clock')
  return new Date(value+9*3600000).toISOString().replace('Z','+09:00')
}
const safeError=e=>/^[a-z_]+$/.test(e?.message??'')?e.message:'preparation_stage_failed'

async function savedReportCatalogue(root) {
  const expected=path.join(root,'.local-reports','reviewable'),reports=[],issues=[],hashes={}
  let directory
  try {directory=await fs.realpath(expected)} catch {return {reports,issues:['local_history_unavailable'],hashes}}
  if(directory!==expected) throw new Error('local_history_path_unsafe')
  const files=(await fs.readdir(directory)).filter(f=>/^(BRL|MXN|CLP)-[\d-]+\.json$/.test(f))
  if(files.length>300) throw new Error('local_history_limit')
  for(const file of files) try {
    const resolved=await fs.realpath(path.join(directory,file)),stat=await fs.stat(resolved)
    if(path.dirname(resolved)!==directory||!stat.isFile()||stat.size>5_000_000) throw new Error('invalid_history_file')
    const raw=await fs.readFile(resolved),r=JSON.parse(raw.toString('utf8'))
    hashes[file]=createHash('sha256').update(raw).digest('hex')
    const projected=reportSummary(r)
    reports.push({...projected,sourceHashes:[...new Set((r.evidence??[]).flatMap(e=>
      [e.provenance?.pdfHash,e.sourceContext?.bodyHash].filter(h=>/^[a-f0-9]{64}$/.test(h??''))))]})
  } catch {issues.push(`history_record_unverified:${file}`)}
  return {reports:reports.sort((a,b)=>b.baseDate.localeCompare(a.baseDate)),issues,hashes}
}

export async function prepareReportLocal({config,live=false,python,powershell,workspace=process.cwd(),
  now=()=>new Date().toISOString(),priceCollector=collectBcchApi,monthlyCollector=refreshMonthlyLocal}) {
  const root=await fs.realpath(workspace),expected=path.join(root,'.local-reports','private'),privateRoot=await fs.realpath(expected)
  if(privateRoot!==expected) throw new Error('private_preparation_path_unsafe')
  const preserved=new Map()
  async function read(file,max=5_000_000) {
    const resolved=await fs.realpath(path.resolve(root,file)),rel=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
    if(!rel||rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel)||!stat.isFile()||stat.size>max)
      throw new Error('private_preparation_input_required')
    const raw=await fs.readFile(resolved);preserved.set(resolved,raw);return raw
  }
  const json=async p=>JSON.parse((await read(p)).toString('utf8'))
  const cfg=await json(config)
  const fields=['version','previousPrepared','monthlyReviewed','sourceUse','monthlyBaseline','methodology','priceSnapshot','monthlyRefresh','asOf','history','monthlyTransport','monthlyPdfTimeoutMs']
  if(cfg.version!=='report-preparation-config/1'||Object.keys(cfg).some(k=>!fields.includes(k))
    || cfg.monthlyTransport!==undefined&&!['node','windows'].includes(cfg.monthlyTransport)
    || cfg.monthlyPdfTimeoutMs!==undefined&&(!Number.isInteger(cfg.monthlyPdfTimeoutMs)||cfg.monthlyPdfTimeoutMs<1||cfg.monthlyPdfTimeoutMs>30000)) throw new Error('invalid_preparation_config')
  const previousPrepared=await json(cfg.previousPrepared),reviewedMonthly=await json(cfg.monthlyReviewed),sourceUse=await json(cfg.sourceUse)
  const methodologySha256=createHash('sha256').update(await read(cfg.methodology,2_000_000)).digest('hex')
  if(methodologySha256!==BCCH_METHOD.sha256) throw new Error('bcch_methodology_changed')
  const history=cfg.history?await json(cfg.history):[]
  const catalogue=await savedReportCatalogue(root)
  const directory=await fs.mkdtemp(path.join(privateRoot,'report-preparation-'))
  const save=(name,data)=>fs.writeFile(path.join(directory,`${name}.json`),JSON.stringify(data,null,2),{flag:'wx'})
  const startedAt=now(),startCutoff=live?koreanReportCutoff(startedAt):cfg.asOf
  if(typeof startCutoff!=='string'||!Number.isFinite(Date.parse(startCutoff))) throw new Error('explicit_replay_cutoff_required')
  const stages={},issues=[];let snapshot,refresh,priceInput,priceRequests=0
  await save('request',{version:PREPARATION_VERSION,mode:live?'live_public_and_bcch':'saved_replay',startedAt,
    reportTimeZone:'Asia/Seoul',date:startCutoff.slice(0,10),automaticRetries:0,modelCalls:0,publicationApproved:false})
  if(live) {
    if(!python||!powershell) throw new Error('explicit_local_runtimes_required')
    // Validate the baseline before accessing credentials or starting source reads.
    await json(cfg.monthlyBaseline)
    try {
      const tokenPath=path.join(root,'.env.bcch.local'),stat=await fs.lstat(tokenPath)
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>10000) throw new Error('invalid_token_file')
      const token=parseBcchTokenFile(await fs.readFile(tokenPath,'utf8'))
      const lastDate=startCutoff.slice(0,10),firstDate=new Date(Date.parse(`${lastDate}T00:00:00Z`)-30*86400000).toISOString().slice(0,10)
      priceRequests=1
      snapshot=await priceCollector({token,firstDate,lastDate,powershell})
      await save('price-snapshot',snapshot);stages.priceCapture={status:'collected',requests:1}
    } catch(e) {stages.priceCapture={status:'failed',reason:safeError(e),requests:priceRequests};issues.push(`price:${safeError(e)}`)}
    try {
      refresh=await monthlyCollector({asOf:startCutoff.slice(0,10),baseline:cfg.monthlyBaseline,python,pdfTimeoutMs:cfg.monthlyPdfTimeoutMs??15000,
        ...(cfg.monthlyTransport==='windows'?{powershell}:{}),workspace:root})
      await save('monthly-refresh',refresh);stages.monthlyCapture={status:refresh.status,requests:refresh.networkCalls}
    } catch(e) {stages.monthlyCapture={status:'failed',reason:safeError(e),requests:null};issues.push(`monthly:${safeError(e)}`)}
  } else {
    snapshot=await json(cfg.priceSnapshot);refresh=await json(cfg.monthlyRefresh)
    stages.priceCapture={status:'saved_snapshot',requests:0};stages.monthlyCapture={status:'saved_refresh',requests:0}
  }
  // Earlier refresh summaries did not project download failure details. Read
  // their immutable capture manifest rather than inventing a generic absence.
  if(refresh?.captureDirectory) {
    const manifest=await json(path.join(refresh.captureDirectory,'manifest.json'))
    if(manifest.version!=='chile-monthly-originals/1') throw new Error('invalid_refresh_capture_manifest')
    for(const d of refresh.documents) {
      const source=manifest.results.find(s=>s.sourceId===d.sourceId)
      const original=source?.originals.find(o=>o.url===d.url&&o.period===d.period&&o.sha256===d.sha256)
      if(original) {
        d.captureStatus=original.status;d.captureReason=original.reason??null
      }
    }
  }
  const asOf=live?koreanReportCutoff(now()):cfg.asOf
  if(asOf.slice(0,10)!==startCutoff.slice(0,10)) issues.push('report_date_changed_during_collection')
  if(snapshot) try {
    priceInput=prepareBcchReportInput(snapshot,{methodologySha256,asOf})
    await save('price-input',priceInput);stages.pricePreparation={status:'prepared',actualSessionDate:priceInput.packet.observedDate}
  } catch(e) {stages.pricePreparation={status:'failed',reason:safeError(e)};issues.push(`price_input:${safeError(e)}`)}
  let result
  if(priceInput&&refresh&&!issues.length) try {
    result=prepareLatestReportInput({priceInput,previousPrepared,reviewedMonthly,sourceUse,refresh,asOf,history,reportCatalogue:catalogue})
  } catch(e) {issues.push(`assembly:${safeError(e)}`)}
  if(!result) result={version:PREPARATION_VERSION,asOf,status:'hold_before_generation',holds:issues,
    roles:WRITING_ROLES,stageStatus:{inputAssembly:'partial_or_failed',roleContracts:'defined',semanticReview:'not_run'},
    generationRequest:null,modelCalls:0,newApiCostUsd:0,publicationApproved:false}
  for(const [file,raw] of preserved) if(!(await fs.readFile(file)).equals(raw)) throw new Error('preparation_input_changed')
  for(const [file,h] of Object.entries(catalogue.hashes)) {
    if(createHash('sha256').update(await fs.readFile(path.join(root,'.local-reports','reviewable',file))).digest('hex')!==h)
      throw new Error('history_input_changed')
  }
  await save('history-catalogue',catalogue)
  result.localExecution={mode:live?'live_public_and_bcch':'saved_replay',startedAt,finishedAt:now(),stages,
    priceRequests,monthlyRequests:live?refresh?.networkCalls??null:0,
    protectedInputCount:preserved.size,protectedInputsUnchanged:true,historyRecords:catalogue.reports.length,historyIssues:catalogue.issues,automaticRetries:0,
    credentialRead:live&&priceRequests===1,openRouterCredentialRead:false}
  await save('result',result)
  const summary={directory:path.relative(root,directory),result:path.relative(root,path.join(directory,'result.json')),
    status:result.status,reportDate:result.reportDate??asOf.slice(0,10),priceSessionDate:result.priceSessionDate??null,
    sources:result.selection?.sources??[],comparisonPeriod:result.selection?.comparisonPeriod??null,
    inputAssembly:result.stageStatus.inputAssembly,holds:result.holds,
    modelCalls:0,newApiCostUsd:0,publicationApproved:false,localExecution:result.localExecution}
  await save('summary',summary)
  return summary
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const {values}=parseArgs({options:{config:{type:'string'},live:{type:'boolean',default:false},python:{type:'string'},powershell:{type:'string'}},strict:true})
  prepareReportLocal(values).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{
    console.error(`report_preparation_failed:${safeError(e)}`);process.exitCode=1
  })
}
