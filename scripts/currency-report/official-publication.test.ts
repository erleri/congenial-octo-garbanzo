import {it,expect} from 'vitest'
import {officialCountryProfiles,countryDefinitionId,OFFICIAL_COUNTRY_VERSION} from './official-country-statistics.js'
import {prepareOfficialPublication,officialStatisticForModel} from './official-publication.js'
import {projectPublicReport} from './storage.js'
import {sourceAttribution} from '../../src/lib/reports/claimPresentation'

// Synthetic projection of registered definitions, not a source/use grant or
// model-quality sample. Production admission still requires actual originals.
function fixture(currency='CLP'){
 const p=officialCountryProfiles().find(p=>p.currency===currency)
 const s={seriesId:p.seriesId,definitionVersion:OFFICIAL_COUNTRY_VERSION,definitionId:countryDefinitionId(p),scope:p.scope,label:p.label,period:'2026-09',
  sourceUrl:currency==='CLP'?'https://www.ine.gob.cl/docs/default-source/actividad-mensual-del-comercio/boletines/2026/synthetic.pdf':'https://www.dane.gov.co/files/operaciones/EMC/bol-EMC-sep2026.pdf',
  release:{publishedOn:'2026-10-30'},usePolicy:{termsUrl:p.termsUrl,credit:p.credit,local_analysis:'allowed',external_model:'allowed',public_display:'pending'},provisional:true,derived:false}
 const credit={sourceUrl:s.sourceUrl,referencePeriod:s.period,attribution:p.credit,transformation:'수치 정리·계산·해석: LATAM FX. 원 기관의 보증이 아닙니다.'}
 return {statistic:s,credit,currency}
}
it('delivers exact source credit, period, adjustment, transformation and applicable licence in a code-owned public summary',()=>{
 const cl=prepareOfficialPublication(fixture())
 expect(cl.summary).toContain('대상 2026-09');expect(cl.summary).toContain('비계절조정');expect(cl.summary).toContain('CC BY-SA 4.0')
 expect(cl.summary).toContain('https://creativecommons.org/licenses/by-sa/4.0/');expect(cl.publicationApproved).toBe(false)
 const projected=officialStatisticForModel({...fixture().statistic,publication:cl})
 expect(projected).not.toHaveProperty('publication');expect(projected.scope).toEqual(fixture().statistic.scope)
 const cop=prepareOfficialPublication(fixture('COP'))
 expect(cop.summary).toContain('Fuente: Departamento Administrativo Nacional de Estadística: www.dane.gov.co')
 expect(cop.licence).toBeNull()
})
it('does not resolve missing or denied source conditions by producing a notice',()=>{
 const denied=fixture();denied.statistic.usePolicy.public_display='denied'
 expect(prepareOfficialPublication(denied)).toBeNull()
 const wrong=fixture();wrong.credit.referencePeriod='2026-08'
 expect(prepareOfficialPublication(wrong)).toBeNull()
 const changed=fixture();changed.statistic.scope={...changed.statistic.scope,priceBasis:'nominal'}
 expect(prepareOfficialPublication(changed)).toBeNull()
})
it('preserves publication notices through the public allowlist, strips private proof and rejects missing/changed delivery',()=>{
 const f=fixture(),p=prepareOfficialPublication(f),report={currency:'CLP',evidence:[{id:'stat-synthetic',country:'CLP',publisher:'INE Chile',title:'합성 통계 표시 검사',url:f.statistic.sourceUrl,
  publishedAt:null,eventDate:null,period:'2026-09',collectedAt:'2026-11-01T10:00:00Z',summary:p.summary,provenance:'official',
  officialStatistic:{publication:p},rawBase64:'PRIVATE-PDF-DO-NOT-DISPLAY'}]}
 const visible=projectPublicReport(report)
 expect(visible.evidence[0].summary).toBe(p.summary);expect(visible.evidence[0].publishedAt).toBeNull()
 expect(JSON.stringify(visible)).not.toMatch(/PRIVATE-PDF|officialStatistic|summaryHash/)
 const altered=structuredClone(report);altered.evidence[0].summary='출처 고지를 제거한 예'
 expect(()=>projectPublicReport(altered)).toThrow('official_public_notice_missing_or_changed')
 expect(report.evidence[0].summary).toBe(p.summary)
})
it('shows the applicable CC link for a registered source without assigning a blanket licence to other outlets',()=>{
 const report={testOnly:false,evidence:[{url:'https://infra.datos.gob.ar/catalog/sspm/dataset/455/synthetic.csv'},{url:'https://www.dane.gov.co/synthetic'},{url:'https://www.ine.gob.cl.evil.invalid/synthetic'}]}
 const shown=sourceAttribution(report as never)
 expect(shown.map(r=>r.host)).toEqual(['infra.datos.gob.ar','www.dane.gov.co'])
 expect(shown[0].license).toBe('https://creativecommons.org/licenses/by/4.0/');expect(shown[1].license).toBeNull()
})
