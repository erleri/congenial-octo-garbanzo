// Shared adapter-owned text and methodology identity. No I/O or approval state.
export const PRICE_LIMITATIONS_VERSION = 'code-price-limitations/1'
export const BCCH_METHOD = Object.freeze({
  version: 'bcch-observed-dollar-reviewed/1',
  url: 'https://si3.bcentral.cl/estadisticas/Principal1/Metodologias/EC/PARIDADES/Dolar_observado.pdf',
  sha256: '357d9d3a82cf5849d1d15a7cfd34d8850e88410f4c908dae3131af3a141b9780',
  provider: 'Banco Central de Chile', seriesId: 'F073.TCO.PRE.Z.D',
  termsUrl: 'https://www.bcentral.cl/web/banco-central/condiciones-de-uso',
  publicReuseStatus: 'permission_or_applicable_terms_required',
})

export const BCCH_PRICE_LIMITATIONS = Object.freeze([
  '칠레 중앙은행의 거래량 가중평균입니다. 현지 마감 매수·매도호가가 아닙니다.',
  '고시일과 실제 거래 대상일을 분리했습니다. 16:00은 집계 마감이며 단일 관측시각이 아닙니다.',
  '이전 영업일을 확인하지 못한 행은 제외했습니다. 5관측일은 확인 가능한 관측 수이며 5연속 거래일을 보장하지 않습니다.',
  '현재 받은 원문 스냅샷으로 조사하며 과거 시점의 실제 자료 가용성을 재현하지 않습니다.',
])

// Only an exact registered limitation in the matching price packet can contain
// its code-owned digits. Matching packet.limitations alone is not sufficient.
export function isCodeOwnedPriceLimitation(text, packet) {
  const basis = packet.marketData?.reportPriceBasis
  return packet.currency === 'CLP' && BCCH_PRICE_LIMITATIONS.includes(text)
    && packet.limitations?.includes(text) === true
    && basis?.provider === BCCH_METHOD.provider && basis.seriesId === BCCH_METHOD.seriesId
    && basis.priceKind === 'official_transaction_weighted_average'
    && basis.dateBasis === 'underlying_local_transaction_day' && basis.timeZone === 'America/Santiago'
    && basis.methodology?.version === BCCH_METHOD.version && basis.methodology.sha256 === BCCH_METHOD.sha256
}
