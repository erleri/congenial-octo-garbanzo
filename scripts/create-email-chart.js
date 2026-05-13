import fs from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer'

const DATA_PATH = path.resolve('public/data.json')
const CHART_PATH = path.resolve('email-chart.png')
const META_PATH = path.resolve('email-chart-meta.json')
const EMAIL_CONTENT_WIDTH = 600
const CURRENCIES = ['BRL', 'MXN', 'CLP', 'COP', 'ARS', 'PEN']
const COLORS = {
  BRL: '#2f6f5e',
  MXN: '#4f6f38',
  CLP: '#93691d',
  COP: '#70577a',
  ARS: '#8a4f2a',
  PEN: '#24706d',
}

function isNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function formatRate(value) {
  if (!isNumeric(value)) {
    return '-'
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
  }

  if (Math.abs(value) >= 100) {
    return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
  }

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
}

function buildPolyline(points, width, height, padding) {
  const numeric = points.filter((point) => isNumeric(point.value))
  if (numeric.length < 2) {
    return ''
  }

  const min = Math.min(...numeric.map((point) => point.value))
  const max = Math.max(...numeric.map((point) => point.value))
  const span = max - min || Math.max(Math.abs(max) * 0.02, 1)
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom
  const step = innerWidth / Math.max(points.length - 1, 1)

  return points
    .map((point, index) => {
      if (!isNumeric(point.value)) {
        return null
      }

      const x = padding.left + step * index
      const y = padding.top + innerHeight - ((point.value - min) / span) * innerHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')
}

function average(values) {
  if (!values.length) {
    return null
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function buildChartCard(currency, points, mtdAverage) {
  const width = 246
  const height = 150
  const padding = { top: 20, right: 20, bottom: 24, left: 34 }
  const numeric = points.filter((point) => isNumeric(point.value))
  const latest = numeric.at(-1)
  const first = numeric.at(0)
  const changePct = latest && first && first.value !== 0
    ? ((latest.value - first.value) / first.value) * 100
    : null
  const min = numeric.length ? Math.min(...numeric.map((point) => point.value)) : null
  const max = numeric.length ? Math.max(...numeric.map((point) => point.value)) : null
  const line = buildPolyline(points, width, height, padding)
  const color = COLORS[currency] ?? '#1f2a44'

  return `
    <section class="card">
      <div class="card-head">
        <div>
          <h2>${currency}</h2>
          <p>Last 30 valid daily rates</p>
          <p>MTD avg ${formatRate(mtdAverage)}</p>
        </div>
        <div class="latest">
          <strong>${formatRate(latest?.value ?? null)}</strong>
          <span class="${changePct === null ? '' : changePct >= 0 ? 'up' : 'down'}">
            ${changePct === null ? '-' : `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%`}
          </span>
        </div>
      </div>
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${currency} trend">
        <line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" stroke="#d9dee7" />
        <line x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" stroke="#d9dee7" />
        <text x="${padding.left}" y="14" class="axis">${formatRate(max)}</text>
        <text x="${padding.left}" y="${height - 6}" class="axis">${formatRate(min)}</text>
        <polyline points="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div class="range">
        <span>${points[0]?.date ?? '-'}</span>
        <span>${points.at(-1)?.date ?? '-'}</span>
      </div>
    </section>
  `
}

function buildHtml(dataset, chartData) {
  const cards = CURRENCIES
    .map((currency) => buildChartCard(currency, chartData[currency].points, chartData[currency].mtdAverage))
    .join('')

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            width: ${EMAIL_CONTENT_WIDTH}px;
            background: #f5f7fb;
            color: #172033;
            font-family: Arial, Helvetica, sans-serif;
          }
          .wrap {
            width: ${EMAIL_CONTENT_WIDTH}px;
            padding: 20px;
          }
          .top {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 18px;
          }
          h1 {
            margin: 0;
            font-size: 26px;
            letter-spacing: 0;
          }
          .meta {
            margin: 6px 0 0;
            color: #667085;
            font-size: 13px;
          }
          .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }
          .card {
            background: #ffffff;
            border: 1px solid #d9dee7;
            border-radius: 8px;
            padding: 14px;
          }
          .card-head {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
          }
          h2 {
            margin: 0;
            font-size: 19px;
          }
          .card p {
            margin: 3px 0 0;
            color: #667085;
            font-size: 11px;
          }
          .latest {
            text-align: right;
          }
          .latest strong {
            display: block;
            font-size: 16px;
          }
          .latest span {
            display: block;
            margin-top: 2px;
            font-size: 12px;
            color: #667085;
          }
          .latest .up { color: #16803f; }
          .latest .down { color: #b42318; }
          .axis {
            fill: #667085;
            font-size: 10px;
          }
          .range {
            display: flex;
            justify-content: space-between;
            color: #667085;
            font-size: 10px;
            margin-top: -2px;
          }
        </style>
      </head>
      <body>
        <main class="wrap">
          <header class="top">
            <div>
              <h1>LATAM FX Daily Trend</h1>
              <p class="meta">Base date: ${dataset.baseDate} / Generated: ${new Date().toISOString()}</p>
            </div>
          </header>
          <div class="grid">
            ${cards}
          </div>
        </main>
      </body>
    </html>`
}

async function main() {
  const raw = await fs.readFile(DATA_PATH, 'utf8')
  const dataset = JSON.parse(raw)
  const dailyRates = Array.isArray(dataset.dailyRates) ? dataset.dailyRates : []
  const [baseYear, baseMonth] = dataset.baseDate.split('-').map(Number)

  if (!dataset.baseDate || !dailyRates.length) {
    throw new Error('public/data.json is missing baseDate or dailyRates.')
  }

  const chartData = Object.fromEntries(
    CURRENCIES.map((currency) => {
      const monthValues = dailyRates
        .filter((row) =>
          row?.currency === currency &&
          row?.rateType === 'LOCAL_PER_USD' &&
          row?.year === baseYear &&
          row?.month === baseMonth &&
          row?.date <= dataset.baseDate &&
          isNumeric(row?.value)
        )
        .map((row) => row.value)

      const points = dailyRates
        .filter((row) =>
          row?.currency === currency &&
          row?.rateType === 'LOCAL_PER_USD' &&
          row?.date <= dataset.baseDate &&
          isNumeric(row?.value)
        )
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(-30)
        .map((row) => ({ date: row.date, value: row.value }))

      if (points.length < 2) {
        throw new Error(`${currency} does not have enough valid daily rates for the email chart.`)
      }

      return [currency, { points, mtdAverage: average(monthValues) }]
    }),
  )

  const html = buildHtml(dataset, chartData)
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: EMAIL_CONTENT_WIDTH, height: 760, deviceScaleFactor: 2 })
    await page.setContent(html, { waitUntil: 'networkidle0' })
    await page.screenshot({ path: CHART_PATH, fullPage: true })
  } finally {
    await browser.close()
  }

  await fs.writeFile(
    META_PATH,
    `${JSON.stringify({
      status: 'ok',
      generatedAt: new Date().toISOString(),
      baseDate: dataset.baseDate,
      chart: path.basename(CHART_PATH),
      currencies: CURRENCIES,
      pointsPerCurrency: Object.fromEntries(
        CURRENCIES.map((currency) => [currency, chartData[currency].points.length]),
      ),
      mtdAverageByCurrency: Object.fromEntries(
        CURRENCIES.map((currency) => [currency, chartData[currency].mtdAverage]),
      ),
    }, null, 2)}\n`,
    'utf8',
  )
}

main().catch(async (error) => {
  await fs.writeFile(
    META_PATH,
    `${JSON.stringify({
      status: 'failed',
      generatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`,
    'utf8',
  ).catch(() => undefined)

  console.error(error)
  process.exit(1)
})
