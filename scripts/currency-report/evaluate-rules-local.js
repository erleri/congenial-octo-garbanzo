// Offline only: no dotenv, network, model calls, promotion, DB or historical writes.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fixedRuleCases } from './rule-fixtures.js'
import { RULE_VERSION, evaluateRules, ruleHash } from './rules.js'
import { validateContent } from './core.js'

const synthetic = fixedRuleCases.map(c => {
  const result = evaluateRules(c.make())
  return { id: c.id, topic: c.topic, provenance: c.provenance, historicalVerification: false,
    expected: c.expected, actual: result.status, matched: result.status === c.expected, result }
})
const actual = []
for (const id of ['CLP-2026-09-11-1791194500290', 'CLP-2026-09-11-1791197300204', 'CLP-2026-09-11-1791198000000', 'CLP-2026-09-11-1791213481771']) {
  const file = path.join('.local-reports/reviewable', `${id}.json`)
  try {
    const before = await fs.readFile(file, 'utf8'), report = JSON.parse(before)
    const result = evaluateRules({ packet: report, content: report.content, ledger: report.ruleLedger,
      safety: validateContent(report.content, report) })
    const row = { id, provenance: report.generationMode === 'ai_enhanced' ? 'saved_ai_output' : 'authored_reference_not_ai',
      originalRuleVersion: report.ruleLedger?.ruleVersion ?? (id === 'CLP-2026-09-11-1791213481771' ? 'currency-rules/1; rejected ledger is private and unchanged' : 'currency-editorial/2 or earlier; unchanged'), originalHash: ruleHash(report),
      storedCostUsd: report.comparison?.costUsd ?? null, originalScore: report.comparison?.average ?? null,
      historicalVerification: 'Existing source scope only; no new historical investigation', result,
      legacyFindings: [] }
    if (id === 'CLP-2026-09-11-1791197300204') {
      const prior = JSON.parse(await fs.readFile('.local-reports/private/clp-20260911-editorial-v2/review.json', 'utf8'))
      if (prior.contentHash !== ruleHash(report.content)) throw new Error('historical_review_binding_mismatch')
      row.legacyFindings = Object.entries({ newInformation: 'R01', explainedTransmission: 'R02', distinctInsights: 'R05', evidenceFidelity: 'R06' })
        .filter(([key]) => prior.checks[key].passed === false)
        .map(([key, ruleId]) => ({ ruleId, status: 'hold', reason: prior.checks[key].reason,
          origin: 'preserved_agent_assessment_not_human_approval', sourceHash: ruleHash(prior) }))
    }
    if (before !== await fs.readFile(file, 'utf8')) throw new Error('historical_report_changed')
    actual.push(row)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    actual.push({ id, provenance: 'missing_local_record', status: 'unverified', reason: 'not_counted_as_evaluated' })
  }
}
const result = { ruleVersion: RULE_VERSION, evaluatedAt: new Date().toISOString(), networkCalls: 0, newCostUsd: 0,
  synthetic, actual, semanticsApproved: false,
  summary: { syntheticCases: synthetic.length, matched: synthetic.filter(c => c.matched).length,
    savedRecords: actual.filter(r => r.result).length, missingRecords: actual.filter(r => !r.result).length,
    note: 'Synthetic reviewer doubles verify decision logic, not model quality or real human approval.' } }
const dir = path.join('.local-reports/private/common-rules', `${Date.now()}`)
await fs.mkdir(dir, { recursive: true })
await fs.writeFile(path.join(dir, 'evaluation.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ ...result.summary, output: path.join(dir, 'evaluation.json'), actual: actual.map(r => ({ id: r.id, status: r.result?.status ?? r.status,
  ruleIds: [...new Set([...(r.result?.checks ?? []), ...(r.legacyFindings ?? [])].filter(c => c.status !== 'pass').map(c => c.ruleId))] })), networkCalls: 0, newCostUsd: 0 }, null, 2))
if (synthetic.some(c => !c.matched)) process.exitCode = 1
