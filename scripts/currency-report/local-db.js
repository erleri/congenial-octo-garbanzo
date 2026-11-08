// Isolated local Supabase only; no environment loading or cloud credentials.
import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const directory = '.local-reports/private/local-db'
export function assertLocalApi(url) {
  const u = new URL(url)
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.port !== '56321' || u.pathname !== '/' || u.search || u.hash || u.username || u.password)
    throw new Error('isolated_local_api_required')
  return u.origin
}
export async function localDbConfig() {
  const value = JSON.parse(await fs.readFile(directory + '/connection.json', 'utf8'))
  return { url: assertLocalApi(value.url), anonKey: value.anonKey }
}
const options = { auth: { persistSession: false, autoRefreshToken: false } }
async function connection(cli, workdir) {
  const config = await fs.readFile(workdir + '/supabase/config.toml', 'utf8')
  if (!config.includes('project_id = "latamfx-2x-isolated"') || !config.includes('port = 56322') || !config.includes('port = 56321')) throw new Error('isolated_workdir_required')
  const result = spawnSync(cli, ['status', '--workdir', workdir, '--output', 'json'], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error('local_status_unavailable')
  const keys = JSON.parse(result.stdout)
  assertLocalApi(keys.API_URL)
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(directory + '/connection.json', JSON.stringify({ url: keys.API_URL, anonKey: keys.ANON_KEY, serviceKey: keys.SERVICE_ROLE_KEY }), { flag: 'w' })
  return { url: keys.API_URL, anonKey: keys.ANON_KEY, serviceKey: keys.SERVICE_ROLE_KEY }
}
const ok = (result, code) => { if (result.error) throw new Error(code); return result.data }
export function syntheticDbReport(currency, baseDate, sequence) {
  return { id: `${currency}-${baseDate}-${sequence}`, schemaVersion: 'currency-report/1', currency, baseDate, observedDate: baseDate,
    generationMode: 'ai_enhanced', purpose: 'economic_update', testOnly: true,
    marketData: { fetchedAt: baseDate + 'T12:00:00Z', source: 'JSON', rateType: 'LOCAL_PER_USD' },
    content: { title: 'DB 연결 시험용 합성 보고서', summary: '저장·승인·조회 연결을 확인하기 위한 합성 자료입니다. 실제 AI 원고나 경제 분석이 아닙니다.',
      change: { title: '합성 관측값', text: '{{spot}}', kind: 'fact', factIds: ['spot'], evidenceIds: [] },
      drivers: [{ title: '합성 근거 연결', text: '원문과 공개 결과를 분리하는 승인 절차를 확인합니다.', kind: 'interpretation', factIds: [], evidenceIds: ['fixture-source'] }],
      implications: [], watch: [], limitations: ['로컬 DB 연결 시험 자료입니다.'] },
    facts: [{ id: 'spot', value: 100, label: `1 USD = 100 ${currency}` }], series: [{ date: baseDate, value: 100 }],
    evidence: [{ id: 'fixture-source', country: currency, title: '공식 기관 링크를 사용하는 합성 근거', publisher: '연결 시험', url: 'https://www.ine.gob.cl/', publishedAt: baseDate, eventDate: baseDate, period: '합성 시험', collectedAt: baseDate + 'T12:00:00Z', summary: '이 링크는 합성 주장에 대한 실제 지지가 아닙니다.', provenance: 'official', sourceContext: { raw: 'PRIVATE_FIXTURE_ORIGINAL' } }],
    raw_ai_response: 'PRIVATE_FIXTURE_RESPONSE', limitations: ['실제 발행물이 아닙니다.'] }
}
async function addRun(service, currency, baseDate, attempt, candidate = syntheticDbReport(currency, baseDate, attempt)) {
  const id = randomUUID()
  ok(await service.from('currency_report_runs').insert({ id, currency, base_date: baseDate, attempt, rule_version: 'local-db-fixture/1', event_binding: 'synthetic-only',
    packet: { raw: 'PRIVATE_FIXTURE_ORIGINAL' }, candidate, validation: { structureValid: true, contentReview: 'passed', criticalErrors: 0, qualityAverage: 4, evidenceScore: 4, synthetic: true }, cost: { costUsd: 0, modelCalls: 0 } }), 'fixture_insert_failed')
  return id
}
async function signIn(url, key, account) {
  const client = createClient(url, key, options)
  ok(await client.auth.signInWithPassword(account), 'local_signin_failed')
  return client
}
export async function bootstrap(cli, workdir) {
  const keys = await connection(cli, workdir), service = createClient(keys.url, keys.serviceKey, options)
  let accounts
  try { accounts = JSON.parse(await fs.readFile(directory + '/accounts.json', 'utf8')) } catch (e) {
    if (e.code !== 'ENOENT') throw e
    accounts = {}
    for (const role of ['admin', 'reader']) {
      const account = { email: `${role}-${randomBytes(4).toString('hex')}@example.test`, password: randomBytes(24).toString('base64url') }
      ok(await service.auth.admin.createUser({ ...account, email_confirm: true }), 'local_account_creation_failed')
      accounts[role] = account
    }
    await fs.writeFile(directory + '/accounts.json', JSON.stringify(accounts), { flag: 'wx' })
  }
  ok(await service.from('business_plan_admins').upsert({ email: accounts.admin.email, active: true }), 'local_admin_setup_failed')
  const baseDate = '2098-12-31'
  const existing = ok(await service.from('currency_report_runs').select('attempt').eq('currency','BRL').eq('base_date',baseDate), 'local_fixture_lookup_failed')
  const runId = await addRun(service,'BRL',baseDate,Math.max(0,...existing.map(r=>r.attempt)) + 1)
  await fs.writeFile(directory + '/ui-fixture.json', JSON.stringify({ runId, testOnly: true, baseDate }), { flag: 'w' })
  return { status: 'local_db_ready', publicUrl: keys.url, privateAccountsFile: directory + '/accounts.json', pendingUiFixture: true }
}
export async function verify() {
  const keys = JSON.parse(await fs.readFile(directory + '/connection.json','utf8'))
  assertLocalApi(keys.url)
  const accounts = JSON.parse(await fs.readFile(directory + '/accounts.json','utf8'))
  const service = createClient(keys.url,keys.serviceKey,options), anon = createClient(keys.url,keys.anonKey,options)
  const [admin, reader, secondAdmin] = await Promise.all([signIn(keys.url,keys.anonKey,accounts.admin),signIn(keys.url,keys.anonKey,accounts.reader),signIn(keys.url,keys.anonKey,accounts.admin)])
  const checks = []
  const check = (condition,name) => { if (!condition) throw new Error(name); checks.push(name) }
  check(!!(await anon.from('currency_report_runs').select('id')).error, 'anon_private_denied')
  check(ok(await reader.from('currency_report_runs').select('id'),'reader_query_failed').length===0,'reader_drafts_hidden')
  const date = '2098-12-30', existing = ok(await service.from('currency_report_runs').select('attempt').eq('currency','CLP').eq('base_date',date),'history_lookup_failed')
  const attempt = Math.max(0,...existing.map(r=>r.attempt)) + 1, runId = await addRun(service,'CLP',date,attempt)
  check(!!(await reader.rpc('review_currency_report',{p_run_id:runId,p_decision:'approved'})).error,'reader_approval_denied')
  const concurrent = await Promise.all([admin.rpc('review_currency_report',{p_run_id:runId,p_decision:'approved'}),secondAdmin.rpc('review_currency_report',{p_run_id:runId,p_decision:'approved'})])
  check(concurrent.filter(r=>!r.error&&r.data==='published').length===1 && concurrent.some(r=>r.error?.code==='55000'),'concurrent_one_winner')
  check(ok(await service.from('currency_report_reviews').select('id').eq('run_id',runId),'audit_query_failed').length===1,'one_review_record')
  const published = ok(await anon.from('currency_reports').select('report').eq('run_id',runId).single(),'public_read_failed').report
  check(!JSON.stringify(published).includes('PRIVATE_FIXTURE_'),'public_originals_removed')
  check(published.purpose==='economic_update' && published.marketData.source==='JSON' && published.testOnly===true,'public_metadata_preserved')
  const futureRun = await addRun(service,'CLP',date,attempt+1)
  ok(await admin.rpc('review_currency_report',{p_run_id:futureRun,p_decision:'approved'}),'new_attempt_publish_failed')
  const staleRun = await addRun(service,'CLP',date,attempt+2), newestRun = await addRun(service,'CLP',date,attempt+3)
  ok(await admin.rpc('review_currency_report',{p_run_id:newestRun,p_decision:'approved'}),'latest_publish_failed')
  check((await admin.rpc('review_currency_report',{p_run_id:staleRun,p_decision:'approved'})).error?.code==='55000','older_attempt_cannot_replace_newer')
  const mxHistory = ok(await service.from('currency_report_runs').select('attempt').eq('currency','MXN').eq('base_date',date),'metadata_history_failed')
  const unsafeAttempt = Math.max(0,...mxHistory.map(r=>r.attempt))+1
  const unsafe = syntheticDbReport('MXN',date,unsafeAttempt)
  unsafe.marketData.fetchedAt = 'PRIVATE_FIXTURE_mail@example.test'
  const unsafeRun = await addRun(service,'MXN',date,unsafeAttempt,unsafe)
  ok(await admin.rpc('review_currency_report',{p_run_id:unsafeRun,p_decision:'approved'}),'metadata_guard_publish_failed')
  const guarded = ok(await anon.from('currency_reports').select('report').eq('run_id',unsafeRun).single(),'metadata_guard_read_failed').report
  check(guarded.marketData.fetchedAt===null && !JSON.stringify(guarded).includes('PRIVATE_FIXTURE_mail'),'malformed_metadata_cannot_expose_private_text')
  ok(await admin.rpc('review_currency_report',{p_run_id:unsafeRun,p_decision:'withdrawn',p_reason:'Metadata guard test complete'}),'metadata_guard_withdraw_failed')
  ok(await service.from('business_plan_admins').update({active:false}).eq('email',accounts.admin.email),'revoke_failed')
  check(ok(await admin.from('currency_report_runs').select('id'),'revoked_query_failed').length===0,'same_session_revocation_hides_drafts')
  check((await admin.rpc('review_currency_report',{p_run_id:staleRun,p_decision:'rejected'})).error?.code==='42501','same_session_revocation_blocks_review')
  ok(await service.from('business_plan_admins').update({active:true}).eq('email',accounts.admin.email),'restore_failed')
  ok(await admin.rpc('review_currency_report',{p_run_id:newestRun,p_decision:'withdrawn',p_reason:'Synthetic correction and cache invalidation test'}),'withdraw_failed')
  check(ok(await anon.from('currency_reports').select('report').eq('run_id',newestRun),'withdraw_lookup_failed').length===0,'withdrawn_hidden_from_anon')
  check(ok(await service.from('currency_report_runs').select('packet').eq('id',newestRun).single(),'original_lookup_failed').packet.raw==='PRIVATE_FIXTURE_ORIGINAL','withdrawal_keeps_original')
  await Promise.all([admin.auth.signOut(),reader.auth.signOut(),secondAdmin.auth.signOut()])
  const result = { checkedAt: new Date().toISOString(), mode:'local-db', status:'passed', checks, synthetic:true, aiQualitySamples:0, modelCalls:0, costUsd:0 }
  await fs.writeFile(directory + '/verification.json',JSON.stringify(result,null,2))
  return result
}
async function main() {
  const {values} = parseArgs({ options: { action:{type:'string'}, cli:{type:'string'}, workdir:{type:'string'} },strict:true })
  if (!['bootstrap','verify'].includes(values.action)) throw new Error('explicit_local_db_action_required')
  console.log(JSON.stringify(values.action==='bootstrap' ? await bootstrap(values.cli,values.workdir) : await verify()))
}
if (import.meta.url===pathToFileURL(process.argv[1]??'').href) main().catch(e=>{console.error(/^[a-z_]+$/.test(e.message)?e.message:'local_db_validation_failed');process.exitCode=1})
