// Compatibility diagnostic; the source adapter also serves report preparation.
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { BCCH_METHOD } from './clp-official-price.js'
import { parseBcchTokenFile, validateProbeRange, collectBcchApi } from './bcch-api.js'
export { parseBcchTokenFile, validateProbeRange, projectBcchApiResponse } from './bcch-api.js'

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let directory
  try {
    const {values}=parseArgs({options:{live:{type:'boolean',default:false},first:{type:'string'},last:{type:'string'},powershell:{type:'string'}},strict:true})
    if(!values.live)console.log(JSON.stringify({mode:'plan',networkRequests:0,modelCalls:0,tokenRead:false}))
    else {
      validateProbeRange(values.first,values.last)
      const stat=await fs.stat('.env.bcch.local')
      if(!stat.isFile() || stat.size>10000)throw new Error('invalid_token_file')
      const token=parseBcchTokenFile(await fs.readFile('.env.bcch.local','utf8'))
      const privateRoot=await fs.realpath('.local-reports/private')
      directory=await fs.mkdtemp(path.join(privateRoot,'bcch-api-probe-'))
      await fs.writeFile(path.join(directory,'request.json'),JSON.stringify({status:'reserved',seriesId:BCCH_METHOD.seriesId,
        firstDate:values.first,lastDate:values.last,maxRequests:1,retries:0,credentialOmitted:true}),{flag:'wx'})
      const result=await collectBcchApi({token,firstDate:values.first,lastDate:values.last,powershell:values.powershell})
      await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
      console.log(JSON.stringify({directory,authentication:result.authentication,dataStatus:result.dataStatus,
        seriesId:result.seriesId,observations:result.observations.length,latest:result.observations.at(-1),
        missingDates:result.missingDates,networkRequests:1,retries:0,modelCalls:0,newApiCostUsd:0,publicationApproved:false},null,2))
    }
  } catch(error) {
    const reason=/^[a-z_]+$/.test(error.message)?error.message:'bcch_probe_failed'
    if(directory)await fs.writeFile(path.join(directory,'failure.json'),JSON.stringify({status:'failed',reason,retries:0,credentialOmitted:true}),{flag:'wx'}).catch(()=>{})
    console.error(`bcch_api_probe_failed:${reason}`);process.exitCode=1
  }
}
