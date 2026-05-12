import fs from 'node:fs'
import path from 'node:path'

export const MAJOR_CURRENCIES = ['BRL', 'MXN', 'CLP', 'COP', 'ARS', 'PEN']

const DASHBOARD_URL = 'https://latamforex.netlify.app/'
const CARD_COLORS = {
  BRL: '#2f6f5e',
  MXN: '#4f6f38',
  CLP: '#93691d',
  COP: '#70577a',
  ARS: '#8a4f2a',
  PEN: '#24706d',
}
const SOURCE_LABELS = {
  API: 'API',
  EXCEL: 'Excel',
  IMPUTED: 'Adjusted',
}

export function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

export function formatRate(value) {
  if (typeof value !== 'number') {
    return '-'
  }

  if (Math.abs(value) >= 100) {
    return value.toLocaleString('en-US', {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    })
  }

  return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
}

function monthlyAverage(dailyRates, baseDate, currency, year, month) {
  const values = dailyRates
    .filter((row) =>
      row.currency === currency &&
      row.rateType === 'LOCAL_PER_USD' &&
      row.year === year &&
      row.month === month &&
      row.date <= baseDate &&
      typeof row.value === 'number',
    )
    .map((row) => row.value)

  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function findMonthlyValue(dataset, currency, year, month) {
  return (dataset.monthlyRates ?? []).find((row) =>
    row.currency === currency &&
    row.rateType === 'LOCAL_PER_USD' &&
    row.year === year &&
    row.month === month &&
    typeof row.value === 'number',
  )?.value ?? null
}

function previousMonth(year, month) {
  return month === 1 ? [year - 1, 12] : [year, month - 1]
}

export function getCurrencyDetails(dataset) {
  const dailyRates = dataset.dailyRates ?? []
  const baseDate = dataset.baseDate
  const [baseYear, baseMonth] = baseDate.split('-').map(Number)
  const oneYearAgo = `${baseYear - 1}-${String(baseMonth).padStart(2, '0')}-${baseDate.split('-')[2]}`
  const latestRows = dailyRates.filter((row) =>
    row.date === baseDate &&
    row.rateType === 'LOCAL_PER_USD' &&
    MAJOR_CURRENCIES.includes(row.currency) &&
    typeof row.value === 'number',
  )
  const latestByCurrency = Object.fromEntries(latestRows.map((row) => [row.currency, row]))
  const [prevYear, prevMonth] = previousMonth(baseYear, baseMonth)

  return MAJOR_CURRENCIES.map((currency) => {
    const latestRow = latestByCurrency[currency]
    const mtdAverage = monthlyAverage(dailyRates, baseDate, currency, baseYear, baseMonth)
    const previousAverage = findMonthlyValue(dataset, currency, prevYear, prevMonth)
    const mom =
      typeof mtdAverage === 'number' &&
      typeof previousAverage === 'number' &&
      previousAverage !== 0
        ? ((mtdAverage - previousAverage) / previousAverage) * 100
        : null
    const yearlyValues = dailyRates
      .filter((row) =>
        row.currency === currency &&
        row.rateType === 'LOCAL_PER_USD' &&
        oneYearAgo <= row.date &&
        row.date <= baseDate &&
        typeof row.value === 'number',
      )
      .map((row) => row.value)
    const low52 = yearlyValues.length ? Math.min(...yearlyValues) : null
    const high52 = yearlyValues.length ? Math.max(...yearlyValues) : null
    const todayValue = latestRow?.value ?? null
    const percent52 =
      typeof todayValue === 'number' &&
      typeof low52 === 'number' &&
      typeof high52 === 'number' &&
      high52 > low52
        ? Math.max(0, Math.min(100, ((todayValue - low52) / (high52 - low52)) * 100))
        : 50

    return {
      currency,
      rate: todayValue,
      mtdAverage,
      mom,
      low52,
      high52,
      percent52,
      source: latestRow?.source ?? 'API',
    }
  })
}

function renderCta(margin = '16px 0') {
  return `
    <p style="margin:${margin};text-align:center;">
      <a href="${DASHBOARD_URL}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:4px;font-weight:bold;font-size:14px;">Open LATAM FX Dashboard</a>
    </p>
  `
}

function renderMarketContext(marketContext) {
  const bullets = Array.isArray(marketContext?.bullets)
    ? marketContext.bullets.slice(0, 3)
    : []
  const effectiveBullets = bullets.length
    ? bullets
    : ['No clear public-news signal was found from the automated source.']

  return `
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 18px;border:1px solid #d7deea;background:#f8fafc;border-radius:6px;">
      <tr>
        <td style="padding:13px 15px;">
          <h3 style="margin:0 0 8px;font-size:15px;color:#111827;">Today's market context</h3>
          <p style="margin:0 0 8px;font-size:12px;color:#667085;">Automated Alpha Vantage news topics for reference only; not a confirmed cause analysis.</p>
          <ul style="margin:0;padding-left:18px;color:#344054;font-size:13px;line-height:1.5;">
            ${effectiveBullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        </td>
      </tr>
    </table>
  `
}

function renderCard(detail) {
  const color = CARD_COLORS[detail.currency] ?? '#1f2a44'
  const sourceLabel = SOURCE_LABELS[detail.source] ?? detail.source
  const momText =
    typeof detail.mom === 'number' ? `${detail.mom >= 0 ? '+' : ''}${detail.mom.toFixed(2)}% MoM` : 'MoM -'
  const momColor = typeof detail.mom === 'number' && detail.mom >= 0 ? '#a61b12' : '#1f5fbf'

  return `
    <td style="width:33.33%;padding:5px;vertical-align:top;">
      <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #cfd5df;border-radius:6px;background:#ffffff;">
        <tr>
          <td style="padding:11px 11px 12px;">
            <table role="presentation" style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="color:#344054;font-size:11px;font-weight:bold;">${detail.currency} / USD</td>
                <td style="text-align:right;"><span style="display:inline-block;border:1px solid #ccd6e6;border-radius:4px;background:#f8fafc;color:#1f5fbf;padding:2px 6px;font-size:10px;font-weight:bold;">${sourceLabel}</span></td>
              </tr>
            </table>
            <div style="margin-top:6px;color:#111827;font-size:25px;line-height:1;font-weight:800;font-variant-numeric:tabular-nums;">${formatRate(detail.mtdAverage)}</div>
            <div style="margin-top:7px;color:${momColor};font-size:12px;font-weight:bold;">${momText}</div>
            <div style="margin-top:13px;color:#5b6472;font-size:12px;font-variant-numeric:tabular-nums;">Base rate ${formatRate(detail.rate)}</div>
            <div style="margin-top:5px;color:#667085;font-size:11px;font-weight:bold;">52-week range</div>
            <table role="presentation" style="width:100%;border-collapse:collapse;margin-top:3px;">
              <tr>
                <td style="color:#5b6472;font-size:11px;font-weight:bold;font-variant-numeric:tabular-nums;">${formatRate(detail.low52)}</td>
                <td style="text-align:right;color:#5b6472;font-size:11px;font-weight:bold;font-variant-numeric:tabular-nums;">${formatRate(detail.high52)}</td>
              </tr>
            </table>
            <div style="height:4px;background:#edf0f4;border-radius:999px;margin-top:4px;position:relative;">
              <div style="height:4px;width:${detail.percent52.toFixed(1)}%;background:${color};opacity:.35;border-radius:999px;"></div>
              <div style="width:2px;height:10px;background:#162033;margin-left:${detail.percent52.toFixed(1)}%;margin-top:-7px;"></div>
            </div>
          </td>
        </tr>
      </table>
    </td>
  `
}

function renderKpiSummary(currencyDetails, baseDate) {
  const cardRows = []
  for (let index = 0; index < currencyDetails.length; index += 3) {
    cardRows.push(`<tr>${currencyDetails.slice(index, index + 3).map(renderCard).join('')}</tr>`)
  }

  return `
    <h3 style="margin:0 0 8px;font-size:16px;">Six-currency KPI summary</h3>
    <p style="margin:0 0 8px;font-size:12px;color:#667085;">Base date: ${baseDate} / Main value: month-to-date average</p>
    <table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:0 0 18px;">${cardRows.join('')}</table>
  `
}

export function composeEmailBody({
  dataset,
  marketContext,
  chartSrc = 'cid:fx-chart-image',
  includePreviewChrome = false,
}) {
  const baseDate = dataset.baseDate
  const fetchedAt = dataset.fetchedAt ?? '-'
  const subject = `[LATAM FX] ${baseDate} Daily FX Brief`
  const body = `
    ${includePreviewChrome ? `<p style="margin:0 0 12px;font-size:12px;color:#667085;">Subject: ${subject}</p>` : ''}
    <h2 style="margin:0 0 8px;">LATAM FX Daily Brief</h2>
    <p style="margin:0 0 14px;font-size:13px;color:#667085;">
      Base date: ${baseDate}<br>
      Fetched at: ${fetchedAt}<br>
      Source: ExchangeRate API, Alpha Vantage, adjusted data
    </p>
    ${renderCta('0 0 16px')}
    ${renderMarketContext(marketContext)}
    ${renderKpiSummary(getCurrencyDetails(dataset), baseDate)}
    <p style="margin:18px 0;"><img src="${chartSrc}" alt="LATAM FX 30-day chart" style="width:100%;max-width:760px;height:auto;border:1px solid #d9dee7;"></p>
    ${renderCta('16px 0')}
  `

  return { subject, html: body }
}

export function wrapPreviewDocument(subject, body) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(subject)}</title>
    <style>
      body { margin: 0; background: #eef2f7; font-family: Arial, Helvetica, sans-serif; color: #111827; }
      .preview-shell { max-width: 820px; margin: 0 auto; padding: 28px 14px; }
      .email-frame { background: #fff; border: 1px solid #d9dee7; padding: 24px; box-shadow: 0 12px 30px rgba(15, 23, 42, .08); }
    </style>
  </head>
  <body>
    <div class="preview-shell">
      <div class="email-frame">
        ${body}
      </div>
    </div>
  </body>
</html>
`
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
