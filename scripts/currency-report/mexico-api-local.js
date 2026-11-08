import fs from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import {readLocalResearchTokens} from './research-credentials-local.js'
import {probeMexicoApi} from './mexico-api.js'

export async function verifyMexicoLocal({workspace=process.cwd(),fetchImpl=fetch}={}) {
  const root=await fs.realpath(workspace),{settings}=await readLocalResearchTokens(root)
  const checks=[]
  for(const [provider,name]of [['banxico','BANXICO_SIE_TOKEN'],['inegi','INEGI_INDICATORS_TOKEN']])
    checks.push(await probeMexicoApi({provider,token:settings[name],fetchImpl}))
  // Persist only projected data. No raw response, credential or request URL.
  let parent=root
  for(const part of ['.local-reports','private','mexico-api-checks']) {
    parent=path.join(parent,part);await fs.mkdir(parent).catch(error=>{if(error.code!=='EEXIST')throw error})
    if((await fs.lstat(parent)).isSymbolicLink()||await fs.realpath(parent)!==parent)throw new Error('private_output_unsafe')
  }
  const directory=await fs.mkdtemp(path.join(parent,'check-'))
  const result={version:'mexico-api-local-check/1',checkedAt:new Date().toISOString(),checks,
    networkCalls:checks.reduce((sum,c)=>sum+c.networkCalls,0),modelCalls:0,newPaidCostUsd:0,productionChanged:false}
  // Defense in depth: no configured token can enter the persisted projection.
  for(const secret of Object.values(settings).filter(Boolean))if(JSON.stringify(result).includes(secret))throw new Error('unsafe_probe_projection')
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2),{flag:'wx'})
  return {directory:path.relative(root,directory),...result}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try{console.log(JSON.stringify(await verifyMexicoLocal(),null,2))}
  catch{console.error('mexico_local_check_failed; credential values and request errors are suppressed');process.exitCode=1}
}
