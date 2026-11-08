// Offline only: no credentials, network or automatic publishing.
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { prepareClaimReview, assessClaimReview, correctionPlan, applyCorrections, claimReviewContract, correctionContract } from './claim-review.js'

const { values } = parseArgs({ options: { action: { type: 'string', default: 'prepare' },
  input: { type: 'string' }, review: { type: 'string' }, patches: { type: 'string' },
  refinements: { type: 'boolean', default: false } } })
const root = path.resolve('.local-reports/private')
async function readPrivate(name) {
  if (!/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.json$/.test(name ?? '')) throw new Error('invalid_private_input_name')
  const file = await fs.realpath(path.join(root, name))
  const relative = path.relative(await fs.realpath(root), file)
  if (relative.startsWith('..') || path.isAbsolute(relative) || (await fs.stat(file)).size > 250000) throw new Error('invalid_private_input_file')
  return JSON.parse(await fs.readFile(file, 'utf8'))
}
async function main() {
  if (!['prepare', 'review', 'apply'].includes(values.action)) throw new Error('invalid_edit_action')
  const { packet, content, revisionDepth = 0 } = await readPrivate(values.input)
  const prepared = prepareClaimReview(packet, content)
  let result = { ...prepared, modelContract: claimReviewContract(prepared) }
  if (values.action !== 'prepare') {
    const review = await readPrivate(values.review)
    const assessment = assessClaimReview(prepared, review)
    result = { assessment }
    if (!assessment.errors.length) result.plan = correctionPlan(prepared, review, { includeRefinements: values.refinements })
    if (result.plan?.items.length) result.modelContract = correctionContract(result.plan)
    if (values.action === 'apply') {
      if (!result.plan) throw new Error('incomplete_claim_review')
      result.revision = applyCorrections({ packet, content, plan: result.plan, patches: await readPrivate(values.patches), revisionDepth })
      result.recheckInput = prepareClaimReview(packet, result.revision.content)
    }
  }
  const destination = path.join(root, 'editorial-workflow', `${Date.now()}-${values.action}`)
  await fs.mkdir(destination, { recursive: true })
  await fs.writeFile(path.join(destination, 'result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ action: values.action, status: result.revision?.status ?? result.assessment?.status ?? 'unverified',
    claims: prepared.claims.length, corrections: result.plan?.items.length ?? 0, output: path.join(destination, 'result.json'),
    networkCalls: 0, newCostUsd: 0, publicationApproved: false }, null, 2))
}
main().catch(error => { console.error(/^[a-z_]+$/.test(error.message) ? error.message : 'local_edit_failed'); process.exitCode = 1 })
