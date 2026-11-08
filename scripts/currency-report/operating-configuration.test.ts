import {it,expect} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {operatingEntry} from './operating-entry.js'

async function cleanFixture(root:string) {
 if(path.dirname(await fs.realpath(root))!==await fs.realpath(os.tmpdir())||!path.basename(root).startsWith('latamfx-recurring-'))throw Error('test_cleanup_scope_required')
 await fs.rm(root,{recursive:true,force:true})
}

it('prepares a same-model recurring route without opening a DB or transport, binding the actual source configuration',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'latamfx-recurring-'))
 try{
  await fs.mkdir(path.join(root,'docs/2.0'),{recursive:true})
  for(const name of ['six-currency-explanation-sources-20261027.json','six-currency-source-register-20261027.json',
   'original-news-source-policy-20261028.json','material-processing-rules.json'])await fs.copyFile('docs/2.0/'+name,path.join(root,'docs/2.0',name))
  await fs.mkdir(path.join(root,'.local-reports/private'),{recursive:true})
  const input='.local-reports/private/config.json'
  await fs.writeFile(path.join(root,input),JSON.stringify({version:'operating-recurring-configuration/1',writer:'sol-us',
   authorizationReference:'SYNTHETIC_RECURRING_CONFIG',monthlyUsd:1}))
  const result=await operatingEntry({action:'draft-recurring',workspace:root,input,env:{},fetchImpl:()=>{throw Error('network_forbidden')}})
  expect(result).toMatchObject({status:'recurring_proposal_not_installed',modelCalls:0,controlsChanged:false})
  const policy=JSON.parse(await fs.readFile(path.join(root,result.file),'utf8'))
  expect(policy).toMatchObject({writer:'sol-us',budgetScope:'recurring_service_separate_from_single_trial_approval',
   destination:{model:'openai/gpt-6.1-sol',writerProvider:'azure/us',fallback:false,zdr:true},limits:{monthlyUsd:1}})
  expect(policy.datasetBinding).toBeUndefined()
  expect(policy.sourceCatalogBinding).toMatch(/^[a-f0-9]{64}$/)
 }finally{await cleanFixture(root)}
})

it('does not turn an old one-time approval or an omitted monthly limit into recurring authority',async()=>{
 const {recurringOperatingPolicy}=await import('./operating-policy.js')
 for(const monthlyUsd of [undefined,null,0,-1])expect(()=>recurringOperatingPolicy({config:{},writer:'sol',monthlyUsd,
  authorizationReference:'OLD_TRIAL_28',configuredAt:'2026-11-03T00:00:00Z'})).toThrow('explicit_recurring_configuration_required')
})
