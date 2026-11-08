import type { CurrencyReport, ReportClaim } from '../../types/currencyReport'
import { reportFactText } from './fact-display'

// Display compatibility is shared by all currencies. It never changes saved text.
export function claimPresentation(claim:ReportClaim,report:CurrencyReport) {
  const display=reportFactText(claim.text,report)
  const placeholders=new Set([...claim.text.matchAll(/\{\{([a-z_]+)\}\}/g)].map(m=>m[1]))
  const bases=[...display.bases,...claim.factIds.filter(id=>!placeholders.has(id)&&!['spot','day','five','mtd'].includes(id))
    .flatMap(id=>{const f=report.facts.find(x=>x.id===id);return f?[f.label]:[]})]
  const compatibilityEvidence=report.assemblyVersion==='currency-assembly/1'&&report.content.implications.includes(claim)
    ?report.evidence.filter(e=>e.id==='principle-usd-payment-conversion').map(e=>e.id):[]
  return {text:display.text,bases:[...new Set(bases)],evidenceIds:claim.evidenceIds.length?claim.evidenceIds:compatibilityEvidence}
}
export function sourceAttribution(report:CurrencyReport) {
  const registered=[
    {host:'www.ine.gob.cl',text:'INE Chile 자료를 번역·요약하고 독립 해석을 추가했습니다. INE가 승인한 해석이 아닙니다.',label:'CC BY-SA 4.0',license:'https://creativecommons.org/licenses/by-sa/4.0/',terms:'https://www.ine.gob.cl/terminos-de-uso-y-licencia-de-datos-abiertos'},
    {host:'infra.datos.gob.ar',text:'원 통계는 INDEC, 배포는 Datos Argentina입니다. 수치 정리·계산·해석: LATAM FX.',label:'CC BY 4.0',license:'https://creativecommons.org/licenses/by/4.0/',terms:'https://www.datos.gob.ar/sv/dataset/sspm-ventas-supermercados'},
    {host:'apisidra.ibge.gov.br',text:'숫자·지표 정의의 출처는 IBGE/SIDRA입니다. LATAM FX의 정리·해석은 IBGE의 보증을 뜻하지 않습니다.',label:null,license:null,terms:'https://www.ibge.gov.br/np_download/novoportal/documentos_institucionais/Plano_de_Dados_Abertos_IBGE_2024_2025.pdf'},
    {host:'www.dane.gov.co',text:'Fuente: Departamento Administrativo Nacional de Estadística: www.dane.gov.co. 정리·해석: LATAM FX.',label:null,license:null,terms:'https://www.dane.gov.co/index.php/terminos-y-condiciones'},
    {host:'estadisticas.bcrp.gob.pe',text:'출처: BCRP. 통계의 상품·통화·대상 기간은 개별 근거에 표시합니다. 정리·해석: LATAM FX.',label:null,license:null,terms:'https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/condiciones-de-uso'},
    {host:'www.inegi.org.mx',text:'Fuente: INEGI. 수치 정리·계산·해석은 LATAM FX가 수행했으며 INEGI의 공식 해석이나 보증이 아닙니다.',label:null,license:null,terms:'https://www.inegi.org.mx/inegi/terminos.html'},
  ]
  return report.testOnly?[]:registered.filter(r=>report.evidence.some(e=>{try{return new URL(e.url).hostname===r.host}catch{return false}}))
}
