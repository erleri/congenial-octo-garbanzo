// Offline evidence adjudication replay. No env, fetch, API, public report writes
// or automatic language classification. Preserves every historical record.
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { prepareClaimReview, assessClaimReview, correctionPlan, CLAIM_REVIEW_VERSION } from './claim-review.js'
import { assembleReportContent } from './openrouter.js'
import { selectMechanisms } from './rules.js'
import { SAVED_JUDGMENTS, LEGACY_IMPLICATIONS, CONTRASTS } from './saved-review-cases.js'
import { generationBody } from './run-clp-editorial-trial.js'
import { requestTokenBound, PRICE_CEILING } from './prepare-clp-editorial.js'

const files = [
  '.local-reports/reviewable/CLP-2026-10-05-1791378393983.json',
  '.local-reports/private/clp-20261005-editorial-trial-v1/snapshot.json',
  '.local-reports/private/clp-20261005-editorial-trial-v1/accounting.json',
]
const expected = ['115ffbaf5f0e0dc0d33ae5ffe900269fefe43caa8e8221cd729bcf285b2a1844',
  'e89d08bc8eedc4c314d9544fb2dd3fbea89b10b586f4acf5451af0f4a591506f',
  '3ff70683cd14cd6b9d5274484c0000c47a8dd326ab45221d6b7a30a13e704c7b']
const hash = v => createHash('sha256').update(v).digest('hex')
const supportFor = issue => issue === 'verification_gap' ? 'unverified' : ['none', 'style'].includes(issue) ? 'supported' : 'unsupported'

function bindRefs(input, refs) {
  const applicationIds = [], anchors = []
  for (const ref of refs) {
    if (ref === '@usd') {
      const a = input.applicableMechanisms.find(m => m.mechanismId === 'usd-payment-conversion')
      assert.ok(a, 'reviewed USD application missing'); applicationIds.push(a.applicationId)
    } else {
      const [evidenceId, passageId] = ref.split('/')
      const source = input.sources.find(s => s.id === evidenceId), context = source?.sourceContext
      const passage = context?.passages.find(p => p.id === passageId)
      assert.ok(passage, `missing saved passage ${ref}`)
      // Private output only. Full paragraph was read by the adjudicator; bounded
      // anchor identifies it, it does not by itself establish semantic support.
      anchors.push({ evidenceId, passageId, passageHash: context.passageHash, quote: passage.text.slice(0, 460) })
    }
  }
  return { anchors, applicationIds }
}

function review(input, specs) {
  assert.equal(specs.length, input.claims.length, 'all manuscript sentences require adjudication')
  return { version: CLAIM_REVIEW_VERSION, binding: input.binding, origin: 'agent', reviewer: 'Codex offline source adjudication 2026-10-07',
    claims: input.claims.map(c => {
      const spec = specs.find(s => s.id === c.id); assert.ok(spec, `missing judgment ${c.id}`)
      const subclaims = spec.parts.map(p => ({ quote: p.quote ?? c.quote, support: p.support, reason: p.reason, ...bindRefs(input, p.refs) }))
      const allRefs = [...new Set(spec.parts.flatMap(p => p.refs))]
      return { id: c.id, claimHash: c.claimHash, support: supportFor(spec.issue),
        decision: spec.issue === 'style' ? 'refine' : ['none', 'verification_gap'].includes(spec.issue) ? 'keep' : 'rewrite',
        issue: spec.issue, reason: spec.reason, ...bindRefs(input, allRefs), subclaims }
    }) }
}

function evaluate(packet, content, specs) {
  const input = prepareClaimReview(packet, content), judgment = review(input, specs), assessment = assessClaimReview(input, judgment)
  assert.deepEqual(assessment.errors, [])
  return { input, judgment, assessment }
}

async function main() {
  if (process.argv.length !== 2) throw new Error('offline_evaluation_accepts_no_arguments')
  const bytes = await Promise.all(files.map(f => fs.readFile(f)))
  assert.deepEqual(bytes.map(hash), expected, 'original files changed')
  const report = JSON.parse(bytes[0]), packet = JSON.parse(bytes[1]).packet
  assert.deepEqual(selectMechanisms(packet).checks, [])
  const assembled = assembleReportContent(packet, { ...report.content, implications: [] }, true)
  const legacy = evaluate(packet, report.content, SAVED_JUDGMENTS.map(s => LEGACY_IMPLICATIONS.find(o => o.id === s.id) ?? s))
  const current = evaluate(packet, assembled, SAVED_JUDGMENTS)
  assert.deepEqual(legacy.assessment.requiredCorrections, ['summary:0', 'drivers.0.text:1', 'drivers.1.text:0', 'implications.0.text:0'])
  assert.deepEqual(current.assessment.requiredCorrections, ['summary:0', 'drivers.0.text:1', 'drivers.1.text:0'])
  assert.deepEqual(correctionPlan(current.input, current.judgment).items.map(i => i.id), current.assessment.requiredCorrections)
  const contrasts = CONTRASTS.map(c => {
    const content = { ...assembled, title: c.text }
    const result = evaluate(packet, content, SAVED_JUDGMENTS.map(s => s.id === 'title:0' ? {
      id: s.id, issue: c.issue, reason: c.reason,
      parts: [{ quote: c.text, support: supportFor(c.issue), refs: c.refs, reason: c.reason }],
    } : s))
    const finding = result.assessment.rows.find(r => r.id === 'title:0')
    assert.equal(result.assessment.requiredCorrections.includes('title:0'), supportFor(c.issue) === 'unsupported')
    assert.equal(result.assessment.verificationPending.includes('title:0'), c.issue === 'verification_gap')
    return { caseId: c.id, origin: 'synthetic_contrast_using_frozen_sources', finding }
  })
  // Negative control: a dishonest semantic judgment can still carry a real
  // passage and pass the reference contract. Record this gap; never count it
  // as automatic fact-checking success or publication approval.
  const dishonest = structuredClone(current.judgment)
  const d = dishonest.claims.find(r => r.id === 'drivers.1.text:0')
  d.support = 'supported'; d.issue = 'none'; d.decision = 'keep'
  d.subclaims[1].support = 'supported'
  const blindSpot = assessClaimReview(current.input, dishonest)
  assert.deepEqual(blindSpot.errors, [])
  assert.equal(blindSpot.requiredCorrections.includes(d.id), false)
  assert.equal(blindSpot.publicationApproved, false)

  const body = generationBody(packet), inputUpperBound = requestTokenBound(body)
  assert.ok(inputUpperBound <= 44000)
  const maximumUsd = Math.ceil((inputUpperBound * PRICE_CEILING.prompt + body.max_tokens * PRICE_CEILING.completion) / 1e6 * 1e9) / 1e9
  const nextTrial = { status: 'prepared_not_executed', model: body.model, reasoning: body.reasoning,
    sourcePacketUnchanged: true, packetHash: hash(JSON.stringify(packet)), requestHash: hash(JSON.stringify(body)),
    inputUpperBound, maxOutputTokens: body.max_tokens, priceCeilingPerMillion: PRICE_CEILING, maximumUsd,
    newGenerationCalls: 1, modelReviewCalls: 0, retries: 0,
    reviewMethod: 'offline sentence-by-sentence source review after generation',
    endpointPreflightRequired: true, newBudgetApprovalRequired: true, previousAuthorizationConsumed: true }
  assert.deepEqual((await Promise.all(files.map(f => fs.readFile(f)))).map(hash), expected)
  const root = await fs.mkdtemp('.local-reports/private/saved-claims-evaluation-')
  const result = { evaluatedAt: new Date().toISOString(), origin: 'agent_adjudicated_offline', originalHashes: expected,
    manuscriptUniqueSentences: 20, contrastCases: contrasts.length,
    original: { required: legacy.assessment.requiredCorrections, optional: legacy.assessment.optionalRefinements },
    assembly: { required: current.assessment.requiredCorrections, optional: current.assessment.optionalRefinements },
    knownSemanticBlindSpot: { case: 'unsupported commodity breadth labeled supported with real citation',
      rejectedByReferenceValidator: false, independentContentReviewRequired: true },
    newApiCalls: 0, newCostUsd: 0, actualModelQualityTested: false, publicationApproved: false, nextTrial }
  for (const [name, value] of Object.entries({ legacy, assembly: current, contrasts, result, 'generation-request': body }))
    await fs.writeFile(`${root}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ root, ...result }, null, 2))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
