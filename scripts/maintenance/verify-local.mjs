// Read-only checks of the isolated app and public projection. No login, DB write,
// model request, mail dispatch, or production endpoint is used.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import {assertLocalApi} from '../currency-report/local-db.js'

const directory='.local-reports/private/maintenance-20261104'
const connection=JSON.parse(await fs.readFile('.local-reports/private/local-db/connection.json','utf8'))
const api=assertLocalApi(connection.url),app='http://127.0.0.1:4176',checks=[]
const check=(name,value)=>{assert.ok(value,name);checks.push(name)}
const request=url=>fetch(url,{signal:AbortSignal.timeout(15000)})
const cfg=await request(app+'/__local-db/config').then(r=>r.json())
check('local_public_config_only',cfg.url===api&&Object.keys(cfg).sort().join(',')==='anonKey,url')
for(const [route,status] of [['/.env.report.local',403],['/.local-reports/private/local-db/connection.json',403],['/api/mailing-list',403],['/__report/index',404]]){
 check('private_route_denied:'+route,(await request(app+route)).status===status)
}
const headers={apikey:cfg.anonKey,Authorization:'Bearer '+cfg.anonKey}
const publicResponse=await fetch(api+'/rest/v1/currency_reports?select=report',{headers,signal:AbortSignal.timeout(15000)})
const reports=await publicResponse.json()
check('public_projection_readable',publicResponse.ok&&Array.isArray(reports)&&reports.length>0)
check('only_approved_public_projection',reports.every(r=>r.report.status==='approved'&&r.report.publishedAt
 &&!r.report.claimLedger&&!r.report.claimReview&&!r.report.sourceContext&&r.report.evidence.every(e=>!e.sourceContext)))
const privateResponse=await fetch(api+'/rest/v1/currency_report_runs?select=id&limit=1',{headers,signal:AbortSignal.timeout(15000)})
const privateRows=await privateResponse.json()
check('anonymous_private_runs_denied',!privateResponse.ok||Array.isArray(privateRows)&&privateRows.length===0)
const secrets=[connection.serviceKey]
for(const file of ['.env.report.local','.env.research.local','.env.bcch.local']){
 let text
 try{text=await fs.readFile(file,'utf8')}catch(e){if(e.code==='ENOENT')continue;throw e}
 for(const match of text.matchAll(/^\s*([A-Z_0-9]+)\s*=\s*([^\r\n]*)/gm)){
  const value=match[2].trim().replace(/^['"]|['"]$/g,'')
  if(/KEY|TOKEN|PASSWORD|SECRET/.test(match[1])&&!/ANON|PUBLISHABLE/.test(match[1])&&value.length>12)secrets.push(value)
 }
}
const files=[]
async function walk(dir){for(const e of await fs.readdir(dir,{withFileTypes:true})){
 const file=path.join(dir,e.name)
 if(e.isDirectory())await walk(file)
 else if(/\.(?:js|css|html|json)$/.test(file))files.push(file)
}}
for(const dir of ['dist','dist-app-local','dist-report-ui'])await walk(dir)
check('actual_secret_values_available_for_scan',secrets.some(s=>typeof s==='string'&&s.length>12))
for(const file of files){const text=await fs.readFile(file,'utf8');check('secret_free:'+file,secrets.filter(Boolean).every(s=>!text.includes(s)))}
const result={checkedAt:new Date().toISOString(),checks,publicRowsRead:reports.length,buildFilesScanned:files.length,
 dbWrites:0,logins:0,emailsSent:0,paidCalls:0,productionRequests:0}
await fs.writeFile(path.join(directory,'local-access.json'),JSON.stringify(result,null,2))
console.log(JSON.stringify({passed:true,checks:checks.length,publicRowsRead:reports.length,buildFilesScanned:files.length,dbWrites:0,emailsSent:0,paidCalls:0}))
