// Presentation only. Selecting newly published reports and recording delivery
// belongs to the later sending integration, not to this renderer.
const COUNTRIES = { BRL: '브라질', MXN: '멕시코', CLP: '칠레', COP: '콜롬비아', ARS: '아르헨티나', PEN: '페루' }
const ORDER = Object.keys(COUNTRIES)
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export function emailPublicationReason(reason) {
  if (reason == null) return ''
  const labels = { periodic: '정기 점검', bootstrap: '첫 정기 점검', event: '주요 이슈', correction: '정정', movement: '환율 변동' }
  if (labels[reason.kind]) return labels[reason.kind]
  // LOCAL_PER_USD rises when the local currency weakens. Never infer the
  // publication trigger from the headline or the daily FX card.
  if (reason.kind === 'cumulative' && Number.isFinite(reason.cumulativePct) && reason.cumulativePct !== 0) {
    const direction = reason.cumulativePct > 0 ? 'local_currency_weaker' : 'local_currency_stronger'
    if (reason.direction === direction) return direction === 'local_currency_weaker' ? '누적 변동 · 통화 약세' : '누적 변동 · 통화 강세'
  }
  throw Error('invalid_email_publication_reason')
}

export function renderEmailReportDigest(reports) {
  if (!Array.isArray(reports) || reports.length > 6) throw Error('invalid_email_report_digest')
  const seen = new Set()
  for (const report of reports) {
    if (!COUNTRIES[report.currency] || seen.has(report.currency)
      || !/^\d{4}-\d{2}-\d{2}$/.test(report.baseDate)
      || !report.title?.trim() || typeof report.summary !== 'string'
      || typeof report.shortSummary !== 'string'
      || !/^(?:https:\/\/latamforex\.netlify\.app\/|reports\/[A-Za-z0-9_-]+\.html$)/.test(report.href)) {
      throw Error('invalid_email_report_digest')
    }
    emailPublicationReason(report.publicationReason)
    seen.add(report.currency)
  }
  if (!reports.length) return ''
  const compact = reports.length > 2
  return `<table role="presentation" data-email-section="reports" style="width:100%;border-collapse:collapse;margin:0 0 24px;border-top:2px solid #223b60;">
    <tr><td style="padding:15px 0 3px;font-family:Arial,'Malgun Gothic',sans-serif;font-size:15px;font-weight:700;color:#182c48;">새 환율 리포트 <span style="font-weight:400;color:#667085;font-size:12px;">· ${reports.length}건</span></td></tr>
    ${[...reports].sort((a,b)=>Number(b.publicationReason?.kind==='correction')-Number(a.publicationReason?.kind==='correction')||ORDER.indexOf(a.currency)-ORDER.indexOf(b.currency)).map(report => `<tr><td style="padding:${compact ? '13px' : '17px'} 0;border-bottom:1px solid #e3e8ef;">
      <p style="margin:0 0 6px;font-size:12px;line-height:1.8;color:#667085;"><strong style="color:#35587c;">${COUNTRIES[report.currency]} ${report.currency}</strong>${report.publicationReason ? ` <span data-publication-reason style="display:inline-block;margin:0 4px;padding:1px 6px;border-radius:3px;background:#eaf0f7;color:#365775;font-size:11px;font-weight:600;">${escape(emailPublicationReason(report.publicationReason))}</span>` : ''}<span style="color:#a2acb8;"> · </span>리포트 기준 ${escape(report.baseDate)}</p>
      <p style="margin:0 0 7px;font-size:17px;font-weight:700;line-height:1.5;letter-spacing:-.3px;color:#152c48;overflow-wrap:anywhere;">${escape(report.title)}</p>
      <p style="margin:0 0 6px;font-size:14px;line-height:1.75;color:#425166;overflow-wrap:anywhere;">${escape(compact ? report.shortSummary : report.summary)}</p>
      <a href="${escape(report.href)}" style="display:inline-block;padding:7px 0;font-size:13px;font-weight:700;line-height:1.5;color:#24598c;text-decoration:underline;">${COUNTRIES[report.currency]} 리포트 읽기 →</a>
    </td></tr>`).join('')}
  </table>`
}
