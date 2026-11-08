import { validDate } from './core.js'

// Stable, reviewed landing pages only. They are verification targets, not extracted evidence.
export const OFFICIAL_REVIEW_SOURCES = {
  BRL: [
    { id: 'bcb-copom-statements', publisher: 'Banco Central do Brasil', kind: 'monetary_policy', url: 'https://www.bcb.gov.br/controleinflacao/comunicadoscopom/cronologicos' },
    { id: 'bcb-rss-directory', publisher: 'Banco Central do Brasil', kind: 'official_updates', url: 'https://www.bcb.gov.br/en/about/rssen' },
  ],
  MXN: [
    { id: 'banxico-policy-statements', publisher: 'Banco de México', kind: 'monetary_policy', url: 'https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/anuncios-politica-monetaria-t.html' },
    { id: 'banxico-indicator-rss', publisher: 'Banco de México', kind: 'official_indicators', url: 'https://www.banxico.org.mx/estadisticas/rss-indicadores-banco-mexico.html' },
  ],
  CLP: [
    { id: 'bcch-monetary-policy-meetings', publisher: 'Banco Central de Chile', kind: 'monetary_policy', url: 'https://www.bcentral.cl/en/areas/monetary-politics/monetary-policy-meeting-rpm' },
    { id: 'bcch-policy-calendar', publisher: 'Banco Central de Chile', kind: 'official_calendar', url: 'https://www.bcentral.cl/en/news-and-publications/press/monetary-and-financial-policy-calendar' },
  ],
}

export function buildOfficialReviewTargets(currency, baseDate) {
  if (!OFFICIAL_REVIEW_SOURCES[currency] || !validDate(baseDate)) throw new Error('invalid_currency_or_date')
  return OFFICIAL_REVIEW_SOURCES[currency].map(source => ({
    ...source,
    currency,
    baseDate,
    reviewStatus: 'manual_verification_required',
    evidenceReady: false,
    causalStatus: 'unassessed',
    limitation: '공식 기관의 검토 시작점입니다. 해당 기준일의 실제 발표 원문과 발표시각을 확인한 뒤 별도 근거 레코드로 작성해야 합니다.',
  }))
}
