// New opt-in version; the previous retail-only registry and saved plans stay intact.
import { chileStatisticScopes } from './chile-statistic-scopes.js'
import { planResearchNeeds } from './research-needs.js'
import { fingerprint } from './research-harness.js'

export function chileConsumptionScopes() {
  const retail = chileStatisticScopes()
  return { version: 'clp-consumption-scopes/1', reviewedOn: '2026-10-15', country: 'CLP',
    verifiedDefinitionPeriods: ['2026-08'], terms: retail.terms,
    retailRegistry: retail,
    pay: { id: 'cl-ir-real', label: '실질 시간당 보수 IR Real',
      scope: { subject: 'cl_ir_real_formal_employers_5plus_hourly', metric: 'real_pay', unit: 'percent',
        comparison: 'year_over_year', channel: 'not_applicable', priceBasis: 'real', adjustment: 'unadjusted', baseYear: '2023' },
      population: '칠레 5인 이상 공식 기업·기관의 직접 고용 인력, 조사 대상 경제활동 범위.',
      definition: '정규 근로시간당 보수 지수의 IPC 조정값. 전체 임금총액·월급·가구소득이 아니다.',
      qualification: '월 보수가 같아도 계약 근로시간 감소로 시간당 지표가 상승할 수 있다.',
      excludedInference: '가구 구매력·소비·기업 매출의 증가 또는 인과를 단독으로 확정하지 않는다.',
      source: { url: 'https://www.ine.gob.cl/docs/default-source/sueldos-y-salarios/boletines/espa%C3%B1ol/ir-icl-base-anual-2023-100/2026/agosto-2026.pdf?sfvrsn=fdcaf8a2_4',
        pages: [1, 6], printedPublicationDate: '2026-10-07', publicationTime: null, provisional: true,
        sourceVersion: 'current_file_not_archived' },
      methodology: { url: 'https://www.ine.gob.cl/docs/default-source/sueldos-y-salarios/metodologias/base-anual-2023/documento-metodol%C3%B3gico-ir-icl-2023.pdf?sfvrsn=570d6203_7', pages: [6] },
      landingUrl: 'https://www.ine.gob.cl/estadisticas-por-tema/mercado-laboral/remuneraciones-y-costos-laborales' },
    comparisonLimit: '동일 월·전년동월비의 맥락 비교만 허용한다. 서로 다른 모집단·기준년의 지수 수준을 직접 비교하거나 인과로 연결하지 않는다.' }
}

export function planChileConsumptionNeeds({ period, ...input }) {
  if (input.packet?.currency !== 'CLP' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new Error('invalid_chile_statistic_scope')
  if (period > input.packet.baseDate?.slice(0, 7)) throw new Error('future_target_period')
  if (input.requirements?.category !== undefined || input.requirements?.consumption !== undefined) throw new Error('statistic_scope_already_defined')
  const registry = chileConsumptionScopes(), registered = registry.verifiedDefinitionPeriods.includes(period)
  const topics = input.topics ?? ['real_pay', 'retail']
  const selection = planResearchNeeds({ ...input, topics })
  if (!['consumption', 'category'].every(id => selection.questions.some(q => q.id === id))) throw new Error('consumption_questions_not_selected')
  const [total, category] = registry.retailRegistry.definitions
  const row = definition => ({ id: definition.id, period, scope: definition.scope })
  const requirements = { ...input.requirements }
  if (registered) Object.assign(requirements, { consumption: [row(registry.pay), row(total)], category: [row(total), row(category)] })
  const plan = planResearchNeeds({ ...input, topics, requirements }), registryHash = fingerprint(registry)
  const targets = [registry.pay, total, category].map(d => ({ id: d.id, scope: d.scope, period,
    definitionStatus: registered ? 'reviewed_for_period' : 'period_definition_review_required',
    locator: registered ? (d.source ?? { url: registry.retailRegistry.definitionSource.url, pages: d.pages })
      : { url: d.landingUrl ?? registry.retailRegistry.landingUrl, pages: [] } }))
  return { ...plan, planId: fingerprint({ basePlanId: plan.planId, registryHash, period }),
    statisticRegistry: { version: registry.version, registryHash, targets, period,
      status: registered ? 'definition_only' : 'review_required', comparisonLimit: registry.comparisonLimit,
      payQualification: registry.pay.qualification, sourceAvailability: 'not_assessed', historicalVintage: 'not_assessed', terms: registry.terms },
    discoveryRequests: plan.discoveryRequests.map(r => ['consumption', 'category'].includes(r.needId)
      ? { ...r, sourceTargets: targets.filter(t => r.scopeConstraints.some(c => c.id === t.id)),
        adapter: 'chile_official_monthly_pending_review', collectionPeriod: period,
        limitation: '공식 월별 파일 수집 후 기간·개정본·수치·문장 지지 검토 필요. 수집 성공은 작성·게시 승인이 아니다.' } : r) }
}
