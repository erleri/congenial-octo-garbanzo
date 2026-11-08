import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { CHILE_MONTHLY_SOURCES, collectChileMonthlyOriginals } from './chile-monthly-originals.js'
import { saveChileMonthlyCapture } from './chile-monthly-store.js'
import { classifyMonthlyVersion, inspectMonthlyPdf, compareMonthlyText } from './chile-monthly-refresh.js'
import { createIneWindowsTransport } from './ine-windows-transport.js'
const exec = promisify(execFile)

export async function refreshMonthlyLocal({asOf, baseline, python, powershell, workspace = process.cwd(), fetchImpl,pdfTimeoutMs=15000}) {
  if (!asOf || !baseline || !python) throw new Error('explicit_refresh_inputs_required')
  const root = await fs.realpath(workspace), privateRoot = path.join(root,'.local-reports','private')
  async function readPrivate(relative, limit) {
    const resolved = await fs.realpath(path.resolve(root,relative)), rel = path.relative(privateRoot,resolved)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !(await fs.stat(resolved)).isFile() || (await fs.stat(resolved)).size > limit)
      throw new Error('private_refresh_input_unsafe')
    return {resolved,raw:await fs.readFile(resolved)}
  }
  const priorFile = await readPrivate(baseline,1000000), prior = JSON.parse(priorFile.raw.toString('utf8'))
  if (prior.version !== 'chile-monthly-originals/1' || !Array.isArray(prior.results) || prior.results.length > 2)
    throw new Error('invalid_refresh_baseline')
  if(fetchImpl&&powershell) throw new Error('one_monthly_transport_required')
  const transport = powershell ? createIneWindowsTransport(powershell) : null
  const capture = await collectChileMonthlyOriginals({period:'latest',asOf,pdfTimeoutMs,...(fetchImpl?{fetchImpl}:transport ? {fetchImpl:transport.fetchImpl} : {})})
  capture.asOf = asOf
  capture.transport = transport ? {mode:transport.mode,sizeBound:transport.sizeBound} : {mode:fetchImpl?'explicit_injected_transport':'node_fetch',sizeBound:'streamed'}
  const stored = await saveChileMonthlyCapture(capture,root)
  const extract = async (original,raw,file) => inspectMonthlyPdf({original,raw,extract:async () => {
    const {stdout} = await exec(python,['-X','utf8',fileURLToPath(new URL('./extract-monthly-pdf.py',import.meta.url)),file],
      {timeout:20000,maxBuffer:2000000,windowsHide:true,encoding:'utf8'})
    return JSON.parse(stdout)
  }})
  const documents = [], snapshots = []
  for (const source of stored.manifest.results) {
    const previous = prior.results.find(r => r.sourceId === source.sourceId)?.originals ?? []
    for (const original of source.originals ?? []) {
      const version = classifyMonthlyVersion(original,previous)
      let current = {status:'not_extracted',reason:'capture_unavailable'}, old = null
      if (original.file) {
        const file = await readPrivate(path.join(stored.directory,original.file),2000000)
        current = await extract(original,file.raw,file.resolved)
        if (current.extraction) snapshots.push({sourceId:source.sourceId,sha256:original.sha256,extraction:current.extraction})
      }
      const previousDocument = previous.find(p => p.period === original.period && p.file)
      if (previousDocument) {
        if (path.basename(previousDocument.file) !== previousDocument.file) throw new Error('invalid_baseline_pdf_file')
        const file = await readPrivate(path.join(path.dirname(priorFile.resolved),previousDocument.file),2000000)
        old = await extract(previousDocument,file.raw,file.resolved)
      }
      const {extraction, ...extractionStatus} = current
      documents.push({sourceId:source.sourceId,period:original.period,url:original.url,sha256:original.sha256,collectedAt:original.collectedAt,
        captureStatus:original.status,captureReason:original.reason??null,
        version,extraction:extractionStatus,textComparison:compareMonthlyText(current,old),evidenceReady:false,publicationApproved:false})
    }
  }
  if (!(await fs.readFile(priorFile.resolved)).equals(priorFile.raw)) throw new Error('refresh_baseline_changed')
  const summary = {version:'chile-monthly-refresh/1',asOf,capturedAt:capture.collectedAt,captureDirectory:stored.directory,transport:capture.transport,
    sources:stored.manifest.results.map(r => ({sourceId:r.sourceId,status:r.status,reason:r.reason,latestPeriod:r.period ?? null,
      latestBasis:r.latestBasis ?? null,indexCollectedAt:r.indexCollectedAt??null,omittedCandidates:r.omittedCandidates ?? 0,absenceProven:false})),documents,
    status:documents.length === 0 ? 'collection_failed' : documents.length && documents.every(d => d.extraction.status === 'extracted_pending_review')
      && stored.manifest.results.every(r => r.status === 'collected_pending_review') ? 'review_required' : 'partial_or_failed',
    baselineUnchanged:true,networkCalls:capture.networkCalls,modelCalls:0,costUsd:0,evidenceReady:false,
    writingEligibility:'not_assessed',publicationApproved:false}
  await fs.writeFile(path.join(root,stored.directory,'extractions.json'),JSON.stringify(snapshots,null,2),{flag:'wx'})
  await fs.writeFile(path.join(root,stored.directory,'refresh.json'),JSON.stringify(summary,null,2),{flag:'wx'})
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const {values} = parseArgs({options:{live:{type:'boolean',default:false},'as-of':{type:'string'},baseline:{type:'string'},
      python:{type:'string'},powershell:{type:'string'}},strict:true})
    if (!values.live) console.log(JSON.stringify({mode:'plan',sources:CHILE_MONTHLY_SOURCES,networkCalls:0,modelCalls:0}))
    else console.log(JSON.stringify(await refreshMonthlyLocal({asOf:values['as-of'],baseline:values.baseline,python:values.python,powershell:values.powershell}),null,2))
  } catch { console.error('chile_monthly_refresh_failed; prior captures and reports retained'); process.exitCode = 1 }
}
