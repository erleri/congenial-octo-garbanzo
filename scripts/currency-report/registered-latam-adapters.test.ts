import {describe,it,expect,vi} from 'vitest'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {extractPublicArticle} from './public-research-adapter.js'
import {parseRegisteredStatistic,IBGE_RETAIL_SIDRA_URL} from './registered-material-adapters.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {planResearchSourceSelection} from './research-source-selection.js'

const rows=[{V:'Valor'},{NC:'1',D1C:'1',D2C:'11708',D2N:'PMC com ajuste sazonal',D4C:'56734',D4N:'Índice de volume de vendas',MC:'2',MN:'%',D3C:'202608',V:'0.1'}]
const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
describe('Registered Latin American body and official fallback adapters',()=>{
 it.each([
  ['https://agenciabrasil.ebc.com.br/economia/noticia/2026-10/synthetic','conteudo-noticia','agencia-brasil-body/1'],
  ['https://www.larepublica.co/finanzas/synthetic','html-content','la-republica-body/1'],
 ])('extracts only the registered %s wrapper and fails closed if it moves', (url,wrapper,adapter)=>{
  const body=`<p>Outside navigation is not evidence.</p><div class="${wrapper}"><p>Market fact within article.</p><div><blockquote>Attributed interpretation.</blockquote></div></div><p>Other article.</p>`
  const result=extractPublicArticle(url,body)
  expect(result.adapter).toBe(adapter)
  expect(result.blocks.map(b=>b.text)).toEqual(['Market fact within article.','Attributed interpretation.'])
  expect(()=>extractPublicArticle(url,body.replace(wrapper,'changed-wrapper'))).toThrow('wrapper_changed')
  expect(()=>extractPublicArticle(url,body.replace(wrapper,`${wrapper}-recommendation`))).toThrow('wrapper_changed')
  expect(()=>extractPublicArticle(url,body+`<div class="${wrapper}"><p>Duplicate hidden body.</p></div>`)).toThrow('wrapper_changed')
 })
 it('preserves SIDRA seasonal adjustment and nulls, excludes future months, and rejects a duplicate period',()=>{
  const body=[...rows,{...rows[1],D3C:'202609',V:'...'},{...rows[1],D3C:'202611',V:'9'}]
  expect(parseRegisteredStatistic({kind:'ibge_sidra_json'},JSON.stringify(body),'2026-10-27')).toMatchObject({
   observations:[{period:'2026-08',value:.1},{period:'2026-09',value:null}],unit:'percent_month_over_month_seasonally_adjusted',publishedAt:null,evidenceReady:false})
  expect(()=>parseRegisteredStatistic({kind:'ibge_sidra_json'},JSON.stringify([...rows,rows[1]]),'2026-10-27')).toThrow('definition_changed')
 })
 it.each([['D2C','other'],['D4C','other'],['D1C','33'],['MN','R$'],['D2N','not seasonally adjusted'],['V','corrupt']])(
  'rejects a changed SIDRA %s definition rather than keeping the old label', (field,value)=>{
   const body=structuredClone(rows);Object.assign(body[1],{[field]:value})
   expect(()=>parseRegisteredStatistic({kind:'ibge_sidra_json'},JSON.stringify(body),'2026-10-27')).toThrow()
 })
 it('reuses the exact saved official alternative, records the primary miss, and keeps publication/use unapproved',async()=>{
  const input=sourceSelectionFixture('BRL',{period:'2026-08'}),selection=planResearchSourceSelection({input,sourcePlan,sourceRegister})
  const text=JSON.stringify(rows),fetchImpl=vi.fn(()=>{throw new Error('forbidden')})
  const result=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds:selection.sourceRequests.filter(r=>r.sourceId==='brl-retail').map(r=>r.requestId),
   captures:[{sourceId:'brl-retail',url:IBGE_RETAIL_SIDRA_URL,text,httpStatus:200,collectedAt:'2026-10-27T01:00:00Z',sha256:createHash('sha256').update(text).digest('hex')}],
   fetchImpl,now:()=> '2026-10-28T00:00:00Z'})
  expect(result.outcomes[0]).toMatchObject({status:'collected_pending_review',adapter:'ibge_sidra_json',attempts:[{status:'not_attempted'},{status:'ok'}]})
  expect(result.reviewQueue[0]).toMatchObject({sourceUseStatus:'not_assessed',writingEligible:false,publicationApproved:false})
  expect(result.originals[0].url).toBe(IBGE_RETAIL_SIDRA_URL);expect(fetchImpl).not.toHaveBeenCalled()
 })
 it('rejects an API body with an appended HTML error rather than salvaging an apparently valid prefix',()=>{
  expect(()=>parseRegisteredStatistic({kind:'bcrp_credit_json'},'{"periods":[]}<html>error</html>','2026-10-27')).toThrow()
 })
})
