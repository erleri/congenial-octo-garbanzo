import fs from 'node:fs'
import path from 'node:path'
import { composeEmailBody, loadJson } from './email-template.js'

const DATA_PATH = path.resolve('public/data.json')
const MARKET_CONTEXT_PATH = path.resolve('email-market-context.json')

const dataset = loadJson(DATA_PATH)
if (!dataset?.baseDate) {
  throw new Error('public/data.json is missing baseDate.')
}

const marketContext = loadJson(MARKET_CONTEXT_PATH, null)
const { subject, html } = composeEmailBody({ dataset, marketContext })
const outputPath = process.env.GITHUB_OUTPUT

if (outputPath) {
  fs.appendFileSync(outputPath, `subject=${subject}\n`, 'utf-8')
  fs.appendFileSync(outputPath, 'html_body<<HTML\n', 'utf-8')
  fs.appendFileSync(outputPath, `${html}\n`, 'utf-8')
  fs.appendFileSync(outputPath, 'HTML\n', 'utf-8')
} else {
  console.log(JSON.stringify({ subject, html }, null, 2))
}
