import { describe, expect, it } from 'vitest'
import { fixtureReports, projectPublicReport } from './storage.js'
import { currentCase } from './test-support.js'

describe('currency report fixtures', () => {
  it('omits explicit missing chart observations without mutating the sealed input or filling zero',()=>{
    const a=currentCase(),report={...a.packet,content:a.content,series:[{date:'2026-11-01',value:10},{date:'2026-11-02',value:null},{date:'2026-11-03',value:12}]}
    const before=JSON.stringify(report)
    expect(projectPublicReport(report).series).toEqual([{date:'2026-11-01',value:10},{date:'2026-11-03',value:12}])
    expect(JSON.stringify(report)).toBe(before)
    expect(projectPublicReport({...report,series:[{date:'2026-11-02',value:null}]}).series).toEqual([])
  })
  it('continues to reject malformed chart values rather than silently omitting them',()=>{
    const a=currentCase()
    for(const point of [{date:'2026-11-01',value:'10'},{date:'2026-11-01'},{date:12,value:null},{date:'2026-11-01',value:Infinity}])
      expect(()=>projectPublicReport({...a.packet,content:a.content,series:[point]})).toThrow('invalid_public_field_type')
  })
  it('allowlists future root, claim, evidence and numeric fields and excludes comparison from public results',()=>{
    const a=currentCase(),original={...a.packet,content:structuredClone(a.content),comparison:{costUsd:1,reviewNotes:['PRIVATE_FUTURE']},futureAdminData:'PRIVATE_FUTURE'}
    original.content.drivers[0]={...original.content.drivers[0],futureSecret:'PRIVATE_FUTURE'} as typeof original.content.drivers[0]
    original.evidence=original.evidence.map(e=>({...e,futureField:'PRIVATE_FUTURE'}))
    expect(JSON.stringify(projectPublicReport(original))).not.toContain('PRIVATE_FUTURE')
    expect(original.comparison.reviewNotes).toEqual(['PRIVATE_FUTURE'])
  })
  it('excludes source passages and internal reviews at the shared public storage boundary', () => {
    const a = currentCase()
    const report = { ...a.packet, content: a.content, id: 'BRL-2025-06-20-123',
      sourceContext: { private: 'root context' }, claimReview: { private: 'internal review' }, ruleLedger: a.ledger,
      explanationCards: [{ private: 'internal card' }], mechanismApplications: [{ private: 'application reviewer' }],
      evidenceScopeCards: [{ private: 'internal scope review' }], scopeCards: [{ private: 'trial scope' }], claimLedger: {private:'claim mapping'},
      fxWritingBackground:{private:'background receipt'},fxWritingFocus:{private:'focus receipt'},
      evidence: a.packet.evidence.map(e => ({ ...e, sourceContext: { passages: ['private original excerpt'] },newsNotes:{review:{private:'note receipt'}},review:{private:'source admission'} })) }
    const projected = projectPublicReport(report)
    expect(projected.content).toEqual(a.content)
    expect(projected.evidence[0].url).toBe(a.packet.evidence[0].url)
    expect(projected.evidence[0].sourceContext).toBeUndefined()
    expect(projected.evidence[0].newsNotes).toBeUndefined()
    expect(projected.evidence[0].review).toBeUndefined()
    expect(projected.fxWritingBackground).toBeUndefined()
    expect(projected.fxWritingFocus).toBeUndefined()
    expect(Object.keys(projected).filter(k => ['sourceContext', 'claimReview', 'ruleLedger', 'explanationCards', 'mechanismApplications', 'evidenceScopeCards', 'scopeCards', 'claimLedger'].includes(k))).toEqual([])
    expect(report.evidence[0].sourceContext.passages).toEqual(['private original excerpt'])
  })
  it('projects reviewed INEGI attribution and transformation notices without exposing its receipt or inventing a day event',()=>{
    const report={evidence:[{id:'monthly-stat',country:'MXN',publisher:'INEGI',url:'https://www.inegi.org.mx/programas/emec/2018/',eventDate:null,period:'2026-08',
      provenance:{reportRole:'consumer_background',definitionVersion:'inegi-report-definitions/1',licenseUrl:'https://www.inegi.org.mx/inegi/terminos.html',
        sourceAttribution:'Fuente: INEGI, EMEC.',transformationDisclosure:'LATAM FX의 가공이며 INEGI의 공식 해석이 아니다.',cardBinding:'private-receipt'}}]}
    const sent=projectPublicReport(report)
    expect(sent.evidence[0]).toMatchObject({provenance:'official',eventDate:null,period:'2026-08'})
    expect(sent.evidence[0].summary).toContain('Fuente: INEGI')
    expect(sent.evidence[0].summary).toContain('LATAM FX')
    expect(JSON.stringify(sent)).not.toContain('private-receipt')
  })
  it('builds the CLP editorial review from observed history without publishing it', async () => {
    const reports = await fixtureReports()
    const clp = reports.find((report) => report.currency === 'CLP')

    expect(reports.map((report) => report.currency)).toEqual(['BRL', 'MXN', 'CLP'])
    expect(clp).toMatchObject({
      id: 'CLP-2026-09-11-sample',
      observedDate: '2026-09-11',
      generationMode: 'editorial_fixture',
      status: 'sample',
      publishedAt: null,
    })
    expect(clp?.facts.find((fact) => fact.id === 'day')?.value).toBeGreaterThan(1.4)
    expect(clp?.evidence).toHaveLength(4)
    expect(clp?.series.length).toBeGreaterThan(200)
  })
  it('projects a reviewed INE PDF to the public source contract without leaking its private receipt hashes', () => {
    const original = {evidence:[{id:'cl-retail',country:'CLP',source:'INE Chile',url:'https://www.ine.gob.cl/docs/default-source/actividad-mensual-del-comercio/boletines/test.pdf',
      provenance:{manuallyReviewed:true,pdfHash:'a'.repeat(64),documentId:`pdf-${'a'.repeat(64)}`,receiptHash:'private-receipt-hash'},sourceContext:{private:'original'}}]}
    const projected=projectPublicReport(original)
    expect(projected.evidence[0]).toMatchObject({publisher:'INE Chile',provenance:'official'})
    expect(JSON.stringify(projected)).not.toContain('private-receipt-hash')
    expect(original.evidence[0].provenance.receiptHash).toBe('private-receipt-hash')
    const foreign={evidence:[{...original.evidence[0],url:'https://ine.gob.cl.example.org/test.pdf'}]}
    expect(projectPublicReport(foreign).evidence[0].provenance).toBeUndefined()
    expect(JSON.stringify(projectPublicReport(foreign))).not.toContain('private-receipt-hash')
  })
})
