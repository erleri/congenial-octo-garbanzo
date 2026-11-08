import fs from 'node:fs'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {planResearchNeeds} from './research-needs.js'
import {compileResearchSourceCatalog,planResearchSourceSelection} from './research-source-selection.js'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {createSourceContext} from './source-context.js'
import {bindEvidenceScope} from './evidence-scope.js'

const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
const select=(input=sourceSelectionFixture(),attempts:object[]=[])=>planResearchSourceSelection({input,sourcePlan,sourceRegister,attempts})
const attempt=(requestId:string,status:string,extra={})=>({attemptId:'attempt-one',requestId,status,completedAt:'2026-10-27T09:00:00Z',...extra})
afterEach(()=>vi.unstubAllGlobals())

describe('Country source selection over existing research needs',()=>{
  it.each([
    ['BRL','brl-retail'],['MXN','mxn-consumer'],['COP','cop-retail'],['PEN','pen-financing'],['CLP','clp-consumer'],['ARS','ars-retail-appliances'],
  ])('selects the registered %s data route %s with no network or input mutation',(currency,expected)=>{
    const input=sourceSelectionFixture(currency,{metric:currency==='PEN'?'consumer_credit':'retail'})
    const before=structuredClone(input),network=vi.fn(()=>{throw new Error('network forbidden')})
    vi.stubGlobal('fetch',network)
    const result=select(input)
    expect(result.questions[0].targets[0].sources.map(s=>s.sourceId)).toContain(expected)
    expect(result.plan).toEqual(planResearchNeeds(input))
    expect(result).toMatchObject({currency,networkCalls:0,modelCalls:0,apiCostUsd:0,writingEligibility:'not_assessed',publicationApproved:false})
    expect(input).toEqual(before);expect(network).not.toHaveBeenCalled()
  })

  it('selects country news and common market context instead of consumer statistics for FX causes',()=>{
    const result=select(sourceSelectionFixture('COP',{purpose:'fx_explanation',metric:'market_quote',period:'2026-10-27'}))
    const ids=(key:string)=>result.questions.find(q=>q.needId===key)!.targets[0].sources.map(s=>s.sourceId)
    expect(ids('market')).toEqual(['cop-larepublica','cop-valora'])
    expect(ids('global')).toEqual(['common-dollar','common-us-yields','common-oil'])
    expect(ids('local')).not.toContain('cop-retail')
    expect(result.questions.every(q=>q.targets.every(t=>t.sources.every(s=>s.catalogEntryIsEvidence===false)))).toBe(true)
  })

  it('uses specialist-first automatic routes in all six countries and excludes unconnected publishers without manual tasks',()=>{
    const expected={BRL:['brl-infomoney','brl-agenciabrasil','brl-cnn'],MXN:['mxn-eleconomista','mxn-elfinanciero','mxn-forbes','mxn-expansion'],
      COP:['cop-larepublica','cop-valora'],PEN:['pen-gestion','pen-revistaeconomia','pen-rpp','pen-elcomercio','pen-andina','pen-infobae'],
      CLP:['clp-existing-four-outlets','clp-biobio','clp-cooperativa'],ARS:['ars-iprofesional','ars-infobae']}
    const shuffled=structuredClone(sourceRegister);shuffled.newsRoutes.reverse()
    for(const [currency,ids] of Object.entries(expected)){
      const result=planResearchSourceSelection({input:sourceSelectionFixture(currency,{purpose:'fx_explanation',metric:'market_quote',period:'2026-10-27'}),sourcePlan,sourceRegister:shuffled})
      const market=result.questions.find(q=>q.needId==='market')!.targets[0]
      expect(market.sources.map(s=>s.sourceId)).toEqual(ids)
      expect(market.excludedSources).toContainEqual(expect.objectContaining({sourceId:`${currency.toLowerCase()}-yahoo`,status:'excluded_from_automatic_collection'}))
      expect(result.sourceRequests.every(r=>r.adapterStatus!=='manual_review_required'&&r.discovery?.mode!=='excluded')).toBe(true)
      for(const source of market.sources){
        expect(source.discovery).toMatchObject({mode:'existing_adapter',targetPeriod:'2026-10-27',queryIsEvidence:false,queryDateIsPublicationProof:false})
        expect(source.discovery!.queries.every(q=>q.startsWith('site:')&&q.endsWith('2026-10-27'))).toBe(true)
      }
      expect(result).toMatchObject({executionPolicy:'automatic_collection_only/1',networkCalls:0,modelCalls:0,publicationApproved:false})
    }
  })

  it('returns a data gap rather than a manual task when every registered news route is excluded',()=>{
    const excluded=structuredClone(sourceRegister)
    excluded.newsRoutes.filter(s=>s.currency==='COP').forEach(s=>{s.discovery.mode='excluded'})
    const result=planResearchSourceSelection({input:sourceSelectionFixture('COP',{purpose:'fx_explanation',metric:'market_quote'}),sourcePlan,sourceRegister:excluded})
    const market=result.questions.find(q=>q.needId==='market')!.targets[0]
    expect(market).toMatchObject({sources:[],dataState:'no_automatic_source',lookupState:'not_attempted',unattemptedSourceIds:[],routingReason:'automatic_collection_not_enabled'})
    expect(result.dataGaps).toContainEqual(expect.objectContaining({needId:'market',state:'no_automatic_source'}))
    expect(result.sourceRequests.every(r=>!excluded.newsRoutes.some(s=>s.currency==='COP'&&s.id===r.sourceId))).toBe(true)
    expect(result.writingEligibility).toBe('not_assessed')
  })

  it('does not let missing or altered discovery metadata enable Yahoo or manual collection',()=>{
    for(const mode of ['existing_adapter','manual_review',undefined]){
      const changed=structuredClone(sourceRegister),yahoo=changed.newsRoutes.find(s=>s.id==='cop-yahoo')
      if(mode===undefined)delete yahoo.discovery
      else yahoo.discovery.mode=mode
      expect(()=>compileResearchSourceCatalog(sourcePlan,changed)).toThrow(mode==='manual_review'?'invalid_news_discovery_policy':'yahoo_automation_not_enabled')
    }
    const metadata=structuredClone(sourceRegister);metadata.newsRoutes.find(s=>s.id==='cop-larepublica').discovery.domains=['finance.yahoo.com']
    expect(()=>compileResearchSourceCatalog(sourcePlan,metadata)).toThrow('yahoo_automation_not_enabled')
  })

  it('distinguishes no registered metric from not-yet-attempted registered routes',()=>{
    const absent=select(sourceSelectionFixture('BRL',{metric:'real_pay'}))
    expect(absent.questions[0].targets[0]).toMatchObject({dataState:'no_registered_source',lookupState:'not_attempted'})
    expect(absent.dataGaps[0]).toMatchObject({needId:'economic_release',state:'no_registered_source'})
    expect(select().questions[0].targets[0]).toMatchObject({dataState:'pending',lookupState:'not_attempted'})
    const undefinedScope=sourceSelectionFixture();undefinedScope.requirements={}
    expect(select(undefinedScope).scopeRequired).toEqual(['economic_release','economic_scope'])
  })

  it.each([['empty_result','missing_in_checked_sources','checked'],['access_failed','pending','failed'],['extraction_failed','pending','failed']])(
    'keeps %s distinct as data %s and lookup %s',(status,dataState,lookupState)=>{
      const input=sourceSelectionFixture('PEN',{metric:'consumer_credit'}),first=select(input)
      const request=first.questions[0].targets[0].sources[0]
      const result=select(input,[attempt(request.requestId!,status)])
      expect(result.questions[0].targets[0]).toMatchObject({dataState,lookupState})
      expect(result.attempts[0].absenceVerified).toBe(false)
      expect(result.questions[1].targets[0].lookupState).toBe(lookupState)
      expect(result.sourceRequests).toHaveLength(1)
      expect(result.sourceRequests[0].needIds).toEqual(['economic_release','economic_scope'])
    })

  it('keeps failure history after a later capture and does not approve the captured original',()=>{
    const input=sourceSelectionFixture('PEN',{metric:'consumer_credit'}),request=select(input).questions[0].targets[0].sources[0]
    const rows=[attempt(request.requestId!,'access_failed'),attempt(request.requestId!,'collected_pending_review',{
      attemptId:'attempt-two',completedAt:'2026-10-27T10:00:00Z',captureSha256:'a'.repeat(64)})]
    const result=select(input,rows)
    expect(result.questions[0].targets[0]).toMatchObject({dataState:'stored_unreviewed',lookupState:'checked'})
    expect(result.lookupFailures).toHaveLength(1);expect(result.activeLookupFailures).toEqual([])
    expect(result.plan.coreStatus).toBe('hold');expect(result.publicationApproved).toBe(false)
  })

  it('retains a failed source and an unchecked alternative without claiming complete absence',()=>{
    const input=sourceSelectionFixture('BRL',{purpose:'fx_explanation',metric:'market_quote'}),first=select(input)
    const request=first.questions[0].targets[0].sources[0]
    const result=select(input,[attempt(request.requestId!,'empty_result')])
    expect(result.questions[0].targets[0]).toMatchObject({dataState:'pending',lookupState:'partially_checked',unattemptedSourceIds:['brl-agenciabrasil','brl-cnn']})
    const partial=select(input,[attempt(request.requestId!,'access_failed'),attempt(first.questions[0].targets[0].sources[1].requestId!,'collected_pending_review',{
      attemptId:'attempt-two',captureSha256:'b'.repeat(64)})])
    expect(partial.questions[0].targets[0]).toMatchObject({dataState:'stored_unreviewed',lookupState:'partial_failure'})
  })

  it('reuses scope-reviewed inventory without issuing another source request',()=>{
    const input=sourceSelectionFixture(),dimensions=input.requirements.economic_release[0].scope
    const evidence={id:'synthetic-retail',country:'CLP',period:'2026-09',eventDate:'2026-10-20',publishedAt:'2026-10-20',collectedAt:'2026-10-21T10:00:00Z',
      url:'https://www.ine.gob.cl/synthetic-retail',review:{originalVerified:true,reuse:'verified'},sourceContext:createSourceContext({blocks:[{kind:'paragraph',text:'Synthetic retail data for a metadata compatibility regression only.'}],selected:[0]})}
    const card=bindEvidenceScope(evidence,{scope:dimensions,passageIds:['p0'],admittedClaims:[{id:'fact',kind:'source_fact',passageIds:['p0'],text:'실제 경제 자료가 아닌 저장 범위 적합성 합성 시험이다.'}],
      allowedUse:'합성 자료의 범위 적합성 확인에만 사용한다.',countercontext:'이 합성 자료를 실제 판매 근거로 사용하지 않는다.',excludedExpansions:['회사 실적'],coverageGaps:[],crossSourceClaims:[]},
      {origin:'agent',status:'checked',reason:'합성 검토 대역이며 실제 원문 승인이나 품질 평가가 아니다.'})
    const packet={...input.packet,evidence:[evidence],evidenceScopeCards:[card]}
    const result=select({...input,packet})
    expect(result.questions[0].targets[0]).toMatchObject({dataState:'metadata_compatible',evidenceIds:['synthetic-retail']})
    expect(result.questions[0].targets[0].sources.every(s=>s.requestId===null&&s.adapterStatus==='existing_inventory_review')).toBe(true)
    expect(result.plan.coreStatus).toBe('review_required')
  })

  it('binds attempts to the exact country, period, requirement and catalog version',()=>{
    const input=sourceSelectionFixture('PEN',{metric:'consumer_credit'}),request=select(input).questions[0].targets[0].sources[0]
    const record=attempt(request.requestId!,'empty_result')
    expect(()=>select(sourceSelectionFixture('COP',{metric:'consumer_credit'}),[record])).toThrow('invalid_source_attempts')
    expect(()=>select(sourceSelectionFixture('PEN',{metric:'consumer_credit',period:'2026-08'}),[record])).toThrow('invalid_source_attempts')
    const modified=structuredClone(sourcePlan);modified.sources.find(s=>s.id==='pen-financing').status='changed_record'
    expect(()=>planResearchSourceSelection({input,sourcePlan:modified,sourceRegister,attempts:[record]})).toThrow('invalid_source_attempts')
    expect(()=>select(input,[attempt(request.requestId!,'collected_pending_review')])).toThrow('invalid_source_attempts')
    expect(()=>select(input,[attempt(request.requestId!,'empty_result',{completedAt:'2026-10-28T00:00:00Z'})])).toThrow('invalid_source_attempts')
    expect(()=>select(input,[record,record])).toThrow('invalid_source_attempts')
  })

  it('accepts the ARS quarterly target without relabeling it as monthly or accepting a future quarter',()=>{
    const input=sourceSelectionFixture('ARS',{period:'2026-Q3'})
    const result=select(input)
    expect(result.plan.version).toBe('research-needs/3')
    expect(result.questions[0].targets[0]).toMatchObject({period:'2026-Q3',sources:[{sourceId:'ars-retail-appliances'}]})
    expect(()=>select(sourceSelectionFixture('ARS',{period:'2027-Q1'}))).toThrow('future_target_period')
    expect(planResearchNeeds(sourceSelectionFixture('CLP')).version).toBe('research-needs/2')
  })

  it('rejects broken country references and credential URLs without treating catalog approval flags as evidence',()=>{
    const crossed=structuredClone(sourcePlan);crossed.countryPlans[0].officialRefs=['pen-financing']
    expect(()=>compileResearchSourceCatalog(crossed,sourceRegister)).toThrow('invalid_country_routes')
    const unsafe=structuredClone(sourcePlan);unsafe.sources[0].url='https://example.org/data?api_key=private-value'
    expect(()=>compileResearchSourceCatalog(unsafe,sourceRegister)).toThrow('invalid_catalog_url')
    for(const url of ['https://localhost/data','https://[::1]/data','https://app.localhost/data']){
      const local=structuredClone(sourcePlan);local.sources[0].url=url
      expect(()=>compileResearchSourceCatalog(local,sourceRegister)).toThrow('invalid_catalog_url')
    }
    const claims=structuredClone(sourcePlan);claims.sources.forEach(s=>{s.automaticInputApproved=true})
    const result=planResearchSourceSelection({input:sourceSelectionFixture(),sourcePlan:claims,sourceRegister})
    expect(result.plan.coreStatus).toBe('hold');expect(result.writingEligibility).toBe('not_assessed')
  })
})
