import {describe,it,expect,vi,beforeEach} from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// Focused orchestration contract tests: price/source/compiler algorithms have
// their own suites. Actual saved country inputs are replayed separately.
const checks=vi.hoisted(()=>({assess:vi.fn(),prepare:vi.fn(),materials:vi.fn(),background:vi.fn(),review:vi.fn()}))
vi.mock('./fx-cause-input.js',()=>({assessFxCauseInput:checks.assess}))
vi.mock('./lifecycle-control.js',()=>({prepareEventTrial:checks.prepare}))
vi.mock('./fx-writing-background.js',()=>({projectFxWritingBackground:checks.background}))
vi.mock('./country-material-preparation.js',()=>({PREPARATION_CURRENCIES:['BRL','COP','PEN','ARS','CLP','MXN'],prepareCountryMaterials:checks.materials}))
vi.mock('./selected-review-batch.js',()=>({prepareSelectedReviewBatch:checks.review}))
import {prepareSixCurrencyInputs} from './six-currency-preparation.js'
import {prepareSixCurrencyInputsLocal} from './six-currency-preparation-local.js'

const fixture=()=>({mode:'historical_replay',asOf:'2026-10-28T12:00:00Z',cases:['BRL','COP','PEN','ARS','CLP','MXN'].map(currency=>({currency,kind:'reviewed_fx',collection:undefined as unknown,
 input:{packet:{currency,baseDate:'2026-10-27',observedDate:'2026-10-26'},dossier:{cards:[]},fxCauseInput:{review:{}},
  decision:{status:'draft_candidate'},writer:'sol',approval:{approved:true},plan:{paidCallAuthorized:true},assessment:{holds:[]}}}))})
beforeEach(()=>{
 vi.resetAllMocks()
 checks.assess.mockReturnValue({holds:[],priceMovement:{sessionDate:'2026-10-26'}})
 checks.prepare.mockReturnValue({status:'prepared_not_called',paidCallAuthorized:false})
 checks.background.mockReturnValue(null)
 checks.materials.mockReturnValue({holds:['attributed_currency_explanation_missing'],sections:{consumer_background:[]},priceConnection:null})
})
describe('Six-currency offline handoff',()=>{
 it('revalidates all saved cases without inheriting a spent approval, plan or cached score',()=>{
  const config=fixture()
  Object.assign(config.cases[0].input.fxCauseInput,{packet:{currency:'PEN'},approval:{approved:true}})
  const before=structuredClone(config),result=prepareSixCurrencyInputs(config)
  expect(checks.assess).toHaveBeenCalledTimes(6);expect(checks.prepare).toHaveBeenCalledTimes(6)
  for(const [sent] of checks.prepare.mock.calls){expect(sent).not.toHaveProperty('approval');expect(sent).not.toHaveProperty('plan');expect(sent).not.toHaveProperty('assessment')}
  expect(checks.assess.mock.calls[0][0].packet.currency).toBe('BRL')
  expect(checks.prepare.mock.calls[0][0].fxCauseInput).not.toHaveProperty('approval')
  expect(result.results.every(r=>r.status==='saved_case_request_prepared'&&!r.publicationApproved&&!r.repeatableAutomaticResearchReady)).toBe(true)
  expect(result).toMatchObject({networkCalls:0,modelCalls:0,newPaidCostUsd:0,paidCallAuthorized:false})
  expect(config).toEqual(before)
 })
 it('continues after an invalid country and preserves independent material and writer holds',()=>{
  const config=fixture();config.cases[1].kind='country_materials';config.cases[2].input.packet.currency='CLP'
  checks.prepare.mockImplementation(data=>data.packet.currency==='ARS'?{status:'writer_policy_hold',holdReasons:['input_token_bound']}:{status:'prepared_not_called'})
  const result=prepareSixCurrencyInputs(config)
  expect(result.results.map(r=>r.status)).toEqual(['saved_case_request_prepared','saved_case_writer_held','saved_case_invalid','saved_case_writer_held','saved_case_request_prepared','saved_case_request_prepared'])
  expect(result.results[1].holds).toEqual(['attributed_currency_explanation_missing'])
  expect(result.results[3].holds).toContain('input_token_bound')
  expect(result.handoffs).toHaveLength(5)
 })
 it('keeps a failed acquisition replay separate from a validated historical input and never rebases its dates',()=>{
  const config=fixture();config.cases[0].collection={currency:'PEN',reviewQueue:[]}
  const row=prepareSixCurrencyInputs(config).results[0]
  expect(row).toMatchObject({status:'saved_case_request_prepared',caseDate:'2026-10-27',sessionDate:'2026-10-26',ageInCalendarDays:2,
   caseRebasedToAuditDate:false,acquisition:{status:'collection_replay_failed',reason:'collection_currency_mismatch'}})
  expect(checks.review).not.toHaveBeenCalled()
 })
 it('rejects a missing or duplicate currency and an invalid audit cutoff before compiling any input',()=>{
  const duplicate=fixture();duplicate.cases[0].currency='CLP'
  const missing=fixture();missing.cases.pop()
  for(const config of [duplicate,missing,{...fixture(),asOf:'yesterday'}])expect(()=>prepareSixCurrencyInputs(config)).toThrow('six_currency_manifest_required')
  expect(checks.prepare).not.toHaveBeenCalled()
 })
 it('records saved review replay without counting it as a new automated original-content review',()=>{
  const config=fixture();config.cases[0].collection={currency:'BRL',reviewQueue:[]}
  checks.review.mockReturnValue({collectionOutcomes:[{status:'access_failed'}],items:[]})
  expect(prepareSixCurrencyInputs(config).results[0].acquisition).toMatchObject({status:'saved_collection_replayed',
   automaticContentReviewPerformed:false,caseEvidenceAutomaticallyReplaced:false,outcomes:[{status:'access_failed'}]})
 })
 it('confines file reads and writes to private JSON while keeping a missing acquisition file independent',async()=>{
  const workspace=await fs.mkdtemp(path.join(os.tmpdir(),'six-country-handoff-'))
  try {
   const privateRoot=path.join(workspace,'.local-reports/private');await fs.mkdir(privateRoot,{recursive:true})
   const config=fixture(),manifest={version:'six-currency-preparation/1',asOf:config.asOf,cases:[] as {currency:string;kind:string;inputFile:string;collectionFile?:string}[]}
   for(const c of config.cases){const file=path.join(privateRoot,`${c.currency}.json`)
    await fs.writeFile(file,JSON.stringify(c.input));manifest.cases.push({currency:c.currency,kind:c.kind,inputFile:file})}
   manifest.cases[0].collectionFile=path.join(privateRoot,'missing.json')
   const outside=path.join(workspace,'outside.json');await fs.writeFile(outside,JSON.stringify(config.cases[1].input))
   manifest.cases[1].inputFile=outside
   const file=path.join(privateRoot,'manifest.json'),raw=JSON.stringify(manifest);await fs.writeFile(file,raw)
   await expect(prepareSixCurrencyInputsLocal({workspace,input:file})).rejects.toThrow('six_currency_manifest_required')
   const a=await prepareSixCurrencyInputsLocal({workspace,input:file,historicalReplay:true}),b=await prepareSixCurrencyInputsLocal({workspace,input:file,historicalReplay:true})
   expect(a.results[0]).toMatchObject({status:'saved_case_request_prepared',acquisition:{status:'collection_replay_failed',reason:'saved_collection_unreadable'}})
   expect(a.results[1].status).toBe('saved_case_invalid');expect(a.results[5].status).toBe('saved_case_request_prepared')
   expect(a.directory).not.toBe(b.directory)
   expect(await fs.readFile(file,'utf8')).toBe(raw)
   const handoff=JSON.parse(await fs.readFile(path.join(workspace,a.directory,'BRL-handoff.json'),'utf8'))
   expect(handoff).not.toHaveProperty('approval');expect(handoff.paidCallAuthorized).toBe(false)
  }finally{await fs.rm(workspace,{recursive:true,force:true})}
 })
 it('requires shared prices by default and never carries old price approvals into the new six-country handoff',()=>{
  const config=fixture(),before=structuredClone(config)
  expect(()=>prepareSixCurrencyInputs({asOf:config.asOf,cases:config.cases})).toThrow('shared_dashboard_dataset_required')
  const dataset={baseDate:'2026-10-28',fetchedAt:'2026-10-28T05:45:00Z',dailyRates:config.cases.flatMap(c=>[
   {currency:c.currency,date:'2026-10-27',rateType:'LOCAL_PER_USD',value:100,status:'ok',source:'API',imputationMethod:'NONE'},
   {currency:c.currency,date:'2026-10-28',rateType:'LOCAL_PER_USD',value:102,status:'ok',source:'API',imputationMethod:'NONE'},
  ])}
  const result=prepareSixCurrencyInputs({...config,mode:'shared_dashboard',dataset})
  expect(result.results).toHaveLength(6)
  expect(result.results.every(r=>r.status==='shared_price_connected_writer_held')).toBe(true)
  for(const {handoff} of result.handoffs){
   expect(handoff.reportPriceSnapshot).toMatchObject({current:{value:102},previous:{value:100},changePct:2})
   expect(handoff.referencePolicy).toMatchObject({companyRateEquivalence:'assumed_pending_user_confirmation',localCloseRequired:false})
   expect(handoff.priceWritingGuide).toHaveLength(5)
   expect(handoff.assessment.checks.find(c=>c.id==='reference_rate_basis')).toMatchObject({status:'pass'})
   expect(handoff.assessment.holds).not.toContain('provider_session_and_basis')
   expect(handoff.assessment).toMatchObject({writingEligibility:'hold',contentQuality:'not_evaluated_for_new_snapshot',request:null})
   expect(handoff).not.toHaveProperty('packet');expect(handoff).not.toHaveProperty('plan');expect(handoff).not.toHaveProperty('approval')
  }
  const withCommentary={...config,mode:'shared_dashboard',dataset,
   cases:config.cases.map((c,i)=>i?c:{...c,commentaryDate:'2026-10-27'})}
  const invalid=prepareSixCurrencyInputs(withCommentary)
  expect(invalid.results[0].materials.status).toBe('saved_material_invalid')
  expect(invalid.results[0].status).toBe('shared_price_connected_writer_held')
  expect(invalid.results[1].materials.status).toBe('commentary_target_required')
  expect(config).toEqual(before)
 })
})
