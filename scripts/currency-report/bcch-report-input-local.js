// Local report input only. Plan/replay never read a credential or call a model.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { collectBcchApi, parseBcchTokenFile, validateProbeRange } from './bcch-api.js'
import { BCCH_METHOD } from './clp-official-price.js'
import { prepareBcchReportInput } from './bcch-report-input.js'

async function main() {
  const {values}=parseArgs({options:{mode:{type:'string',default:'plan'},input:{type:'string'},methodology:{type:'string'},
    'as-of':{type:'string'},'through-session':{type:'string'},first:{type:'string'},last:{type:'string'},powershell:{type:'string'}},strict:true})
  if (!['plan','replay','collect'].includes(values.mode)) throw new Error('invalid_bcch_input_mode')
  if (values.mode==='plan') {
    console.log(JSON.stringify({mode:'plan',sourceAdapter:'bcch-bde-api/1',networkRequests:0,tokenRead:false,
      maxCollectionRequests:1,retries:0,modelCalls:0,publicationApproved:false}));return
  }
  const privateRoot=await fs.realpath('.local-reports/private')
  async function privateRead(file) {
    const resolved=await fs.realpath(file??'')
    const relative=path.relative(privateRoot,resolved)
    if (!relative || relative==='..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
      throw new Error('private_input_required')
    const stat=await fs.stat(resolved)
    if (!stat.isFile() || stat.size>2_000_000) throw new Error('private_input_oversize')
    return fs.readFile(resolved)
  }
  const methodologySha256=createHash('sha256').update(await privateRead(values.methodology)).digest('hex')
  if (methodologySha256!==BCCH_METHOD.sha256) throw new Error('bcch_methodology_changed')
  if (values.mode==='collect') validateProbeRange(values.first,values.last)
  const directory=await fs.mkdtemp(path.join(privateRoot,'bcch-report-input-'))
  const save=(name,value)=>fs.writeFile(path.join(directory,`${name}.json`),JSON.stringify(value,null,2),{flag:'wx'})
  await save('request',{mode:values.mode,status:'reserved',maxRequests:values.mode==='collect'?1:0,retries:0,
    seriesId:BCCH_METHOD.seriesId,firstDate:values.first??null,lastDate:values.last??null,credentialOmitted:true})
  try {
    let snapshot
    if(values.mode==='replay') snapshot=JSON.parse((await privateRead(values.input)).toString('utf8'))
    else {
      const stat=await fs.stat('.env.bcch.local')
      if(!stat.isFile() || stat.size>10000) throw new Error('invalid_token_file')
      const token=parseBcchTokenFile(await fs.readFile('.env.bcch.local','utf8'))
      snapshot=await collectBcchApi({token,firstDate:values.first,lastDate:values.last,powershell:values.powershell})
      await save('source-snapshot',snapshot)
    }
    const result=prepareBcchReportInput(snapshot,{methodologySha256,asOf:values['as-of']??snapshot.capturedAt,
      throughSessionDate:values['through-session']})
    await save('research-input',result)
    console.log(JSON.stringify({directory,mode:values.mode,reportDate:result.packet.baseDate,
      actualTransactionDate:result.packet.observedDate,spot:result.packet.facts.find(f=>f.id==='spot'),
      questions:result.questionPlan.questions.map(q=>({id:q.id,...q.timeScope})),
      networkRequests:values.mode==='collect'?1:0,tokenRead:values.mode==='collect',modelCalls:0,newApiCostUsd:0,
      writingEligibility:result.writingEligibility,publicationApproved:false},null,2))
  } catch(error) {
    const reason=/^[a-z_]+$/.test(error.message)?error.message:'bcch_report_input_failed'
    await save('failure',{status:'failed',reason,retries:0,publicationApproved:false})
    throw new Error(reason)
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error=>{console.error(`bcch_report_input_failed:${/^[a-z_]+$/.test(error.message)?error.message:'local_io_failed'}`);process.exitCode=1})
