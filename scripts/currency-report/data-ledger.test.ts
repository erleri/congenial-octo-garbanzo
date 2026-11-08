import {afterEach,describe,expect,it} from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {writeDataBundle,readDataBundle,dataHash} from './data-ledger.js'
import {assessCapacity,assessRetention} from './data-operations-policy.js'
import {saveReport,localReports} from './storage.js'
import {syntheticDbReport} from './local-db.js'
import type {CurrencyReport} from '../../src/types/currencyReport'
import {beginManagedOutput,completeManagedOutput,verifyManagedFile} from './managed-output.js'
const roots:string[]=[]
async function sandbox(){const base=path.resolve('.local-reports/private');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'ledger-test-'));roots.push(root);return root}
afterEach(async()=>{for(const root of roots.splice(0))if(root.startsWith(path.resolve('.local-reports/private')+path.sep))await fs.rm(root,{recursive:true,force:true})})
const bundle={id:'draft-1',kind:'writer_input',currency:'COP',resources:[{id:'card',kind:'evidence',value:{period:'2026-08',source:'test',view:'attributed'}},{id:'plan',kind:'request',value:{ruleVersion:'test/1'}}],edges:[{from:'card',to:'plan',role:'writing_input'}]}
describe('immutable data storage boundary',()=>{
 it('round trips exact source periods and references with a verified receipt without approving content',async()=>{
  const root=await sandbox(),receipt=await writeDataBundle({...bundle,root})
  const loaded=await readDataBundle(receipt.id,{root})
  expect(loaded.resources.card).toEqual(bundle.resources[0].value)
  expect(loaded.manifest.edges).toEqual(bundle.edges)
  expect(loaded.manifest).not.toHaveProperty('publicationApproved')
  expect(loaded.receipt).toEqual(receipt)
  const child=await writeDataBundle({...bundle,root,id:'child',parents:[receipt]})
  await fs.writeFile(path.join(root,loaded.manifest.resources.find(r=>r.id==='card').file),'{}')
  await expect(readDataBundle(child.id,{root})).rejects.toThrow('stored_resource_changed')
 })
 it('reserves a single immutable bundle and detects later tampering',async()=>{
  const root=await sandbox(),results=await Promise.allSettled([writeDataBundle({...bundle,root}),writeDataBundle({...bundle,root})])
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1)
  const loaded=await readDataBundle(bundle.id,{root})
  await fs.writeFile(path.join(root,loaded.manifest.resources.find(r=>r.id==='card').file),'{}')
  await expect(readDataBundle(bundle.id,{root})).rejects.toThrow('stored_resource_changed')
 })
 it('rejects incomplete storage, escaping IDs and dangling dependency edges',async()=>{
  const root=await sandbox();await fs.mkdir(path.join(root,'interrupted'));await fs.writeFile(path.join(root,'interrupted','manifest.json'),'{}')
  await expect(readDataBundle('interrupted',{root})).rejects.toThrow()
  await expect(writeDataBundle({...bundle,root,id:'../outside'})).rejects.toThrow('invalid_data_bundle')
  await expect(writeDataBundle({...bundle,root,edges:[{from:'missing',to:'plan',role:'input'}]})).rejects.toThrow('invalid_data_bundle')
 })
 it('requires completion for new saved reports, preserves originals and keeps broken mirrors out of reads',async()=>{
  const root=await sandbox(),directory=path.join(root,'reviewable'),ledger=path.join(root,'ledger'),options={directory,ledger}
  const report=syntheticDbReport('PEN','2096-01-01',1) as unknown as CurrencyReport
  await saveReport(report,options)
  expect((await localReports(options))[0].id).toBe(report.id)
  const original=await readDataBundle(report.id,{root:ledger})
  expect(original.resources.original).toEqual(report)
  await expect(saveReport(report,options)).rejects.toThrow('report_already_exists')
  await fs.writeFile(path.join(directory,`${report.id}.json`),'{}')
  expect(await localReports(options)).toEqual([])
  expect((await readDataBundle(report.id,{root:ledger})).resources.original).toEqual(report)
 })
 it('blocks interrupted collection output and detects edits after completion without rejecting old files',async()=>{
  const workspace=await sandbox(),dir=path.join(workspace,'.local-reports/private/collection-example')
  await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'result.json');await fs.writeFile(file,'{"source":"fixture"}')
  expect(await verifyManagedFile(file,{workspace})).toEqual({status:'legacy'})
  await beginManagedOutput(dir);await expect(verifyManagedFile(file,{workspace})).rejects.toThrow()
  await completeManagedOutput({directory:dir,workspace,kind:'source_collection',currency:'ARS'})
  expect((await verifyManagedFile(file,{workspace})).status).toBe('complete')
  await fs.writeFile(file,'{}');await expect(verifyManagedFile(file,{workspace})).rejects.toThrow('managed_output_file_changed')
 })
 it('stores repeated resources once and keeps original v1 bundles readable without migrating them',async()=>{
  const root=await sandbox();await Promise.all([writeDataBundle({...bundle,root}),writeDataBundle({...bundle,root,id:'second'})])
  expect((await fs.readdir(path.join(root,'.objects'))).length).toBe(bundle.resources.length)
  const legacy=path.join(root,'legacy');await fs.mkdir(legacy)
  const raw='{"original":"preserved"}';await fs.writeFile(path.join(legacy,'source.json'),raw)
  const manifest=JSON.stringify({version:'report-data-ledger/1',id:'legacy',resources:[{id:'source',file:'source.json',hash:dataHash(raw),bytes:Buffer.byteLength(raw)}]})
  await fs.writeFile(path.join(legacy,'manifest.json'),manifest);await fs.writeFile(path.join(legacy,'complete.json'),JSON.stringify({version:'report-data-ledger/1',id:'legacy',state:'complete',manifestHash:dataHash(manifest)}))
  expect((await readDataBundle('legacy',{root})).resources.source).toEqual({original:'preserved'})
  expect(await fs.readFile(path.join(legacy,'source.json'),'utf8')).toBe(raw)
 })
})
describe('retention and capacity dry run decisions',()=>{
 it('distinguishes expired unused content from references, uncertain costs and conflicting rights without deleting',()=>{
  const base={id:'a',class:'rejected_original',eligibleFrom:'2026-09-01',referenceCount:0,referencesVerified:true,storageAllowed:true,bytes:123}
  const now=Date.parse('2026-10-29T00:00:00Z')
  expect(assessRetention(base,{now})).toMatchObject({status:'cleanup_candidate',delete:false,bytes:123})
  expect(assessRetention({...base,holds:['published_dependency']},{now})).toMatchObject({status:'protected',delete:false})
  expect(assessRetention({...base,costState:'unknown'},{now})).toMatchObject({status:'protected',delete:false})
  expect(assessRetention({...base,referenceCount:1},{now})).toMatchObject({status:'unverified',delete:false})
  expect(assessRetention({...base,storageAllowed:false,holds:['explicit_preserve_request']},{now})).toMatchObject({status:'rights_conflict',reuseAllowed:false,delete:false})
 })
 it('keeps metrics separate, treats unknown quotas as unknown, and never pauses existing FX',()=>{
  const verified={verified:true,period:'current_billing_period',limit:100}
  const result=assessCapacity([{id:'db',...verified,used:20},{id:'egress',...verified,used:85},{id:'actions',used:0},{id:'forecast',...verified,used:60,projected:101}])
  expect(result.items.map(x=>x.status)).toEqual(['within_budget','would_pause_new_reports','unverified','would_warn'])
  expect(result).toMatchObject({activationReady:false,existingFxPaused:false,newReportsActuallyPaused:false})
 })
})
