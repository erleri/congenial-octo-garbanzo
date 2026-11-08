import type { CurrencyReport, ReportEvidence } from '../../types/currencyReport'
import { sourcePublicationTiming, reportPriceSourceLabel } from '../report-source-timing.js'

export function reportMetadata(report: CurrencyReport) {
  const isoTime = (value: string | null | undefined) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null
  return {
    observedDate: report.observedDate,
    observationAt: isoTime(report.observationAt),
    fetchedAt: isoTime(report.marketData ? report.marketData.fetchedAt : report.comparison?.datasetFetchedAt),
    source: reportPriceSourceLabel(report) ?? ({ API: 'API 수집값', JSON: 'JSON 자료', EXCEL: 'Excel 입력값' } as Record<string, string>)[report.marketData?.source ?? ''] ?? '제공 경로 미기록',
    unit: `${report.currency} / 1 USD`,
  }
}

export function evidenceMetadata(evidence: ReportEvidence, report?: CurrencyReport) {
  return {
    source: evidence.id.startsWith('principle-') ? '일반 원리' : evidence.provenance === 'official' ? '공식 자료' : evidence.provenance === 'market_reporting' ? '시장 보도' : '출처 유형 미기록',
    publishedAt: evidence.publishedAt || '미제공',
    period: evidence.period || '대상 기간 미제공',
    ...(report ? { sourceTiming: sourcePublicationTiming(evidence, report) } : {}),
  }
}
