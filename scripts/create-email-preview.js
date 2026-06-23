import fs from 'node:fs'
import path from 'node:path'
import { loadBusinessPlanForEmail } from './business-plan-email.js'
import { composeEmailBody, loadJson, wrapPreviewDocument } from './email-template.js'
import { loadOperationalFxDataset } from './load-fx-dataset.js'

const MARKET_CONTEXT_PATH = path.resolve('email-market-context.json')
const CHART_PATH = path.resolve('email-chart.png')
const PREVIEW_PATH = path.resolve('public/email-preview.html')

const dataset = await loadOperationalFxDataset()
if (!dataset?.baseDate) {
  throw new Error('FX dataset is missing baseDate.')
}

const marketContext = loadJson(MARKET_CONTEXT_PATH, null)
const chartSrc = fs.existsSync(CHART_PATH)
  ? `data:image/png;base64,${fs.readFileSync(CHART_PATH).toString('base64')}`
  : ''
const businessPlan = await loadBusinessPlanForEmail(dataset)
const { subject, html } = composeEmailBody({
  dataset,
  marketContext,
  businessPlan,
  chartSrc,
  includePreviewChrome: true,
})

fs.writeFileSync(PREVIEW_PATH, wrapPreviewDocument(subject, html), 'utf-8')
console.log(`Wrote ${PREVIEW_PATH}`)
