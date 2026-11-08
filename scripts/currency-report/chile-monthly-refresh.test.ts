import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { classifyMonthlyVersion, inspectMonthlyPdf, compareMonthlyText } from './chile-monthly-refresh.js'
import { discoverLatestMonthlyPdfs, collectChileMonthlyOriginals, CHILE_MONTHLY_SOURCES } from './chile-monthly-originals.js'
import { createIneWindowsTransport } from './ine-windows-transport.js'

const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
const raw = Buffer.from('%PDF-1.4\nsynthetic extraction fixture\n%%EOF')
const original = {status:'collected_pending_review',url:'https://www.ine.gob.cl/docs/default-source/sueldos-y-salarios/boletines/2026/agosto-2026.pdf',
  sha256:hash(raw),bytes:raw.length,period:'2026-08',sourceVersion:'current_file_not_archived',collectedAt:'2026-10-16T12:00:00Z'}
const extraction = (text = 'Synthetic statistical PDF text for extraction state checks only. Not real evidence.') => ({
  version:'monthly-pdf-text/1',sha256:hash(raw),bytes:raw.length,extractor:'pypdf/6.10.0',pages:[{page:1,text,textHash:hash(text)}]})
const anchor = (sourceId: string, period: string, monthName: string) => {
  const source = CHILE_MONTHLY_SOURCES.find(s => s.id === sourceId)!
  return `<a href="https://www.ine.gob.cl/docs/default-source${source.path}${period.slice(0,4)}/${monthName}-${period.slice(0,4)}.pdf">${monthName} ${period.slice(0,4)}</a>`
}

describe('Official monthly refresh and revision state', () => {
  it('selects the newest listed month independently per source and excludes future links', async () => {
    const fetchImpl = vi.fn(async (url: string) => url.includes('.pdf') ? new Response(raw,{headers:{'content-type':'application/pdf'}})
      : new Response(url.includes('comercio') ? anchor('cl-retail','2026-08','agosto')+anchor('cl-retail','2026-09','septiembre')+anchor('cl-retail','2026-11','noviembre')
        : anchor('cl-pay','2026-08','agosto')))
    const capture = await collectChileMonthlyOriginals({period:'latest',asOf:'2026-10-16',fetchImpl})
    expect(capture.results.map(r => r.period)).toEqual(['2026-09','2026-08'])
    expect(capture.results.every(r => r.absenceProven === false)).toBe(true)
    expect(capture.networkCalls).toBe(4)
    expect(capture.results.flatMap(r => r.originals).map(o => o.period)).toEqual(['2026-09','2026-08'])
  })

  it('rejects invalid cutoffs before transport and does not call an empty index an unpublished release', async () => {
    const fetchImpl = vi.fn()
    await expect(collectChileMonthlyOriginals({period:'latest',asOf:'2026-02-30',fetchImpl})).rejects.toThrow('explicit_asof_required')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(discoverLatestMonthlyPdfs('', 'cl-retail','2026-10-16')).toMatchObject({status:'not_found_in_index',period:null,absenceProven:false})
  })

  it('distinguishes identical bytes, changed files, new periods and unavailable current sources', () => {
    expect(classifyMonthlyVersion(original,[original])).toMatchObject({status:'unchanged_bytes',reviewReusable:false})
    expect(classifyMonthlyVersion({...original,url:original.url+'?sfvrsn=new'},[original])).toMatchObject({status:'unchanged_bytes',urlChanged:true})
    expect(classifyMonthlyVersion({...original,sha256:'b'.repeat(64)},[original]).status).toBe('changed_bytes_review_required')
    expect(classifyMonthlyVersion({...original,period:'2026-09'},[original]).status).toBe('new_period_review_required')
    expect(classifyMonthlyVersion({...original,status:'failed'},[original])).toMatchObject({status:'current_unavailable',priorRetained:true})
  })

  it('keeps same text separate from binary identity and refuses cross-extractor comparisons', () => {
    const a = {status:'extracted_pending_review',extractor:'pypdf/6.10.0',textHash:'a'}
    expect(compareMonthlyText(a,a).status).toBe('same_extracted_text')
    expect(compareMonthlyText(a,{...a,textHash:'b'}).status).toBe('changed_text_review_required')
    expect(compareMonthlyText(a,{...a,extractor:'pypdf/other'}).status).toBe('extractor_version_mismatch')
    expect(compareMonthlyText(a,{status:'extraction_failed'}).status).toBe('text_comparison_unverified')
  })

  it('binds a usable extraction to the original and keeps it pending review', async () => {
    const result = await inspectMonthlyPdf({original,raw,extract:async () => extraction()})
    expect(result.status).toBe('extracted_pending_review')
    expect(result.textHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.originalBinding).toMatch(/^[a-f0-9]{64}$/)
    const extract = vi.fn()
    expect(await inspectMonthlyPdf({original,raw:Buffer.from('different'),extract})).toMatchObject({status:'extraction_failed',reason:'stored_bytes_mismatch'})
    expect(extract).not.toHaveBeenCalled()
  })

  it('keeps blank text, parser failure and timeouts out of successful extraction', async () => {
    const blank = await inspectMonthlyPdf({original,raw,extract:async () => extraction('')})
    expect(blank).toMatchObject({status:'extraction_failed',reason:'no_usable_text'})
    const malformed = await inspectMonthlyPdf({original,raw,extract:async () => {throw new Error('bad xref')}})
    expect(malformed).toMatchObject({status:'extraction_failed',reason:'extractor_or_schema_failure'})
    const timeout = await inspectMonthlyPdf({original,raw,extract:async () => {throw Object.assign(new Error('timeout'),{killed:true})}})
    expect(timeout).toMatchObject({status:'extraction_failed',reason:'extractor_timeout'})
  })

  it('validates the explicit Windows transport URL before starting any external process', async () => {
    const transport = createIneWindowsTransport('pwsh.exe')
    await expect(transport.fetchImpl('https://www.ine.gob.cl/private?token=synthetic')).rejects.toThrow('unregistered_ine_request')
    expect(transport.requests).toEqual([])
    expect(transport.sizeBound).toBe('post_download_not_streaming')
  })
})
