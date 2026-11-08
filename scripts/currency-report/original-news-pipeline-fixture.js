// Synthetic contract data only. This is not a historical article or licence.
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {sourceSelectionFixture} from './research-source-selection-fixtures.js'
import {planResearchSourceSelection} from './research-source-selection.js'
import {collectSelectedResearch} from './selected-source-collection.js'
import {sourceUseBinding} from './source-use.js'

export async function originalPipelineFixture(articleId='123456',thirdParty=false,periodMode=false,extraContextParagraphs=0){
 const sourcePlan=JSON.parse(fs.readFileSync('docs/2.0/six-currency-explanation-sources-20261027.json','utf8'))
 const sourceRegister=JSON.parse(fs.readFileSync('docs/2.0/six-currency-source-register-20261027.json','utf8'))
 const input=sourceSelectionFixture('COP',{metric:'market_quote',period:'2026-10-26',purpose:'fx_explanation'})
 const sourceId='cop-larepublica',url=`https://www.larepublica.co/finanzas/dolar-colombia-synthetic-${articleId}`
 const html='<meta property="article:published_time" content="2026-10-26T20:00:00Z"><div class="html-content">'
   +(periodMode?'<p>Entre el 20 y el 26 de octubre de 2026, el dólar subió en Colombia.</p>':'<p>El dólar subió en el mercado de Colombia durante la sesión del 26 de octubre de 2026.</p>')
   +'<p>María Pérez, de Banco Ejemplo, atribuyó el movimiento a demanda local de dólares.</p>'
   +'<p>También advirtió que la baja liquidez podía amplificar el movimiento; no midió aportes de cada factor.</p>'
   +(thirdParty?`<p>Con información de ${thirdParty===true?'Reuters':thirdParty}.</p>`:'')
   +Array.from({length:extraContextParagraphs},(_,i)=>`<p>Contexto sintético adicional ${i}: otros asuntos económicos no prueban esta causa.</p>`).join('')+'</div>'
 const capture={sourceId,url,text:html,httpStatus:200,collectedAt:'2026-10-28T01:00:00Z',sha256:createHash('sha256').update(html).digest('hex')}
 const selected=planResearchSourceSelection({input,sourcePlan,sourceRegister})
 const collection=await collectSelectedResearch({input,sourcePlan,sourceRegister,requestIds:selected.sourceRequests.filter(r=>r.sourceId===sourceId).map(r=>r.requestId),
   articleUrls:[{sourceId,url}],captures:[capture],mode:'saved',now:()=> '2026-10-28T02:00:00Z'})
 const card=collection.reviewQueue[0],original=collection.originals[0]
 const sourceUse={evaluatedOn:'2026-10-28',reviews:[{version:'source-use/1',resourceId:original.id,resourceBinding:sourceUseBinding(original),
   terms:{url:'https://example.org/synthetic-terms',version:'synthetic-test-permission-not-real',reviewedOn:'2026-10-28'},
   scope:'Synthetic original text for offline protocol and mocked transport tests only.',
   review:{origin:'agent',status:'checked',reason:'Synthetic grant is a test double, not permission for a real publisher.'},conditions:[],
   uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(use=>[use,{status:use==='public_display'?'pending':'allowed',
     reason:'Synthetic source-use decision for this fixed contract fixture only.',conditionIds:[]}]))}]}
 const candidate={decision:'propose_notes',role:'market_explanation',eventDate:'2026-10-26',priceKind:'not_stated',marketPeriod:null,
   eventDateEvidence:{basis:'explicit',quote:'El dólar subió en el mercado de Colombia durante la sesión del 26 de octubre de 2026.',blockPositions:[0],relation:'none'},
   reason:'Synthetic extraction reason; this must not enter the comparison prompt.',claims:[
     {id:'n0',kind:'fact',text:'합성 원문은 콜롬비아 현지 시장에서 달러 가격이 상승했다고 보도한다.',person:'',organization:'',causalScope:'none',blockPositions:[0]},
     {id:'n1',kind:'attributed_view',text:'Banco Ejemplo의 María Pérez는 달러 수요를 움직임의 배경으로 해석하면서 낮은 유동성이 변동을 키울 수 있다는 조건을 함께 설명했다.',
       person:'María Pérez',organization:'Banco Ejemplo',causalScope:'local',blockPositions:[1,2]}]}
 const comparison={decision:'supported',role:'market_explanation',eventDate:'2026-10-26',priceKind:'not_stated',marketPeriod:null,
   reason:'Synthetic original comparison supports the notes and retained conditions, not actual market truth.',independentWording:true,articleSubstitute:false,
   claims:candidate.claims.map(c=>({id:c.id,verdict:'supported',allSubclaimsSupported:true,attributionMatches:true,scopeMatches:true,conditionsPreserved:true,
     blockPositions:c.id==='n0'?[0]:[1],conditionBlockPositions:c.id==='n0'?[]:[2],contextBlockPositions:[...c.blockPositions],reason:'Synthetic support spans and qualifying context were checked against the fixed original.'})),
   limitations:[{blocking:false,kind:'price_basis',reason:'합성 원문에는 가격의 정확한 관측시각과 종가 여부가 명시되지 않았다.'}]}
 if(periodMode){
  const period={kind:'week',start:'2026-10-20',end:'2026-10-26',quote:'Entre el 20 y el 26 de octubre de 2026',blockPositions:[0]}
  Object.assign(candidate,{eventDate:'',marketPeriod:period,eventDateEvidence:{basis:'unknown',quote:'',blockPositions:[],relation:'none'}})
  Object.assign(comparison,{eventDate:'',marketPeriod:structuredClone(period)})
 }
 return {collection,card,sourceUse,candidate,comparison,checkedOn:'2026-10-28',sourcePlan,sourceRegister,input,capture,url}
}
