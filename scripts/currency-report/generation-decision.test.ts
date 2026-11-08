import { describe, expect, it } from 'vitest'
import { decideGeneration, eventBinding, inspectMovements, trialEventHistory } from './generation-decision.js'

function dataset(lastValue = 100) {
  const rows = []
  for (let d = 1; d <= 140; d++) {
    const date = new Date(Date.UTC(2026, 0, d)), weekday = date.getUTCDay()
    if (weekday && weekday < 6) rows.push({ currency: 'BRL', rateType: 'LOCAL_PER_USD', date: date.toISOString().slice(0, 10), status: 'ok', value: 100, source: 'API', imputationMethod: 'NONE' })
  }
  rows[rows.length - 1].value = lastValue
  return { baseDate: rows.at(-1)!.date, dailyRates: rows }
}
const asOf = '2026-05-20T23:00:00Z'
function reviewedEvent() {
  const event = { id: 'copom:2026-05', country: 'BRL', kind: 'policy', period: '2026-05', revision: 'first', state: 'published', publishedAt: '2026-05-20T12:00:00Z', sourceUrl: 'https://www.bcb.gov.br/policy', bodyHash: 'a'.repeat(64), summary: '새 정책 조건을 공개한 공식 발표입니다.', review: {} }
  event.review = { binding: eventBinding(event), checkedAt: asOf, novelty: 'new', previousExplanation: '기존 조건을 유지하던 설명입니다.', newFact: '정책 결정의 새로운 조건입니다.', readerChange: '새 조건이 기존 설명을 바꿉니다.', originalVerified: true, bodyHash: event.bodyHash, reuse: 'verified', purpose: 'policy_update' }
  return event
}
describe('event driven generation decision', () => {
  it('uses prior sixty returns, handles equality, and keeps local currency direction', () => {
    const p = inspectMovements(dataset(102), 'BRL', asOf)
    expect(p.windows.map(w => w.baselineCount)).toEqual([60, 60, 60])
    expect(p.windows[0]).toMatchObject({ candidate: true, sharp: true, direction: 'local_weaker', threshold: .75 })
    expect(p.windows[1].threshold).toBe(2)
    expect(p.windows[2].candidate).toBe(false)
  })
  it('keeps a sharp move without original evidence as investigation, not writing authority', () => {
    const result = decideGeneration({ dataset: dataset(103), currency: 'BRL', asOf })
    expect(result.status).toBe('research_candidate')
    expect(result.authorization).toEqual({ paidCallAuthorized: false, publicationApproved: false })
  })
  it('allows a reviewed policy update during quiet prices without claiming a price cause', () => {
    const result = decideGeneration({ dataset: dataset(), currency: 'BRL', asOf, events: [reviewedEvent()] })
    expect(result.status).toBe('draft_candidate')
    expect(result.events[0].purpose).toBe('policy_update')
  })
  it('blocks event reprocessing even after a failed writer, and invalidates stale review binding', () => {
    const event = reviewedEvent()
    for(const status of ['output_hold','cost_unresolved']) {
      const history=trialEventHistory([{currency:'BRL',status,events:[{id:event.id,binding:eventBinding(event)}]}])
      expect(decideGeneration({ dataset: dataset(), currency: 'BRL', asOf, events: [event], history }).status).toBe('duplicate')
    }
    expect(decideGeneration({ dataset: dataset(), currency: 'BRL', asOf, events: [{ ...event, summary: '새로 변경된 다른 발표 내용입니다.' }] }).events[0].reason).toBe('change_review_required')
  })
  it('does not count scheduled releases or future review as confirmed new explanation', () => {
    const event = reviewedEvent()
    expect(decideGeneration({ dataset: dataset(), currency: 'BRL', asOf, events: [{ ...event, state: 'scheduled' }] }).status).toBe('no_new_interpretation')
    expect(decideGeneration({ dataset: dataset(), currency: 'BRL', asOf, events: [{ ...event, review: { ...event.review, checkedAt: '2026-05-21T00:00:00Z' } }] }).events[0].reason).toBe('change_review_required')
  })
  it('keeps price failure separate from valid policy facts and prioritizes correction', () => {
    const d = dataset(), row = d.dailyRates.at(-1)!
    d.dailyRates.push({ ...row, value: 120 })
    const event = reviewedEvent()
    const result = decideGeneration({ dataset: d, currency: 'BRL', asOf, events: [event] })
    expect(result.price.status).toBe('failed'); expect(result.status).toBe('draft_candidate')
    const correction = { ...event, kind: 'correction' }
    correction.review = { ...event.review, binding: eventBinding(correction) }
    expect(decideGeneration({ dataset: d, currency: 'BRL', asOf, events: [correction] }).status).toBe('correction_required')
  })
  it('does not treat old or missing prices as a normal quiet market', () => {
    expect(decideGeneration({ dataset: dataset(), currency: 'BRL', asOf: '2026-10-11T00:00:00Z' }).status).toBe('data_failed')
    expect(decideGeneration({ dataset: { dailyRates: [] }, currency: 'BRL', asOf }).price.issues).toContain('no_valid_observation')
  })
  it('groups a continuing price episode but reopens it after a quiet interval', () => {
    const prior = decideGeneration({ dataset: dataset(103), currency: 'BRL', asOf })
    expect(decideGeneration({ dataset: dataset(103), currency: 'BRL', asOf, history: [prior] }).status).toBe('duplicate')
    const quiet = decideGeneration({ dataset: dataset(), currency: 'BRL', asOf: '2026-05-20T23:30:00Z' })
    expect(decideGeneration({ dataset: dataset(103), currency: 'BRL', asOf: '2026-05-20T23:45:00Z', history: [prior, quiet] }).status).toBe('research_candidate')
  })
  it('accepts a date-only verified policy fact but holds a date-only market cause', () => {
    const event = { ...reviewedEvent(), publishedAt: null, publishedDate: '2026-05-20' }
    event.review = { ...event.review, binding: eventBinding(event) }
    expect(decideGeneration({ dataset: dataset(), currency: 'BRL', asOf, events: [event] }).status).toBe('draft_candidate')
    const market = { ...event, review: { ...event.review, purpose: 'fx_explanation', marketLinkVerified: true } }
    expect(decideGeneration({ dataset: dataset(103), currency: 'BRL', asOf, events: [market] }).events[0].reason).toBe('market_scope_unverified')
  })
})
