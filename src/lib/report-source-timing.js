// Shared, pure source metadata. Publication order is never event causality.
const exactTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
// Display provenance without labelling an average or a publisher quote as an
// official market close. This is presentation, not verification/approval.
export function reportPriceSourceLabel(report) {
  const b=report?.marketData?.reportPriceBasis
  if(!b||b.observations?.at(-1)?.localSessionDate!==report.observedDate)return null
  if(report.currency==='CLP'&&b.provider==='Banco Central de Chile'&&b.seriesId==='F073.TCO.PRE.Z.D'
    &&b.priceKind==='official_transaction_weighted_average'&&b.dateBasis==='underlying_local_transaction_day')
    return '칠레 중앙은행 · 거래가중평균'
  if(report.currency==='MXN'&&b.provider==='Banco de México'&&b.seriesId==='CA18:closing_reference'
    &&b.priceKind==='official_closing_reference'&&b.dateBasis==='local_banking_session_day')
    return 'Banxico · 공식 종가 기준'
  if(report.currency==='BRL'&&b.sourceAdapter==='brl-publisher-close/1'&&b.provider==='CNN Brasil (com informações da Reuters)'
    &&b.priceKind==='reported_spot_close'&&b.dateBasis==='publisher_stated_local_session_day')
    return 'CNN Brasil / Reuters · 현물시장 종가 보도값'
  if(b.sourceAdapter==='country-publisher-close/1'&&b.dateBasis==='publisher_stated_local_session_day') {
    if(report.currency==='COP'&&b.provider==='La República'&&b.seriesId==='LaRepublica:reported_spot_close'&&b.priceKind==='reported_spot_close')
      return 'La República · 시장 종가 보도값'
    if(report.currency==='ARS'&&b.provider==='Infobae'&&b.seriesId==='Infobae:reported_wholesale_close'&&b.priceKind==='reported_wholesale_close')
      return 'Infobae · 도매시장 종가 보도값'
  }
  return null
}
export function sourcePublicationTiming(evidence, report) {
  if (!exactTime(evidence?.publishedAt)) return null
  const basis = report?.marketData?.reportPriceBasis
  let referenceAt, referenceKind
  if (basis) {
    const current = basis.observations?.at(-1)
    const clp=report.currency==='CLP'&&basis.provider==='Banco Central de Chile'&&basis.seriesId==='F073.TCO.PRE.Z.D'
      &&basis.dateBasis==='underlying_local_transaction_day'&&basis.priceKind==='official_transaction_weighted_average'&&basis.timeZone==='America/Santiago'
    const mxn=report.currency==='MXN'&&basis.provider==='Banco de México'&&basis.seriesId==='CA18:closing_reference'
      &&basis.dateBasis==='local_banking_session_day'&&basis.priceKind==='official_closing_reference'&&basis.timeZone==='America/Mexico_City'
    if ((!clp&&!mxn) || current?.localSessionDate !== report.observedDate ||
      !exactTime(current?.observationWindow?.endAt)) return null
    referenceAt = current.observationWindow.endAt
    referenceKind = 'aggregation_cutoff'
  } else if (exactTime(report?.observationAt)) {
    referenceAt = report.observationAt
    referenceKind = 'price_observation'
  } else return null
  const after = Date.parse(evidence.publishedAt) > Date.parse(referenceAt)
  return { relation: after ? 'published_after_reference' : 'published_by_reference', referenceKind, referenceAt,
    label: referenceKind === 'aggregation_cutoff' ? after ? '환율 집계 이후 발행' : '환율 집계까지 발행' : after ? '환율 관측 이후 발행' : '환율 관측까지 발행' }
}
