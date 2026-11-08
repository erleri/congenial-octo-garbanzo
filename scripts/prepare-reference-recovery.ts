// Offline preparation only: Git object verification + saved public-report copy.
// Does not fetch providers, alter FX files, call models or access the database.
import {execFile} from 'node:child_process'
import {promisify,parseArgs} from 'node:util'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {prepareReferenceRecovery} from './dashboard-reference-recovery'

const {values}=parseArgs({options:{'historical-commit':{type:'string'},'production-commit':{type:'string'},sha256:{type:'string'},'public-reports':{type:'string'},output:{type:'string'}}})
const commit=values['historical-commit'],productionCommit=values['production-commit'],expected=values.sha256,publicFile=values['public-reports'],output=values.output
if(!/^[a-f0-9]{40}$/.test(commit??'')||!/^[a-f0-9]{40}$/.test(productionCommit??'')||!/^[a-f0-9]{64}$/.test(expected??'')||!publicFile||!output)throw Error('explicit_git_recovery_inputs_required')
const exec=promisify(execFile),cwd=process.cwd(),path='data/fx-full-history.json' as const
const git=async(args:string[])=>(await exec('git',['-c','safe.directory='+cwd.replaceAll('\\','/'),...args],{cwd,encoding:'utf8',maxBuffer:128*1024*1024})).stdout
await git(['merge-base','--is-ancestor',commit!,productionCommit!])
const [raw,blob,publicRaw]=await Promise.all([git(['show',commit+':'+path]),git(['rev-parse',commit+':'+path]),readFile(resolve(publicFile),'utf8')])
const saved=JSON.parse(publicRaw)
if(saved.readOnly!==true||!Array.isArray(saved.rows))throw Error('saved_public_report_snapshot_required')
const receipt=prepareReferenceRecovery({raw,artifact:{commit:commit!,productionCommit:productionCommit!,path,blob:blob.trim(),sha256:expected!},reports:saved.rows,preparedAt:new Date().toISOString()})
await writeFile(resolve(output),JSON.stringify({version:'dashboard-reference-recovery-set/1',recoveries:[receipt]},null,2)+'\n',{encoding:'utf8',flag:'wx'})
console.log(JSON.stringify({status:'prepared_local_recovery_only',id:receipt.id,artifactCommit:commit,
 currencies:receipt.selections.map(s=>({currency:s.currency,date:s.selected.date,value:s.selected.value,chartPointsMatched:s.matchedChartPoints,providerRecorded:s.provider!==null})),
 paidCalls:0,networkCalls:0,databaseWrites:0}))
