import fs from 'node:fs'
import path from 'node:path'
import { composeEmailBody, loadJson, wrapPreviewDocument } from './email-template.js'

const DATA_PATH = path.resolve('public/data.json')
const MARKET_CONTEXT_PATH = path.resolve('email-market-context.json')
const CHART_PATH = path.resolve('email-chart.png')
const PREVIEW_PATH = path.resolve('public/email-preview.html')

const dataset = loadJson(DATA_PATH)
if (!dataset?.baseDate) {
  throw new Error('public/data.json is missing baseDate.')
}

const marketContext = loadJson(MARKET_CONTEXT_PATH, null)
const chartSrc = fs.existsSync(CHART_PATH)
  ? `data:image/png;base64,${fs.readFileSync(CHART_PATH).toString('base64')}`
  : ''
const { subject, html } = composeEmailBody({
  dataset,
  marketContext,
  chartSrc,
  includePreviewChrome: true,
})

fs.writeFileSync(PREVIEW_PATH, wrapPreviewDocument(subject, html), 'utf-8')
console.log(`Wrote ${PREVIEW_PATH}`)
