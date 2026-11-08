import {describe,it,expect,afterEach} from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import {randomBytes,randomUUID} from 'node:crypto'
import {sealRecoveryArchive,openRecoveryArchive,restoreRecoveryFiles,reconcileRecovery,inspectRecoveryReferences} from './recovery.js'
import {writeDataBundle} from './data-ledger.js'

const key=randomBytes(32)
const entry=(name='ledger/file.json')=>({path:name,kind:'ledger',body:Buffer.from('{"synthetic":"PRIVATE_FIXTURE_ORIGINAL"}'),backupAllowed:true,permissionBasis:'owned synthetic recovery test'})
const removed:string[]=[]
async function fresh(){const root=path.resolve('.local-reports/private/recovery-restores');await fs.mkdir(root,{recursive:true});const dir=path.join(root,'test-'+randomUUID());removed.push(dir);return dir}
afterEach(async()=>{for(const dir of removed.splice(0)){if(path.dirname(dir)===path.resolve('.local-reports/private/recovery-restores'))await fs.rm(dir,{recursive:true,force:true})}})
const state={plans:[{id:'save-1',value:900}],reports:[{runId:'report-1',withdrawn:false,hash:'old'}],admins:[{id:'admin-1',active:true}]}
describe('encrypted local recovery boundary',()=>{
 it('round trips binary files and an authenticated manifest without exposing originals',()=>{
  const entries=[entry(),{...entry('database/source.dump'),kind:'database',body:Buffer.from([0,255,0,128])}]
  const sealed=sealRecoveryArchive(entries,{key,id:'round-trip'})
  expect(sealed.archive.includes(Buffer.from('PRIVATE_FIXTURE_ORIGINAL'))).toBe(false)
  expect(openRecoveryArchive(sealed.archive,{key}).entries.map(e=>e.body)).toEqual(entries.map(e=>e.body))
  expect(openRecoveryArchive(sealed.archive,{key}).manifest.entries.every(e=>e.backupAllowed)).toBe(true)
 })
 it('rejects wrong keys, truncation, cipher tampering and authenticated header tampering',()=>{
  const {archive}=sealRecoveryArchive([entry()],{key,id:'auth-test'})
  const bad=Buffer.from(archive);bad[bad.length-1]^=1
  const header=Buffer.from(archive);header[30]^=1
  for(const [bytes,k] of [[archive,randomBytes(32)],[bad,key],[header,key],[archive.subarray(0,50),key]] as const)
   expect(()=>openRecoveryArchive(bytes,{key:k})).toThrow('recovery_archive_invalid_or_key_mismatch')
 })
 it('refuses unknown backup rights, escaping names, credential files and case-colliding entries',()=>{
  for(const rows of [[{...entry(),backupAllowed:false}],[entry('../outside')],[entry('C:/outside')],[entry('x\\y')],
   [entry('.env.report.local')],[entry('connection.json')],[entry('NUL.json')],[entry('a.json'),entry('A.json')]])
   expect(()=>sealRecoveryArchive(rows,{key,id:'deny'})).toThrow('unapproved_or_invalid_backup_entry')
 })
 it('restores only selected verified files into a new private target and refuses reuse',async()=>{
  const target=await fresh(),{archive}=sealRecoveryArchive([entry(),entry('reference/data.json')],{key,id:'files'})
  const receipt=await restoreRecoveryFiles({archive,key,target,paths:['ledger/file.json']})
  expect(receipt.state).toBe('files_verified')
  expect(await fs.readFile(path.join(target,'ledger/file.json'),'utf8')).toContain('PRIVATE_FIXTURE_ORIGINAL')
  await expect(fs.access(path.join(target,'reference/data.json'))).rejects.toThrow()
  await expect(restoreRecoveryFiles({archive,key,target,paths:['ledger/file.json']})).rejects.toThrow()
 })
 it('fails before creating output for an invalid archive or a non-private restore destination',async()=>{
  const target=await fresh(),{archive}=sealRecoveryArchive([entry()],{key,id:'precheck'})
  await expect(restoreRecoveryFiles({archive:archive.subarray(0,30),key,target,paths:['ledger/file.json']})).rejects.toThrow()
  await expect(fs.access(target)).rejects.toThrow()
  await expect(restoreRecoveryFiles({archive,key,target:path.resolve('public/recovered'),paths:['ledger/file.json']})).rejects.toThrow('fresh_private_restore_target_required')
 })
})
describe('restore reconciliation is independent of file integrity',()=>{
 it('holds a perfect old snapshot when current corrections or authority cannot be verified',()=>{
  expect(reconcileRecovery({restored:state,latest:state,dbVerified:true,filesVerified:true})).toMatchObject({status:'hold_unverified',publicReadsAllowed:false,automaticOverwriteAllowed:false})
 })
 it('detects newer plan saves, withdrawals and admin revocations without overwriting any state',()=>{
  const latest={plans:[...state.plans,{id:'save-2',value:950}],reports:[{...state.reports[0],withdrawn:true}],admins:[{id:'admin-1',active:false}]}
  const result=reconcileRecovery({restored:state,latest,latestVerified:true,dbVerified:true,filesVerified:true})
  expect(result).toMatchObject({status:'hold_reconciliation',planChanges:['save-2'],blockedReports:['report-1'],adminChanges:['admin-1'],publicReadsAllowed:false,deleteEnabled:false})
  expect(state.plans).toHaveLength(1)
 })
 it('requires a separate promotion decision even after matching current state and files',()=>{
  const matched={...state,reports:[...state.reports,{runId:'already-withdrawn',withdrawn:true,hash:'kept-audit'}]}
  expect(reconcileRecovery({restored:matched,latest:matched,latestVerified:true,filesVerified:true,dbVerified:true})).toMatchObject({status:'ready_for_separate_promotion_review',publicReadsAllowed:true,automaticPromotionAllowed:false,automaticOverwriteAllowed:false,blockedReports:[]})
 })
 it('treats removed authorities, missing rows and revised report content as reconciliation work',()=>{
  const latest={plans:[],reports:[{...state.reports[0],hash:'new'}],admins:[]}
  expect(reconcileRecovery({restored:state,latest,latestVerified:true,dbVerified:true,filesVerified:true})).toMatchObject({planMissing:['save-1'],blockedReports:['report-1'],removedAdmins:['admin-1'],publicReadsAllowed:false})
  expect(()=>reconcileRecovery({restored:{...state,plans:[...state.plans,...state.plans]},latest})).toThrow('invalid_recovery_state')
 })
})
it('inventories shared objects and broken DB references without deciding that an orphan is deletable',async()=>{
 const root=await fresh();await fs.mkdir(root)
 const input={root,kind:'writer_input',resources:[{id:'card',kind:'evidence',value:{owned:true}}]}
 const first=await writeDataBundle({...input,id:'first'});await writeDataBundle({...input,id:'second',parents:[first]})
 await fs.writeFile(path.join(root,'.objects','unlinked.json'),'{}');await fs.mkdir(path.join(root,'interrupted'))
 const result=await inspectRecoveryReferences({root,dbReferences:[{bundleId:'first',manifestHash:first.manifestHash},{bundleId:'missing',manifestHash:'0'.repeat(64)}]})
 expect(result.objects).toHaveLength(1);expect(result.logicalReferencedBytes).toBe(result.uniqueReferencedBytes*2)
 expect(result.databaseRefs.map(x=>x.status)).toEqual(['verified','missing_or_changed'])
 expect(result.orphans).toEqual([{file:'.objects/unlinked.json',status:'unverified_external_references',delete:false}])
 expect(result.items.find(x=>x.id==='interrupted')).toMatchObject({delete:false,status:'incomplete_or_changed'})
 expect(result).toMatchObject({deleteEnabled:false,cleanupExecutable:false,externalReferencesVerified:false})
})
