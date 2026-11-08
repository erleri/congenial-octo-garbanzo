// Offline assembly demonstration. Reuses saved prose; no AI, keys or network.
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { assembleReportContent } from './openrouter.js'
import { ASSEMBLY_VERSION } from './owned-content.js'
import { selectMechanisms } from './rules.js'
import { prepareClaimReview, claimReviewContract } from './claim-review.js'
import { validateContent } from './core.js'
import { saveReport } from './storage.js'

const originalId = 'CLP-2026-10-05-1791378393983'
const originalFile = `.local-reports/reviewable/${originalId}.json`
const snapshotFile = '.local-reports/private/clp-20261005-editorial-trial-v1/snapshot.json'
const accountingFile = '.local-reports/private/clp-20261005-editorial-trial-v1/accounting.json'
const root = '.local-reports/private/assembly-preview-v1'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const expected = ['115ffbaf5f0e0dc0d33ae5ffe900269fefe43caa8e8221cd729bcf285b2a1844',
  'e89d08bc8eedc4c314d9544fb2dd3fbea89b10b586f4acf5451af0f4a591506f',
  '3ff70683cd14cd6b9d5274484c0000c47a8dd326ab45221d6b7a30a13e704c7b']
async function main() {
  if (process.argv.length !== 2) throw new Error('preview_accepts_no_arguments')
  const files = [originalFile, snapshotFile, accountingFile]
  const bytes = await Promise.all(files.map(f => fs.readFile(f)))
  if (bytes.some((b, i) => hash(b) !== expected[i])) throw new Error('saved_original_changed')
  const report = JSON.parse(bytes[0]), packet = JSON.parse(bytes[1]).packet
  if (selectMechanisms(packet).checks.length) throw new Error('saved_application_invalid')
  const draft = { ...report.content, implications: [] }
  const content = assembleReportContent(packet, draft, true)
  const safety = validateContent(content, packet)
  if (!safety.valid) throw new Error('assembly_preview_safety_failed')
  const prepared = prepareClaimReview(packet, content)
  await fs.mkdir(root) // Preserve this one demonstration; never overwrite a prior result.
  const id = `${packet.currency}-${packet.baseDate}-${Date.now()}`
  const view = { ...report, id, assemblyVersion: ASSEMBLY_VERSION, content,
    generationMode: 'editorial_fixture', status: 'rejected', publishedAt: null,
    comparison: { inputHash: hash(bytes[1]), label: 'code-assembly-preview', model: '저장 원고 + 코드 조립',
      costUsd: 0, average: null, preferred: false, provisional: true, publicationBlocked: true,
      referenceOnly: true, historicalReview: true,
      reviewNotes: ['코드 조립 검증 예시입니다. 기존 AI 제목·요약·시장 설명을 재사용했고 달러 환산 문구만 코드가 조립했습니다.',
        '기존 요약의 공식성·시점 문제는 남아 있습니다. 새 AI 결과나 내용 합격으로 표시하지 않습니다.'] } }
  await fs.writeFile(`${root}/review-input.json`, JSON.stringify({ input: prepared, contract: claimReviewContract(prepared) }, null, 2), { flag: 'wx' })
  await saveReport(view)
  const record = { id, originalId, originalHashes: expected, assemblyVersion: ASSEMBLY_VERSION, newApiCalls: 0, newCostUsd: 0,
    codeOwnedClaims: prepared.claims.filter(c => c.owner === 'code').map(c => c.id), safety,
    status: 'assembly_demonstration_not_new_ai_report', publicationApproved: false,
    url: `http://127.0.0.1:4175/local-experience.html?mode=live-local&design=a&run=${id}#report/CLP/2026-10-05` }
  if ((await Promise.all(files.map(f => fs.readFile(f)))).some((b, i) => hash(b) !== expected[i])) throw new Error('saved_original_changed')
  await fs.writeFile(`${root}/result.json`, JSON.stringify(record, null, 2), { flag: 'wx' })
  console.log(JSON.stringify(record, null, 2))
}
main().catch(e => { console.error(/^[a-z_]+$/.test(e.message) ? e.message : 'assembly_preview_failed'); process.exitCode = 1 })
