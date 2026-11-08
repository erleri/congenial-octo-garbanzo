// Reuses official price calculations and the common question planner. No I/O.
import { bcchApiResearchSeries } from './bcch-api.js'
import { prepareOfficialClpResearch } from './clp-official-price.js'
import { researchPlan } from './research-harness.js'

export function prepareBcchReportInput(snapshot, options) {
  const {series,throughSessionDate}=bcchApiResearchSeries(snapshot,options)
  const result=prepareOfficialClpResearch(series,{throughSessionDate,asOf:options.asOf})
  const questionPlan=researchPlan(result.packet)
  return {...result,version:'bcch-report-input/1',sourceSnapshotSha256:series.rawSha256,
    sourceAdapter:'bcch-bde-api/1',questionPlan,
    excludedEffectiveDates:series.calendarUnverified,
    writingEligibility:{eligible:false,reason:'original_market_evidence_and_content_review_required'},
    contentQuality:'not_assessed',publicationApproved:false,modelCalls:0,newApiCostUsd:0}
}
