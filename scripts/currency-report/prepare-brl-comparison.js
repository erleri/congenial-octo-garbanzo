// Public collection only. No keys or generation requests; originals stay private.
import fs from 'node:fs/promises'
import { readPublicText, extractPublicArticle } from './public-research-adapter.js'
import { fingerprint } from './research-harness.js'

const root = '.local-reports/private/brl-20261007-harness-preparation-v1'
await fs.mkdir(root)
const response = await fetch('https://latamforex.netlify.app/data.json', { signal: AbortSignal.timeout(20000) })
if (!response.ok) throw new Error('public_dataset_unavailable')
const dataset = await response.json()
if (dataset.baseDate !== '2026-10-07') throw new Error('date_changed_recheck_evidence')
await fs.writeFile(`${root}/dataset.json`, JSON.stringify(dataset), { flag: 'wx' })
const urls = [
  'https://www.infomoney.com.br/mercados/dolar-hoje-abertura-fechamento-comercial-turismo-07102026/',
  'https://economia.uol.com.br/noticias/reuters/2026/10/07/dolar-sobe-ante-real-pos-rali-do-1-turno-e-com-exterior-no-foco.htm',
  'https://agenciabrasil.ebc.com.br/economia/noticia/2026-10/dolar-fecha-abaixo-de-r-5-pela-primeira-vez-desde-maio',
]
for (const [i, url] of urls.entries()) {
  const read = await readPublicText(url)
  const result = { url, status: read.status, reason: read.reason ?? null, fetchedAt: read.fetchedAt, originalVerified: false }
  if (read.status === 'ok') {
    await fs.writeFile(`${root}/source-${i}.html`, read.text, { flag: 'wx' })
    result.pageHash = fingerprint(read.text)
    try { Object.assign(result, extractPublicArticle(url, read.text)) } catch (error) { result.extractionError = error.message }
  }
  await fs.writeFile(`${root}/source-${i}.json`, JSON.stringify(result, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ source: i, url, status: result.status, blocks: result.blocks?.length ?? 0, reason: result.reason ?? result.extractionError }))
}
console.log(JSON.stringify({ root, baseDate: dataset.baseDate, datasetHash: fingerprint(dataset), modelCalls: 0 }))
