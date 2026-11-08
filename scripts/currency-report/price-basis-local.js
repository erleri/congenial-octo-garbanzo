// Offline saved-capture verification only. No env loading, fetch, AI or DB.
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createHash } from 'node:crypto'
import { readCurrencyApiPrice, readReviewedEmolQuote, buildPriceBasisReview, buildPriceLinkedEvidenceReview } from './price-basis.js'

const sha = raw => createHash('sha256').update(raw).digest('hex')
const privateRoot = await fs.realpath('.local-reports/private')
async function readPrivate(file, maximum = 5_000_000) {
  const resolved = await fs.realpath(file)
  const relative = path.relative(privateRoot, resolved)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('private_capture_required')
  const stat = await fs.stat(resolved)
  if (!stat.isFile() || stat.size > maximum) throw new Error('capture_too_large')
  return fs.readFile(resolved)
}
try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, output: { type: 'string' } }, strict: true })
  if (!values.input || !values.output) throw new Error('input_and_output_required')
  const manifestStat = await fs.stat(values.input)
  if (!manifestStat.isFile() || manifestStat.size > 100_000) throw new Error('invalid_manifest')
  const input = JSON.parse(await fs.readFile(values.input, 'utf8'))
  const datasetRaw = await readPrivate(input.datasetFile)
  if (sha(datasetRaw) !== input.datasetSha256) throw new Error('snapshot_hash_mismatch')
  const dataset = JSON.parse(datasetRaw)
  const providerPrices = []
  for (const capture of input.providerCaptures) {
    const raw = await readPrivate(capture.rawFile)
    if (sha(raw) !== capture.sha256) throw new Error('provider_capture_changed')
    providerPrices.push(readCurrencyApiPrice({ ...capture, raw, currency: input.currency }))
  }
  const originals = JSON.parse(await readPrivate(input.articleOriginalsFile))
  const articleQuotes = []
  for (const descriptor of input.articleReviews) {
    const original = originals.find(item => item.id === descriptor.id)
    articleQuotes.push(readReviewedEmolQuote({ original, rawHtml: await readPrivate(descriptor.rawFile),
      review: descriptor.review, quoteSide: descriptor.quoteSide }))
  }
  const priceBasis = buildPriceBasisReview({ dataset, currency: input.currency, providerPrices, articleQuotes })
  const discovery = { currency: input.currency, baseDate: providerPrices[1].providerDate,
    candidates: articleQuotes.map(q => ({ id: q.id, url: q.url, title: '원문 검토한 현지 마감 호가', publisher: q.publisher,
      publishedAt: q.publishedAt, sourceCountry: q.currency, reviewTier: 'trusted_reporting_review',
      publicationTimeBasis: 'original_review', candidateFocus: 'currency_move' })), officialReviewTargets: [] }
  const result = buildPriceLinkedEvidenceReview(discovery, dataset, priceBasis)
  const outputDir = await fs.realpath(path.dirname(values.output))
  const relative = path.relative(privateRoot, outputDir)
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.extname(values.output) !== '.json') throw new Error('private_output_required')
  const out = path.join(outputDir, path.basename(values.output))
  await fs.writeFile(out, JSON.stringify({ ...result, snapshotSha256: input.datasetSha256,
    reviewMethod: 'Codex original review + offline structural verification', networkCalls: 0, modelCalls: 0, apiCostUsd: 0 }, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: out, ruleVersion: priceBasis.ruleVersion,
    storedMatches: priceBasis.storedMatches, providerIntervalPct: priceBasis.providerIntervalPct,
    articleReference: priceBasis.articleReference, sameLabelDirectionConflict: priceBasis.sameLabelDirectionConflict,
    writingEligibility: result.writingEligibility, publicationBlocked: result.publicationBlocked,
    networkCalls: 0, modelCalls: 0, apiCostUsd: 0 }, null, 2))
} catch (error) {
  console.error(`price_basis_review_failed:${error.message}`)
  process.exitCode = 1
}
