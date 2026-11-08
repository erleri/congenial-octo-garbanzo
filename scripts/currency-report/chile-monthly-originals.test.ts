import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { discoverMonthlyPdfs, readMonthlyPdf, collectChileMonthlyOriginals, CHILE_MONTHLY_SOURCES } from './chile-monthly-originals.js'
import { saveChileMonthlyCapture } from './chile-monthly-store.js'
import { chileConsumptionScopes, planChileConsumptionNeeds } from './chile-consumption-scopes.js'
import { syntheticCase } from './rule-fixtures.js'

const url = (id = 'cl-pay', version = 'a_1') => `https://www.ine.gob.cl/docs/default-source${CHILE_MONTHLY_SOURCES.find(s => s.id === id)!.path}2026/agosto-2026.pdf?sfvrsn=${version}`
const html = (id = 'cl-pay', version = 'a_1') => `<a href="${url(id,version)}">agosto 2026</a>`
const bytes = '%PDF-1.7\nSynthetic test bytes, not economic evidence.\n%%EOF'
const pdf = (body = bytes) => new Response(body, { headers: { 'content-type': 'application/pdf' } })
function input() { return { period: '2026-08', packet: { ...syntheticCase('CLP').packet, purpose: 'economic_update', baseDate: '2026-10-09', evidence: [] },
  purpose: 'economic_update', asOf: '2026-10-09T23:00:00Z' } }

describe('Chile consumption definitions and bounded original collection', () => {
  it('compares same-period growth, not equal index levels or population, without approving facts', () => {
    const x = input(), before = structuredClone(x), p = planChileConsumptionNeeds(x), r = chileConsumptionScopes()
    expect(p.questions.find(q => q.id === 'consumption')?.requirements.map(q => q.scope.baseYear)).toEqual(['2023','2018'])
    expect(r.pay.scope).toMatchObject({ metric: 'real_pay', channel: 'not_applicable', subject: 'cl_ir_real_formal_employers_5plus_hourly' })
    expect(r.pay.qualification).toContain('근로시간')
    expect(p.discoveryRequests.map(q => q.needId)).toEqual(['consumption','category'])
    expect(p).toMatchObject({ coreStatus: 'hold', publicationApproved: false, modelCalls: 0 })
    expect(x).toEqual(before)
  })
  it('does not overwrite selected scopes or assume other months and countries are verified', () => {
    expect(planChileConsumptionNeeds({ ...input(), period: '2026-09' }).discoveryRequests).toEqual([])
    expect(() => planChileConsumptionNeeds({ ...input(), requirements: { consumption: [] } })).toThrow('statistic_scope_already_defined')
    expect(() => planChileConsumptionNeeds({ ...input(), packet: { ...input().packet, currency: 'MXN' } })).toThrow('invalid_chile_statistic_scope')
    expect(() => planChileConsumptionNeeds({ ...input(), topics: ['retail'] })).toThrow('consumption_questions_not_selected')
  })
  it('requires both month label and matching official file; deduplicates identical URLs but retains revisions', () => {
    const page = html()+html()+html('cl-pay','b_2')+html('cl-pay','c_3')+html().replace('>agosto', '>julio')
      + html().replace('www.ine.gob.cl', 'www.ine.gob.cl.evil.test')+html().replace('?sfvrsn=a_1','?token=secret')
    const found = discoverMonthlyPdfs(page,'cl-pay','2026-08')
    expect(found.candidates.map(c => c.url)).toEqual([url(),url('cl-pay','b_2')])
    expect(found.omittedCandidates).toBe(1)
    expect(discoverMonthlyPdfs(html().replace('https:', 'http:'),'cl-pay','2026-08').candidates[0].url).toBe(url())
    expect(discoverMonthlyPdfs(html(),'cl-retail','2026-08').candidates).toEqual([])
    expect(discoverMonthlyPdfs(html(),'cl-pay','2026-09')).toMatchObject({ status: 'not_found_in_index', absenceProven: false })
  })
  it('fails URL validation before transport and uses no redirect or credential headers', async () => {
    const fetchImpl = vi.fn(async () => pdf())
    await expect(readMonthlyPdf('http://127.0.0.1/private.pdf','cl-pay',{fetchImpl})).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
    const result = await readMonthlyPdf(url(),'cl-pay',{fetchImpl})
    expect(result).toMatchObject({ status: 'collected_pending_review', publishedAt: null, periodVerified: false, evidenceReady: false })
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { Accept: 'application/pdf' } })
  })
  it('bounds streamed bytes without Content-Length and rejects HTML masquerading as PDF and truncation', async () => {
    expect(await readMonthlyPdf(url(),'cl-pay',{fetchImpl: async () => pdf('x'.repeat(2_000_001))})).toMatchObject({ reason: 'oversize' })
    expect(await readMonthlyPdf(url(),'cl-pay',{fetchImpl: async () => new Response('<html>Blocked</html>')})).toMatchObject({ reason: 'not_pdf' })
    expect(await readMonthlyPdf(url(),'cl-pay',{fetchImpl: async () => pdf('%PDF-1.7\npartial')})).toMatchObject({ reason: 'invalid_or_truncated_pdf' })
  })
  it('times out one request without retry and preserves other source work after failures', async () => {
    const stalled = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('abort')))))
    expect(await readMonthlyPdf(url(),'cl-pay',{fetchImpl: stalled, timeoutMs: 5})).toMatchObject({ reason: 'timeout' })
    expect(stalled).toHaveBeenCalledTimes(1)
    const fetchImpl = vi.fn(async target => String(target).includes('actividad-mensual') ? new Response('',{status:503})
      : String(target).includes('.pdf') ? pdf() : new Response(html()))
    const c = await collectChileMonthlyOriginals({ period:'2026-08', fetchImpl })
    expect(c.results.map(r => r.status)).toEqual(['index_failed','collected_pending_review'])
    expect(c.networkCalls).toBe(3); expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
  it('caps a round at two indexes and four originals while preserving version alternatives', async () => {
    const fetchImpl = vi.fn(async target => String(target).includes('.pdf') ? pdf() : new Response(
      ['a_1','b_2','c_3'].map(v => html(String(target).includes('comercio')?'cl-retail':'cl-pay',v)).join('')))
    const c = await collectChileMonthlyOriginals({ period:'2026-08', fetchImpl })
    expect(c.networkCalls).toBe(6); expect(fetchImpl).toHaveBeenCalledTimes(6)
    expect(c.results.map(r => r.omittedCandidates)).toEqual([1,1])
    expect(c).toMatchObject({ modelCalls:0, evidenceReady:false, publicationApproved:false })
  })
  it('stores repeated captures separately with byte hashes and does not replace prior revisions', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(),'cl-monthly-test-'))
    try {
      const capture = await collectChileMonthlyOriginals({ period:'2026-08', fetchImpl: async target => String(target).includes('.pdf') ? pdf() : new Response(html(String(target).includes('comercio')?'cl-retail':'cl-pay')) })
      const first = await saveChileMonthlyCapture(capture, workspace), second = await saveChileMonthlyCapture(capture, workspace)
      expect(first.directory).not.toBe(second.directory)
      const m = JSON.parse(await fs.readFile(path.join(workspace,first.directory,'manifest.json'),'utf8'))
      expect(m.results[0].indexRaw).toBeUndefined()
      expect(m.results[0].originals[0].raw).toBeUndefined()
      expect(await fs.readFile(path.join(workspace,first.directory,m.results[0].originals[0].file),'utf8')).toBe(bytes)
      capture.results[0].indexHash = 'changed'
      await expect(saveChileMonthlyCapture(capture,workspace)).rejects.toThrow('index_hash_mismatch')
    } finally { await fs.rm(workspace,{recursive:true,force:true}) }
  })
})
