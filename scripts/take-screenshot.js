import fs from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer'

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:4173/'
const DATA_PATH = path.resolve('public/data.json')
const SCREENSHOT_PATH = path.resolve('dashboard.png')
const META_PATH = path.resolve('dashboard-meta.json')

async function readDatasetMeta() {
  const raw = await fs.readFile(DATA_PATH, 'utf8')
  const dataset = JSON.parse(raw)

  if (!dataset || typeof dataset.baseDate !== 'string' || !dataset.baseDate) {
    throw new Error('public/data.json does not contain a valid baseDate.')
  }

  const dailyRates = Array.isArray(dataset.dailyRates) ? dataset.dailyRates : []
  const latestRows = dailyRates.filter((row) => row?.date === dataset.baseDate)
  const imputedRows = latestRows.filter((row) => row?.source === 'IMPUTED').length

  return {
    baseDate: dataset.baseDate,
    fetchedAt: typeof dataset.fetchedAt === 'string' ? dataset.fetchedAt : null,
    dailyRateCount: dailyRates.length,
    latestRowCount: latestRows.length,
    imputedLatestRowCount: imputedRows,
  }
}

async function writeMeta(meta) {
  await fs.writeFile(META_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

async function capture() {
  const datasetMeta = await readDatasetMeta()
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  const pageErrors = []

  try {
    const page = await browser.newPage()
    page.on('console', (message) => {
      const text = message.text()
      if (message.type() === 'error' && !text.startsWith('Failed to load resource:')) {
        pageErrors.push(`console: ${text}`)
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(`pageerror: ${error.message}`)
    })

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 60_000 })

    await page.waitForFunction(
      (expectedBaseDate) => {
        const text = document.body.innerText || ''
        const hasKpis = Boolean(document.querySelector('.kpi-grid'))
        const hasExpectedDate = text.includes(expectedBaseDate)
        const isLoading = text.toLowerCase().includes('loading')
        const hasErrorState = Boolean(document.querySelector('.status-dot.error'))

        return hasKpis && hasExpectedDate && !isLoading && !hasErrorState
      },
      { timeout: 30_000 },
      datasetMeta.baseDate,
    )

    await new Promise((resolve) => setTimeout(resolve, 1_500))

    if (pageErrors.length > 0) {
      throw new Error(`Dashboard emitted browser errors:\n${pageErrors.join('\n')}`)
    }

    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false })

    await writeMeta({
      status: 'ok',
      capturedAt: new Date().toISOString(),
      url: DASHBOARD_URL,
      screenshot: path.basename(SCREENSHOT_PATH),
      ...datasetMeta,
    })
  } finally {
    await browser.close()
  }
}

capture().catch(async (error) => {
  await writeMeta({
    status: 'failed',
    capturedAt: new Date().toISOString(),
    url: DASHBOARD_URL,
    error: error instanceof Error ? error.message : String(error),
  }).catch(() => undefined)

  console.error(error)
  process.exit(1)
})
