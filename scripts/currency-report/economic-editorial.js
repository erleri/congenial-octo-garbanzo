import { createHash } from 'node:crypto'

export const ECONOMIC_EDITORIAL_VERSION = 'economic-editorial/1'
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const meaningful = value => typeof value === 'string' && value.trim().length >= 10 && value.length <= 240
const watchBinding = (packet, scopes, candidates) => hash({ currency: packet.currency, baseDate: packet.baseDate, scopes, candidates })

// A local source judgment, not an automatic semantic approval or user identity.
export function bindEconomicWatch(packet, scopes, candidates, review) {
  return { candidates: structuredClone(candidates), review: { ...review, binding: watchBinding(packet, scopes, candidates) } }
}

export function economicEditorialPlan(packet, scopes, watchReview) {
  const candidates = watchReview?.candidates ?? []
  if (watchReview !== undefined && (!Array.isArray(watchReview?.candidates) || candidates.length > 2
    || !['agent', 'human'].includes(watchReview.review?.origin) || watchReview.review.status !== 'checked'
    || !meaningful(watchReview.review.reason) || watchReview.review.binding !== watchBinding(packet, scopes, candidates)))
    throw new Error('economic_watch_review_required')
  const seen = new Set()
  const watchCandidates = candidates.map(c => {
    const source = scopes.find(s => s.evidenceId === c?.evidenceId)
    if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) || seen.has(c.id) || !source
      || !meaningful(c.signal) || !meaningful(c.judgmentPurpose)
      || !Array.isArray(c.claimIds) || !c.claimIds.length || new Set(c.claimIds).size !== c.claimIds.length
      || c.claimIds.some(id => !source.admittedClaims.some(a => a.id === id))) throw new Error('economic_watch_source_required')
    seen.add(c.id)
    return { id: c.id, evidenceId: c.evidenceId, claimIds: [...c.claimIds], signal: c.signal, judgmentPurpose: c.judgmentPurpose }
  })
  const periods = [...new Set(scopes.map(s => s.period).filter(p => typeof p === 'string' && p.trim()))]
  const backgroundOnly=scopes.length>0&&scopes.every(s=>packet.evidence.find(e=>e.id===s.evidenceId)?.provenance?.reportRole==='consumer_background')
  const inegiSources=[...new Set(scopes.map(s=>packet.evidence.find(e=>e.id===s.evidenceId))
    .filter(e=>e?.publisher==='INEGI'&&e.provenance?.reportRole==='consumer_background').map(e=>e.provenance.sourceAttribution))]
  return { version: ECONOMIC_EDITORIAL_VERSION,
    storyBeats: scopes.map(s => ({ evidenceId: s.evidenceId, claimIds: s.admittedClaims.map(c => c.id) })),
    placement: {
      lead: backgroundOnly?'검토한 대상 월의 소비 환경에서 확인된 관측을 먼저 말한다. 최근 수집한 자료를 오늘의 새 발표로 표현하지 않는다.':'새 발표에서 확인한 변화와 대조를 먼저 말한다. 제목과 요약은 같은 새 정보를 짧게 연결한다.',
      body: '같은 근거의 새 사실·구성·상쇄 관계를 한 문단으로 묶는다. 원문이 허용한 의미까지만 설명하고, 근거가 짧으면 본문도 짧게 끝낸다.',
      inlineConditions: '설명의 방향·범위를 바꾸는 반대 사실과 적용 조건은 해당 문장에 유지한다. 중요 조건을 공통 한계로 숨기지 않는다.',
      reviewOnly: 'scopeCards의 제외 범위와 자료 공백은 주장 검사용이다. 이를 문단 끝의 면책 문장이나 관찰 변수로 복사하지 않는다.',
      commonLimits: '아래 codeOwnedLimitations는 코드가 한 곳에 표시한다. 본문·요약·watch에 재진술하지 않는다.',
    },
    codeOwnedLimitations: [
      '이 자료는 경제·소비 환경 업데이트이며 저장 환율 변화의 원인으로 확인된 설명은 아닙니다.',
      ...(periods.length > 1 ? ['지표별 대상 기간이 다릅니다. 서로 다른 기간의 지표를 차감하거나 같은 달의 수치로 합치지 않습니다.'] : []),
      ...(inegiSources.length?[`${inegiSources.join(' ')} 지표 정리·전년 대비 계산·분석은 LATAM FX가 제공하며 INEGI의 공식 견해가 아닙니다.`]:[]),
    ], watchCandidates }
}

// Keep all existing notices. If four slots cannot hold them, fail closed rather
// than silently truncating a warning. Public CurrencyReport stays unchanged.
export function economicLimitations(packet, editorialPlan) {
  const notes = [...new Set([...packet.limitations, ...editorialPlan.codeOwnedLimitations])]
  const result = notes.length <= 4 ? notes : [...notes.slice(0, 3), notes.slice(3).join(' ')]
  if (result.some(n => typeof n !== 'string' || !n.length || n.length > 480)) throw new Error('economic_limitations_overflow')
  return result
}
