// Assemble a private, reviewable source tree on the verified operating main.
// No branch checkout/merge, commit, push, build, deploy or configuration writes.
// The daily operating data and generated report visibility flag stay upstream.
import fs from 'node:fs/promises'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {parseArgs} from 'node:util'
const root=await fs.realpath(process.cwd())
const parent=path.join(root,'.local-reports/private/operating-readiness-20261103')
const {values}=parseArgs({options:{baseline:{type:'string'}},strict:true})
const baselineFile=await fs.realpath(values.baseline??path.join(parent,'baseline.json'))
if(!baselineFile.startsWith(parent+path.sep)||path.extname(baselineFile)!=='.json')throw Error('private_verified_baseline_required')
const baseline=JSON.parse(await fs.readFile(baselineFile,'utf8'))
const run=(exe,args)=>{
 const r=spawnSync(exe,args,{encoding:'utf8',maxBuffer:40000000,windowsHide:true})
 if(r.status!==0)throw Error('local_source_assembly_failed: '+(r.stderr??'').slice(-500))
 return r.stdout
}
const git=(...args)=>run('git',['-c','safe.directory='+root.replaceAll('\\','/'),'-c','core.autocrlf=false',...args])
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
if(git('rev-parse','origin/main').trim()!==baseline.production.commit)throw Error('fresh_verified_operating_main_required')
const remoteChanges=git('diff','--name-only','HEAD...origin/main').trim().split('\n').filter(Boolean)
const protectedPaths=['data/alpha-vantage-history.json','data/fx-full-history.json','public/data.json','src/generated/fxReportConfig.ts']
if(remoteChanges.some(f=>!protectedPaths.includes(f)))throw Error('new_operating_code_requires_conflict_review')
const dir=await fs.mkdtemp(path.join(parent,'release-')),archive=path.join(dir,'operating-main.zip'),target=path.join(dir,'source')
git('archive','--format=zip','--output='+archive,baseline.production.commit)
// Native archive arguments, no shell-built file paths or recursive removals.
await fs.mkdir(target)
run('tar',['-xf',archive,'-C',target])
const excluded=f=>protectedPaths.includes(f)||f.startsWith('data/')||f.startsWith('artifacts/')||f.startsWith('.env')
 ||f.startsWith('public/')&&f.endsWith('.json')||f.startsWith('.local-reports/')
const files=[...new Set(git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean))]
const copied=[]
for(const file of files){
 if(excluded(file))continue
 const src=path.resolve(root,file),dest=path.resolve(target,file)
 if(!src.startsWith(root+path.sep)||!dest.startsWith(target+path.sep))throw Error('source_assembly_scope_required')
 let bytes
 try{bytes=await fs.readFile(src)}catch(error){
  if(error.code!=='ENOENT')throw error
  await fs.unlink(dest).catch(e=>{if(e.code!=='ENOENT')throw e});continue
 }
 await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,bytes)
 copied.push({file,sha256:sha(bytes)})
}
const preserved=[]
for(const file of protectedPaths){
 const bytes=await fs.readFile(path.join(target,file))
 const upstream=git('show',baseline.production.commit+':'+file)
 // git show's decoded text preserves these UTF-8 generated JSON/TS files.
 if(sha(bytes)!==sha(Buffer.from(upstream)))throw Error('operating_generated_data_must_be_preserved')
 preserved.push({file,sha256:sha(bytes)})
}
const manifest={version:'operating-release-source/1',status:'assembled_not_deployed',sourceMain:baseline.production.commit,
 baseline:path.relative(root,baselineFile).replaceAll('\\','/'),baselineSha256:sha(await fs.readFile(baselineFile)),
 localHead:git('rev-parse','HEAD').trim(),source:target,copied,preserved,excludedLocalArtifacts:true,
 credentialsCopied:false,productionWrites:0,paidCalls:0}
await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'})
console.log(JSON.stringify({status:manifest.status,source:target,codeFiles:copied.length,preservedOperatingFiles:preserved.length,
 generatedFeatureFlag:'preserved_from_operating_main',paidCalls:0,productionWrites:0}))
