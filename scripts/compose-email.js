import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadBusinessPlanForEmail } from './business-plan-email.js'
import { composeEmailBody, loadJson } from './email-template.js'
import { loadOperationalFxDataset } from './load-fx-dataset.js'
import { captureDashboardEmailFrame } from './email/delivery-core.js'

const MARKET_CONTEXT_PATH = path.resolve('email-market-context.json')
const FX_REPORT_PATH = path.resolve('fx-report-published.json')

const dataset = await loadOperationalFxDataset()
if (!dataset?.baseDate) {
  throw new Error('FX dataset is missing baseDate.')
}

const marketContext = loadJson(MARKET_CONTEXT_PATH, null)
const fxReport = loadJson(FX_REPORT_PATH, null)
const businessPlan = await loadBusinessPlanForEmail(dataset)
const reportMode = process.env.FX_EMAIL_REPORT_MODE || 'legacy'
if (!['legacy', 'shadow', 'approved'].includes(reportMode)) throw new Error('invalid_email_report_mode')
const mailHold = process.env.FX_EMAIL_HOLD === 'true'
const frame = reportMode !== 'legacy' ? captureDashboardEmailFrame({ dataset, businessPlan,
  workflowRunId: process.env.GITHUB_ACTIONS === 'true' ? process.env.GITHUB_RUN_ID : null }) : null
if (frame) fs.writeFileSync(path.resolve('email-compose-context.json'), JSON.stringify(frame), { mode: 0o600 })
if (frame) fs.writeFileSync(path.resolve('email-dataset-snapshot.json'), JSON.stringify(dataset), { mode: 0o600 })
const useApprovedOutput = !mailHold && reportMode === 'approved' && process.env.FX_EMAIL_SEND_APPROVED === 'true'
const deliveryMode = mailHold || reportMode === 'approved' && !useApprovedOutput ? 'hold' : useApprovedOutput ? 'approved' : 'legacy'
const { subject, html } = useApprovedOutput ? frame : composeEmailBody({ dataset, marketContext, businessPlan, fxReport })
const outputPath = process.env.GITHUB_OUTPUT

if (outputPath) {
  const delimiter = `LATAM_EMAIL_${randomUUID().replaceAll('-', '')}`
  fs.appendFileSync(outputPath, `report_mode=${reportMode}\n`, 'utf-8')
  fs.appendFileSync(outputPath, `delivery_mode=${deliveryMode}\n`, 'utf-8')
  fs.appendFileSync(outputPath, `mail_hold=${mailHold}\n`, 'utf-8')
  fs.appendFileSync(outputPath, `subject=${subject}\n`, 'utf-8')
  fs.appendFileSync(outputPath, `html_body<<${delimiter}\n`, 'utf-8')
  fs.appendFileSync(outputPath, `${html}\n`, 'utf-8')
  fs.appendFileSync(outputPath, `${delimiter}\n`, 'utf-8')
} else {
  console.log(JSON.stringify({ subject, html }, null, 2))
}
