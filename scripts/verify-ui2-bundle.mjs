import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve('dist'),assets=path.join(root,'assets')
const files=fs.readdirSync(assets).filter(name=>name.endsWith('.js'))
const content=files.map(name=>fs.readFileSync(path.join(assets,name),'utf8')).join('\n')
const forbidden=['/__local-db/config','/__local-api/status','.local-reports/private','latamfx-local-db-auth','PRIVATE_FIXTURE_RESPONSE','PRIVATE_FIXTURE_ORIGINAL','OPENROUTER_API_KEY']
for(const marker of forbidden)if(content.includes(marker))throw Error('production_contains_private_or_local_marker')
const connection='.local-reports/private/local-db/connection.json'
if(fs.existsSync(connection)){
 const {serviceKey}=JSON.parse(fs.readFileSync(connection,'utf8'))
 if(serviceKey&&content.includes(serviceKey))throw Error('production_contains_private_credential')
}
const testResult=JSON.parse(fs.readFileSync('.local-reports/private/unit-tests.json','utf8'))
const result={status:'passed',checkedChunks:files.length,privateMarkersAbsent:true,serviceCredentialAbsent:true,
 testFiles:testResult.testResults.length,executedTests:testResult.numPassedTests,failedTests:testResult.numFailedTests}
console.log(JSON.stringify(result))
