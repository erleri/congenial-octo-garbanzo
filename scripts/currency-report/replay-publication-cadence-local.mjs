// Offline research only. Not imported by app, writer, publication or workflow code.
// Numeric history is not a point-in-time publication or event backtest.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { inspectMovements } from './generation-decision.js'

globalThis.fetch = () => { throw new Error('network_disabled_in_cadence_replay') }
const DAY = 86400000
const add = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const days = (a, b) => (Date.parse(a) - Date.parse(b)) / DAY
const weekday = d => new Date(`${d}T00:00:00Z`).getUTCDay()
const pct = (a, b) => 100 * (a / b - 1)
const round = n => Math.round(n * 10000) / 10000
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const mean = a => a.length ? round(a.reduce((x, y) => x + y, 0) / a.length) : null
const median = a => { const s = [...a].sort((x,y)=>x-y); return s.length ? (s[Math.floor((s.length-1)/2)]+s[Math.ceil((s.length-1)/2)])/2 : null }
const fourCurrencyTwoPercent = process.argv.includes('--four-currency-two-percent')
const penArsStudy = process.argv.includes('--pen-ars-study')
if(fourCurrencyTwoPercent&&penArsStudy)throw new Error('choose_one_cadence_study')
const targetCurrencies = penArsStudy ? ['PEN','ARS'] : fourCurrencyTwoPercent ? ['CLP','MXN','BRL','COP'] : ['BRL','CLP','MXN']
const scheduleThresholds = fourCurrencyTwoPercent ? [2] : [2,3,4]
function dueDate(date) { const eligible = add(date, 14); return add(eligible, (1 - weekday(eligible) + 7) % 7) }
function previousWeekday(date) { let d = add(date, -1); while ([0,6].includes(weekday(d))) d = add(d, -1); return d }

// A small specification model, not a production implementation. Publication is
// an explicit separate action supplied by a scenario, never a side effect of check.
function state(anchor) { return { anchor, case: null, checks: new Set(), publications: [], mergedChecks: 0 } }
function check(s, { date, observation, expectedDate, compatible = true, event = null, threshold = 3 }) {
  const fresh = Boolean(observation && observation.date === expectedDate && compatible && Number.isFinite(observation.value) && observation.value > 0)
  const cumulative = fresh && s.anchor ? pct(observation.value, s.anchor.value) : null
  const periodic = Boolean(s.anchor && date >= dueDate(s.anchor.publishedDate))
  const reasons = [!s.anchor ? 'bootstrap' : null, cumulative !== null && Math.abs(cumulative) >= threshold ? 'cumulative' : null,
    periodic ? 'periodic' : null, event ? 'event' : null].filter(Boolean)
  const fingerprint = JSON.stringify([date, observation?.date, observation?.value, compatible, expectedDate, event, threshold, s.anchor?.id])
  if (s.checks.has(fingerprint)) return { duplicateCheck: true, reasons, fresh, cumulative, caseId:s.case?.id }
  s.checks.add(fingerprint)
  if (reasons.length) {
    if (!s.case) s.case = { id: `case-${s.anchor?.id ?? 'bootstrap'}`, opened: date, seenReasons: [], calls: 0 }
    else s.mergedChecks++
    s.case.seenReasons = [...new Set([...s.case.seenReasons, ...reasons])]
    s.case.activeReasons = reasons
  } else if (s.case) s.case.activeReasons = []
  return { duplicateCheck:false, caseId:s.case?.id, fresh, cumulative, reasons,
    eligibleForOfflineReview: fresh && reasons.length > 0,
    status: !fresh ? 'data_unverified' : reasons.length ? 'review_candidate' : 'no_active_trigger' }
}
function publish(s, { id, date, observation, approved = false, stored = false, marketReview = true, historical = false }) {
  if (!approved || !stored || historical || !marketReview || s.publications.some(p => p.id === id)) return false
  s.anchor = { id, publishedDate:date, date:observation.date, value:observation.value }
  s.publications.push(s.anchor); s.case = null
  return true
}
function restoreBaseline(records, withdrawnIds) {
  return [...records].filter(r=>!withdrawnIds.includes(r.id)).sort((a,b)=>b.publishedDate.localeCompare(a.publishedDate))[0]??null
}

function syntheticCases() {
  const results = []
  const test = (name, fn) => { fn(); results.push({name, result:'passed', evidenceClass:'synthetic_specification_check'}) }
  const anchor = {id:'seed',publishedDate:'2026-10-05',date:'2026-10-02',value:100}
  const inspect = (s,date,value,extra={}) => check(s,{date,observation:{date:add(date,-1),value},expectedDate:add(date,-1),...extra})
  test('small_daily_moves_compound_both_directions',()=>{
    assert.ok(!inspect(state(anchor),'2026-10-16',100*1.003**9).reasons.includes('cumulative'))
    assert.ok(inspect(state(anchor),'2026-10-16',100*1.003**10).reasons.includes('cumulative'))
    assert.ok(inspect(state(anchor),'2026-10-16',96.9).reasons.includes('cumulative'))
  })
  test('persistent_crossing_reentry_and_duplicate_invocation_share_case',()=>{
    const s=state(anchor), a=inspect(s,'2026-10-07',103.1)
    assert.equal(inspect(s,'2026-10-07',103.1).duplicateCheck,true)
    assert.equal(inspect(s,'2026-10-08',102.8).reasons.length,0)
    assert.equal(inspect(s,'2026-10-09',103.2).caseId,a.caseId)
    assert.equal(inspect(s,'2026-10-12',96.8).caseId,a.caseId)
    assert.equal(s.publications.length,0)
  })
  test('calendar_due_and_missed_monday_persist',()=>{
    assert.equal(dueDate('2026-10-05'),'2026-10-19'); assert.equal(dueDate('2026-10-09'),'2026-10-26')
    assert.ok(inspect(state(anchor),'2026-10-20',100).reasons.includes('periodic'))
  })
  test('cumulative_event_periodic_merge',()=>{
    const s=state(anchor),r=inspect(s,'2026-10-19',104,{event:'policy-v1'})
    assert.deepEqual(r.reasons,['cumulative','periodic','event']);assert.equal(s.case.seenReasons.length,3)
  })
  test('holiday_known_vs_unknown_and_late_price',()=>{
    const p={date:'2026-10-15',value:104},s=state(anchor)
    assert.equal(check(s,{date:'2026-10-19',observation:p,expectedDate:'2026-10-15'}).fresh,true)
    assert.equal(check(s,{date:'2026-10-19',observation:p,expectedDate:'2026-10-16'}).fresh,false)
    assert.equal(check(s,{date:'2026-10-19',observation:p,expectedDate:null}).fresh,false)
  })
  test('source_basis_mismatch_blocks_cumulative_but_keeps_event_and_due',()=>{
    const r=inspect(state(anchor),'2026-10-19',105,{compatible:false,event:'policy-v1'})
    assert.equal(r.cumulative,null);assert.deepEqual(r.reasons,['periodic','event']);assert.equal(r.eligibleForOfflineReview,false)
  })
  test('failed_pending_archive_policy_only_do_not_reset_anchor',()=>{
    const s=state(anchor),o={date:'2026-10-15',value:104},base={id:'new',date:'2026-10-16',observation:o,approved:true,stored:true}
    for(const override of [{approved:false},{stored:false},{historical:true},{marketReview:false}]) assert.equal(publish(s,{...base,...override}),false)
    assert.deepEqual(s.anchor,anchor)
  })
  test('successful_publication_resets_once_and_reschedules',()=>{
    const s=state(anchor),args={id:'new',date:'2026-10-23',observation:{date:'2026-10-22',value:104},approved:true,stored:true}
    assert.equal(publish(s,args),true);assert.equal(publish(s,args),false);assert.equal(s.publications.length,1)
    assert.equal(dueDate(s.anchor.publishedDate),'2026-11-09')
  })
  test('stale_pending_draft_must_be_rechecked_not_silently_updated',()=>{
    const s=state(anchor),r=check(s,{date:'2026-10-19',observation:{date:'2026-10-14',value:104},expectedDate:'2026-10-16'})
    assert.equal(r.eligibleForOfflineReview,false);assert.equal(s.anchor.id,'seed')
  })
  test('no_baseline_is_bootstrap_not_zero_change',()=>{
    const r=inspect(state(null),'2026-10-06',100);assert.equal(r.cumulative,null);assert.deepEqual(r.reasons,['bootstrap'])
  })
  test('round_trip_hidden_by_net_change_is_visible_to_existing_daily_path',()=>{
    const rates=[];let d='2026-01-01'
    while(rates.length<90){if(![0,6].includes(weekday(d)))rates.push({currency:'CLP',rateType:'LOCAL_PER_USD',date:d,value:100,status:'ok',source:'API'});d=add(d,1)}
    rates.at(-2).value=104
    const out=inspectMovements({dailyRates:rates},'CLP',rates.at(-1).date+'T23:00:00Z')
    assert.equal(pct(rates.at(-1).value,100),0);assert.ok(out.windows.find(w=>w.key==='daily').candidate)
  })
  test('correction_restores_prior_anchor_not_today',()=>{
    const s=state(anchor);publish(s,{id:'bad',date:'2026-10-16',observation:{date:'2026-10-15',value:105},approved:true,stored:true})
    // Simulates baseline selection only, not DB withdrawal or public cache behavior.
    s.anchor=restoreBaseline([anchor,...s.publications],['bad'])
    assert.equal(dueDate(s.anchor.publishedDate),'2026-10-19')
    assert.equal(restoreBaseline([anchor,...s.publications],['bad','seed']),null)
  })
  return results
}

function numericSeries(dataset,currency) {
  const rows=dataset.dailyRates.filter(r=>r.currency===currency&&r.rateType==='LOCAL_PER_USD')
  const valid=rows.filter(r=>r.status==='ok'&&r.source!=='IMPUTED'&&(!r.imputationMethod||r.imputationMethod==='NONE')&&Number.isFinite(r.value)&&r.value>0&&!r.holidayCarry&&!r.providerChanged&& ![0,6].includes(weekday(r.date)))
  const map=new Map();const conflicts=[];let identicalDuplicates=0
  for(const r of valid){if(map.has(r.date)){if(map.get(r.date).value!==r.value)conflicts.push(r.date);else identicalDuplicates++}else map.set(r.date,r)}
  const series=[...map.values()].filter(r=>!conflicts.includes(r.date)).sort((a,b)=>a.date.localeCompare(b.date))
  return {series,audit:{rawRows:rows.length,acceptedRows:series.length,excludedRows:rows.length-valid.length,identicalDuplicates,conflictingDates:[...new Set(conflicts)]}}
}

// Nonoverlapping 20-observation windows with the same fixed seed for every
// threshold. These anchors are hypothetical, independent of actual approvals.
function fixedWindows(series, size, offset=0) {
  const rows=series.slice(-(size+1)), windows=[]
  for(let start=offset;start+20<rows.length;start+=20){
    const anchor=rows[start], later=rows.slice(start+1,start+21),changes=later.map(r=>pct(r.value,anchor.value))
    const crosses=Object.fromEntries([2,3,4].map(t=>[t,changes.findIndex(v=>Math.abs(v)>=t)+1||null]))
    windows.push({anchorDate:anchor.date,endDate:later.at(-1).date,maxAbsPct:round(Math.max(...changes.map(Math.abs))),endPct:round(changes.at(-1)),firstCrossObservation:crosses,
      revertedAfterThree:crosses[3]!==null&&Math.abs(changes.at(-1))<3,prices:[anchor,...later].map(r=>({date:r.date,value:r.value}))})
  }
  return {windowCount:windows.length,offset,unusedTailObservations:size-offset-windows.length*20,
    byThreshold:[2,3,4].map(t=>({threshold:t,crossed:windows.filter(w=>w.firstCrossObservation[t]!==null).length,medianFirstObservation:median(windows.filter(w=>w.firstCrossObservation[t]!==null).map(w=>w.firstCrossObservation[t]))})),
    twoButNotThree:windows.filter(w=>w.firstCrossObservation[2]!==null&&w.firstCrossObservation[3]===null).length,
    threeButNotFour:windows.filter(w=>w.firstCrossObservation[3]!==null&&w.firstCrossObservation[4]===null).length,
    threeCrossThenReturn:windows.filter(w=>w.revertedAfterThree).length,
    matchedTwoToThreeDelay:mean(windows.filter(w=>w.firstCrossObservation[3]!==null).map(w=>w.firstCrossObservation[3]-w.firstCrossObservation[2])), windows}
}

function schedule(series,size,threshold,delayObservations) {
  const rows=series.slice(-(size+1)), seed=rows[0], start=add(seed.date,1), end=add(rows.at(-1).date,1)
  const s=state({id:'assumed-seed',date:seed.date,value:seed.value,publishedDate:start})
  let index=0,triggerDays=0,delayedDays=0,needSince=null,lastCountedObservation=null,readyObservations=0
  const records=[]
  for(let date=add(start,1);date<=end;date=add(date,1)){
    if([0,6].includes(weekday(date)))continue
    while(index+1<rows.length&&rows[index+1].date<date)index++
    const observation=rows[index],expectedDate=previousWeekday(date)
    const result=check(s,{date,observation,expectedDate,threshold})
    if(!result.fresh)delayedDays++
    if(result.eligibleForOfflineReview){
      triggerDays++
      if(needSince===null){needSince=date;readyObservations=0;lastCountedObservation=observation.date}
      else if(observation.date!==lastCountedObservation){readyObservations++;lastCountedObservation=observation.date}
      if(readyObservations>=delayObservations){
        records.push({date,observedDate:observation.date,anchorDate:s.anchor.date,anchorValue:s.anchor.value,value:observation.value,changePct:round(result.cumulative),reasons:result.reasons,waitDays:days(date,needSince)})
        publish(s,{id:`assumed-${date}`,date,observation,approved:true,stored:true});needSince=null
      }
    } else if(result.fresh&&!result.reasons.length){needSince=null}
  }
  const intervals=records.map((r,i)=>days(r.date,i?records[i-1].date:start))
  return {threshold,delayObservations,assumedPublications:records.length,cumulativeOnly:records.filter(r=>r.reasons.includes('cumulative')&&!r.reasons.includes('periodic')).length,
    periodicOnly:records.filter(r=>r.reasons.includes('periodic')&&!r.reasons.includes('cumulative')).length,
    merged:records.filter(r=>r.reasons.length>1).length,triggerCheckDays:triggerDays,mergedWaitingChecks:s.mergedChecks,dataDelayedDays:delayedDays,
    meanIntervalCalendarDays:mean(intervals),medianIntervalCalendarDays:median(intervals),minIntervalCalendarDays:intervals.length?Math.min(...intervals):null,maxIntervalCalendarDays:intervals.length?Math.max(...intervals):null,
    rightCensoredDays:days(end,records.at(-1)?.date??start),records}
}

function holdScenario(series,size,threshold) {
  const rows=series.slice(-(size+1)), seed=rows[0],s=state({id:'unpublished-seed',date:seed.date,value:seed.value,publishedDate:add(seed.date,1)})
  let raw=0,positive=0,negative=0,reentries=0,was=false;const crossings=[]
  for(const r of rows.slice(1)){
    const result=check(s,{date:add(r.date,1),observation:r,expectedDate:r.date,threshold})
    const active=result.reasons.includes('cumulative')
    if(active){raw++;if(result.cumulative>0)positive++;else negative++;if(!was){reentries++;crossings.push({date:r.date,changePct:round(result.cumulative)})}}
    was=active
  }
  return {threshold,rawCumulativeSignalDays:raw,positiveDays:positive,negativeDays:negative,crossingEpisodes:reentries,openCases:s.case?1:0,paidCalls:0,publications:0,mergedChecks:s.mergedChecks,crossings}
}

const inputPath='data/fx-full-history.json',bytes=fs.readFileSync(inputPath),data=JSON.parse(bytes)
const manuscriptDir='.local-reports/reviewable'
const manuscriptFiles=fs.readdirSync(manuscriptDir).filter(f=>targetCurrencies.some(currency=>f.startsWith(`${currency}-`))&&f.endsWith('.json')).sort()
const protectedFiles=[inputPath,'package.json','scripts/currency-report/generation-decision.js','scripts/currency-report/lifecycle-control.js',...manuscriptFiles.map(f=>`${manuscriptDir}/${f}`)]
const before=Object.fromEntries(protectedFiles.map(f=>[f,digest(fs.readFileSync(f))]))
const manuscripts=manuscriptFiles.map(f=>JSON.parse(fs.readFileSync(`${manuscriptDir}/${f}`)))
const output={version:'publication-cadence-offline-study/2',createdAt:new Date().toISOString(),targetCurrencies,scheduleThresholds,scope:'local offline research; hypothetical publication policies; no live writing, publication or network',
  input:{path:inputPath,sha256:digest(bytes),baseDate:data.baseDate,pointInTimeRevisionArchive:false},
  actualLocalRecordAudit:{count:manuscripts.length,statusCounts:manuscripts.reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{}),publishedTimestampCount:manuscripts.filter(r=>r.publishedAt).length,scope:'only named currency JSONs in .local-reports/reviewable; no production DB queried'},
  assumptions:['Stored provider dates are treated as ordered numeric observations, not proven local trading dates.',
    'Provider identity, price basis, observation timestamp and historical release calendars are absent: production publication eligibility remains unverified.',
    'Hypothetical check weekdays use Korea calendar dates; prior Monday-Friday date expected, with no inferred official holidays.',
    'Every eligible schedule candidate is assumed to have evidence, funding and approval; none of these is established by prices.',
    'Schedule counts include cumulative plus periodic only. Existing short-window signals are measured separately, not added as publications.',
    'No historical news/event ground truth or contemporaneous data revision archive: recall of important events and true publishing frequency cannot be measured.'],
  syntheticChecks:syntheticCases(),currencies:[]}
for(const currency of targetCurrencies){
  const {series,audit}=numericSeries(data,currency),recent=series.slice(-756)
  assert.ok(series.length>=847,`insufficient_history:${currency}`)
  const diagnostics={...audit,providerMissing:recent.filter(r=>!r.provider).length,observedAtMissing:recent.filter(r=>!r.observedAt).length,recentRows:recent.length,sourceTags:[...new Set(recent.map(r=>r.source))]}
  const studies=[],windowSupported=['BRL','CLP','MXN'].includes(currency)
  for(const size of [252,756]){
    const rows=series.slice(-(size+1)), historyStart=series.length-size
    const signals=[]
    for(let i=historyStart;windowSupported&&i<series.length;i++){
      const result=inspectMovements({dailyRates:series.slice(Math.max(0,i-90),i+1)},currency,series[i].date+'T23:00:00Z')
      signals.push({date:series[i].date,unverified:result.status!=='available',windows:result.windows.filter(w=>w.candidate&&w.status==='verified').map(w=>w.key)})
    }
    const fixed=fixedWindows(series,size)
    const phases=Array.from({length:20},(_,offset)=>fixedWindows(series,size,offset))
    studies.push({observations:size,start:rows[1].date,end:rows.at(-1).date,seedDate:rows[0].date,
      fixedAnchorWindows:fixed,
      anchorPhaseSensitivity:[2,3,4].map(t=>({threshold:t,phaseCount:20,
        minCrossedWindowPct:round(Math.min(...phases.map(p=>100*p.byThreshold.find(x=>x.threshold===t).crossed/p.windowCount))),
        maxCrossedWindowPct:round(Math.max(...phases.map(p=>100*p.byThreshold.find(x=>x.threshold===t).crossed/p.windowCount))),
        note:'Overlapping shifts of the same history, not independent samples or publication counts.'})),
      hypotheticalSchedules:[0,3].flatMap(delay=>scheduleThresholds.map(t=>schedule(series,size,t,delay))),
      neverApproved:holdScenario(series,size,fourCurrencyTwoPercent?2:3),
      existingWindowSignals:!windowSupported?{status:'not_evaluated',reason:'Existing inspector does not accept this currency; not modified by this offline study.',twoOnlyWindowsWithoutAnyExistingSignal:null}:{daysWithAny:signals.filter(r=>r.windows.length).length,unverifiedDays:signals.filter(r=>r.unverified).length,byWindow:Object.fromEntries(['daily','five','twenty'].map(k=>[k,signals.filter(r=>r.windows.includes(k)).length])),
        twoOnlyWindowsWithoutAnyExistingSignal:fixed.windows.filter(w=>w.firstCrossObservation[2]!==null&&w.firstCrossObservation[3]===null&&!signals.some(s=>s.date>w.anchorDate&&s.date<=w.endDate&&s.windows.length)).map(w=>({anchorDate:w.anchorDate,endDate:w.endDate,maxAbsPct:w.maxAbsPct})),records:signals}})
  }
  output.currencies.push({currency,diagnostics,studies})
}
output.preservation={protectedFiles:protectedFiles.length,unchanged:protectedFiles.every(f=>before[f]===digest(fs.readFileSync(f)))}
assert.equal(output.preservation.unchanged,true)
const root=path.resolve('.local-reports/private');fs.mkdirSync(root,{recursive:true})
const dir=fs.mkdtempSync(path.join(root,'cadence-replay-20261027-'))
fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(output,null,2),{flag:'wx'})
console.log(JSON.stringify({output:path.relative(process.cwd(),dir),syntheticChecks:output.syntheticChecks.length,preservation:output.preservation,
  currencies:output.currencies.map(c=>({currency:c.currency,studies:c.studies.map(s=>({observations:s.observations,start:s.start,end:s.end,
    crossed:s.fixedAnchorWindows.byThreshold.map(x=>x.crossed),windowCount:s.fixedAnchorWindows.windowCount,
    schedules:s.hypotheticalSchedules.map(x=>[x.threshold,x.delayObservations,x.assumedPublications,x.cumulativeOnly,x.periodicOnly,x.merged]),
    hold:s.neverApproved.rawCumulativeSignalDays,twoOnlyNoExisting:s.existingWindowSignals.twoOnlyWindowsWithoutAnyExistingSignal}))}))},null,2))
