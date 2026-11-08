// Definition registry and offline handoff only. No collection, numeric facts,
// evidence admissions, model calls or publication. Do not infer a historical
// vintage from a dated filename: each retrieved source still needs that review.
import { planResearchNeeds } from './research-needs.js'
import { fingerprint } from './research-harness.js'

export const CHILE_STATISTIC_SCOPES_VERSION = 'clp-retail-scopes/1'
const landingUrl = 'https://www.ine.gob.cl/estadisticas-por-tema/comercio-y-servicios/actividad-mensual-del-comercio'
const bulletinUrl = 'https://www.ine.gob.cl/docs/default-source/actividad-mensual-del-comercio/boletines/2026/bolet%C3%ADn-sectores-econ%C3%B3micos-%C3%ADndice-de-actividad-del-comercio-(iac)-agosto-de-2026.pdf?sfvrsn=41c7f202_4'
const scope = (subject, overrides = {}) => ({ subject, metric: 'retail', unit: 'percent', comparison: 'year_over_year',
  channel: 'all', priceBasis: 'real', adjustment: 'unadjusted', baseYear: '2018', ...overrides })
const definitions = [
  { id: 'cl-iacm-total', label: '소매 전체 IACM', scope: scope('cl_iacm_total'), pages: [1, 2],
    population: '칠레 division 47 전체와 division 45의 소매 부분.',
    excludedInference: 'division 47 단독·전체 상업활동 IAC·가계소비 전체와 동일하지 않다.' },
  { id: 'cl-iacm-electronics-home-tech', label: '전자·가정용·기술제품군',
    scope: scope('cl_iacm_electronics_home_technology'), pages: [2],
    population: 'IACM의 전자·가정용·기술제품군.',
    excludedInference: 'TV·가전 단독 판매량, 특정 기업 셀아웃·점유율로 확대하지 않는다.' },
  { id: 'cl-iac-division47', label: '차량 제외 소매 division 47', scope: scope('cl_iac_division47'), pages: [1],
    population: '차량·오토바이 제외 소매 division 47.',
    excludedInference: 'IACM 전체의 대체값으로 사용하지 않는다.' },
  { id: 'cl-icem-total', label: '온라인 소매 ICEM',
    scope: scope('cl_icem_division47', { channel: 'online', priceBasis: 'nominal' }), pages: [1, 3],
    population: 'division 47 전자상거래.',
    excludedInference: '전 채널 실질 소매나 판매수량으로 해석하지 않는다.' },
]

/** Fresh copies prevent callers from mutating the registry. The verified period
 * is deliberately finite: another month's definition/base/classification must
 * be checked before reusing it. This is not a claim of data availability. */
export function chileStatisticScopes() {
  return structuredClone({ version: CHILE_STATISTIC_SCOPES_VERSION, country: 'CLP', publisher: 'INE Chile',
    reviewedOn: '2026-10-14', reviewMethod: 'manual_official_original', verifiedDefinitionPeriods: ['2026-08'],
    landingUrl, definitionSource: { url: bulletinUrl, issue: '335', printedPublicationDate: '2026-09-30',
      publicationTime: null, retrievedVersion: 'current_file_not_archived', provisional: true,
      revisionPolicyLocator: 'page 4; corrections are disclosed separately' },
    cadence: 'monthly', automaticCollector: 'not_implemented',
    terms: { url: 'https://www.ine.gob.cl/terminos-de-uso-y-licencia-de-datos-abiertos',
      license: 'CC-BY-SA-4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      status: 'conditions_identified_not_per_record_approval',
      obligations: ['출처·라이선스 명시', '변경 표시', '파생물의 동일조건 공유', 'INE의 보증·승인으로 표시하지 않음'] },
    definitions, unresolved: ['실질 보수의 모집단·기준년·비교 정의 등록', '상품군 세부 품목 및 TV 단독 계열 확인',
      '자동 원문 수집·수정본 보존', '개별 수치·기간·발표시각·재사용 조건 및 원문 지지 검토'],
  })
}

/** Opt-in adapter around the existing planner. Only the category comparison is
 * filled. Existing core/pay definitions, packets and reports are never changed.
 * CLI: research-needs-local.js --input <envelope.json>
 *      --scope-profile clp-retail --period YYYY-MM
 * Outside the reviewed period: define_scope, no invented latest release URL.
 */
export function planChileRetailNeeds({ period, ...input }) {
  if (input.packet?.currency !== 'CLP' || typeof period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
    throw new Error('invalid_chile_statistic_scope')
  if (period > input.packet.baseDate?.slice(0, 7)) throw new Error('future_target_period')
  if (input.requirements?.category !== undefined) throw new Error('category_scope_already_defined')
  const registry = chileStatisticScopes(), registered = registry.verifiedDefinitionPeriods.includes(period)
  const targetDefinitions = registry.definitions.slice(0, 2)
  const topics = input.topics === undefined ? ['retail'] : input.topics
  const selection = planResearchNeeds({ ...input, topics })
  if (!selection.questions.some(q => q.id === 'category')) throw new Error('category_question_not_selected')
  const requirements = { ...input.requirements }
  if (registered) requirements.category = targetDefinitions.map(d => ({ id: d.id, period, scope: d.scope }))
  const plan = planResearchNeeds({ ...input, topics, requirements })
  const registryHash = fingerprint(registry)
  const targets = targetDefinitions.map(d => ({ profileId: d.id, scope: d.scope, period,
    locator: registered ? { url: bulletinUrl, pages: d.pages } : { url: landingUrl, pages: [] },
    definitionStatus: registered ? 'reviewed_for_period' : 'period_definition_review_required',
    excludedInference: d.excludedInference }))
  return { ...plan, planId: fingerprint({ basePlanId: plan.planId, registryHash, period }),
    statisticRegistry: { version: registry.version, registryHash, period, targets,
      status: registered ? 'definition_only' : 'review_required',
      sourceAvailability: 'not_assessed', historicalVintage: 'not_assessed',
      terms: registry.terms, unresolved: registry.unresolved },
    discoveryRequests: plan.discoveryRequests.map(r => r.needId !== 'category' ? r : { ...r,
      sourceTargets: targets, query: `site:ine.gob.cl IACM ${period} productos electrónicos equipamiento hogar tecnológicos`,
      limitation: '공식 원문 위치 안내이며 수집 실행이 아니다. 기존 HTML 수집기로 PDF를 처리하거나 정의를 수치 근거로 승인하지 않는다.' }),
  }
}
