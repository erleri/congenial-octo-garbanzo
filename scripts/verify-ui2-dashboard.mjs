import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {getDashboardDaily,getDashboardPreviousDaily,getDashboardDailyChange} from '../src/lib/dashboard-price.js'

const raw=await fs.readFile(new URL('../public/data.json',import.meta.url))
const original=JSON.parse(raw)
const js=await fs.readFile(new URL('../artifacts/ui2-dashboard/snapshot.js',import.meta.url),'utf8')
const snapshot=JSON.parse(js.slice(js.indexOf('window.UI2_SNAPSHOT=')+'window.UI2_SNAPSHOT='.length).trim().replace(/;$/,''))
assert.equal(snapshot.sourceSha256,crypto.createHash('sha256').update(raw).digest('hex'))
assert.equal(snapshot.baseDate,original.baseDate)
assert.equal(snapshot.currencies.length,6)
for(const c of snapshot.currencies){
  const current=getDashboardDaily(original.dailyRates,c.currency,original.baseDate)
  const previous=getDashboardPreviousDaily(original.dailyRates,c.currency,original.baseDate)
  assert.equal(c.value,current.value)
  assert.equal(c.change,getDashboardDailyChange(current,previous))
  assert.equal(c.previousDate,previous.date)
  assert.equal(c.series.at(-1).value,c.value)
  assert.equal(c.monthly.length,24)
  for(const p of c.series)assert.ok(p.date<=snapshot.baseDate)
}
const code=await fs.readFile(new URL('../artifacts/ui2-dashboard/preview.js',import.meta.url),'utf8')
assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\b/.test(code),'Preview must not call APIs or persist reader events')
assert.ok(!/(?:OPENROUTER_API_KEY|SUPABASE_SERVICE_ROLE_KEY|ALPHA_VANTAGE_API_KEY|INEGI_TOKEN|BANXICO_TOKEN)/.test(js))
const root='http://127.0.0.1:4180'
const endpointResults=[]
for(const [pathname,expected] of [['/',200],['/preview.js',200],['/snapshot.js',200],['/.env',404],['/.local-reports/private/local-db/accounts.json',404],['/api/mailing-list',404]]){
  const res=await fetch(root+pathname)
  assert.equal(res.status,expected,pathname)
  endpointResults.push({path:pathname,status:res.status})
  if(expected===200)assert.match(res.headers.get('content-security-policy'),/connect-src 'none'/)
}
assert.equal((await fetch(root+'/',{method:'POST'})).status,405)
const result={date:'2026-10-30',sourceSha256:snapshot.sourceSha256,baseDate:snapshot.baseDate,
  currencyValues:'6/6 equal to the existing shared dashboard selectors',series:'90-day daily / 24-month monthly projection',
  sourcePreserved:true,previewExternalCalls:0,readerAnalyticsConnected:false,endpointResults,postBlocked:true}
await fs.writeFile(new URL('../.local-reports/private/ui2-dashboard-20261030/data-checks.json',import.meta.url),JSON.stringify(result,null,2))
console.log(JSON.stringify(result))
