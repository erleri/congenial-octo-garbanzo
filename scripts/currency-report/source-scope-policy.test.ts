import {it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {inspectSourceAdmission,resolveSourceAdmission} from './source-admission.js'
import {sourceTermsContent,refreshSourceTerms} from './source-scope-policy.js'

const asOf='2026-11-08T04:00:00Z',host='economics.example.org',termsUrl=`https://${host}/terms/`
const scopes={discover:true,collect:true,analyze:true,publishNotes:true}
const policy={id:'f6c7c73e-835e-4016-ab08-fb83f5ba06d9',currency:'PEN',host,pathPrefix:'/economia/',publisher:'Economics Example',termsUrl,
 action:'apply',revision:2,scopes,approvedTermsHash:'a'.repeat(64),decidedAt:asOf,expiresAt:'2027-02-06T04:00:00Z'}
const term={policyId:policy.id,url:termsUrl,status:'available',checkedAt:asOf,hash:policy.approvedTermsHash}
function proof(path='/economia/dolar-nuevo',extra:Record<string,unknown>={}){
 const url=`https://${host}${path}`
 const article={'@type':'NewsArticle',url,datePublished:'2026-11-07T20:00:00Z',publisher:{name:policy.publisher,url:`https://${host}/`},
  isAccessibleForFree:true,articleBody:'El tipo de cambio respondió a la demanda local de dólares y a las condiciones de liquidez durante la sesión, según la interpretación atribuida a los participantes del mercado en esta publicación.',...extra}
 return inspectSourceAdmission({currency:'PEN',url,html:`<script type="application/ld+json">${JSON.stringify(article)}</script>`,robotsText:'User-agent: *\nAllow: /',collectedAt:asOf,asOf})
}
const resolve=(p=proof(),policies=[policy],terms=[term],time=asOf)=>resolveSourceAdmission({proof:p,policies,terms,asOf:time})

it('reuses a reviewed scope for distinct subsequent articles in each currency without creating per-article approvals',()=>{
 for(const currency of ['BRL','MXN','COP','PEN','CLP','ARS'])for(const path of ['/economia/dolar-uno','/economia/dolar-dos']){
  const p=proof(path)
  // Re-inspect with this currency rather than forging the bound proof.
  const article={'@type':'NewsArticle',url:p.url,datePublished:p.publicationAt,publisher:{name:policy.publisher,url:`https://${host}/`},isAccessibleForFree:true,
   articleBody:'El mercado evaluó la información cambiaria y las condiciones monetarias. El informe distingue los hechos observados de las interpretaciones atribuidas a analistas, sin convertir expectativas en resultados confirmados.'}
  const bound=inspectSourceAdmission({currency,url:p.url,html:`<script type="application/ld+json">${JSON.stringify(article)}</script>`,robotsText:'User-agent: *\nAllow: /',collectedAt:asOf,asOf})
  expect(resolveSourceAdmission({proof:bound,policies:[{...policy,currency}],terms:[term],asOf})).toMatchObject({state:'active',reason:'reviewed_publisher_scope',policyRevision:2,publicationApproved:false})
 }
})

it('holds changed or unavailable terms, expired review and out-of-scope content without treating a valid source as a publication approval',()=>{
 expect(resolve(proof('/economia-extra/dolar')).state).toBe('hold')
 expect(resolve(proof('/economia/dolar',{provider:{name:'Another agency'}})).reason).toBe('article_outside_reviewed_scope')
 expect(resolve(proof('/economia/dolar',{isAccessibleForFree:false})).state).toBe('exclude')
 expect(resolve(proof(),[policy],[{...term,hash:'b'.repeat(64)}]).reason).toBe('source_terms_changed')
 expect(resolve(proof(),[policy],[{...term,status:'unavailable'}]).reason).toBe('source_terms_check_pending')
 expect(resolve(proof(),[policy],[term],'2026-11-09T04:00:00Z').reason).toBe('source_terms_check_pending')
 expect(resolve(proof(),[{...policy,expiresAt:asOf}]).reason).toBe('source_scope_review_expired')
 const narrower={...policy,pathPrefix:'/economia/sub/',action:'exclude'}
 expect(resolve(proof('/economia/sub/dolar'),[policy,narrower]).state).toBe('exclude')
 const p=proof()
 expect(resolveSourceAdmission({proof:p,policies:[policy],terms:[term],asOf,
  decision:{action:'exclude',revision:1,proofBinding:p.binding,scopes}}).reason).toBe('operator_excluded')
})

it('refreshes terms through bounded free acquisition, ignores page chrome and exposes changed terms without auto-approving them',async()=>{
 const text='Estos términos describen los usos permitidos de los artículos propios de esta publicación. El análisis privado y las referencias independientes requieren conservar la atribución y respetar las restricciones específicas de cada contenido.'
 const old=sourceTermsContent(`<nav>Yesterday</nav><main>${text}</main>`)
 expect(sourceTermsContent(`<nav>Today</nav><main>${text}</main>`).hash).toBe(old.hash)
 expect(sourceTermsContent(`<main>${text}</main><footer>New restrictions on automated analysis.</footer>`).hash).not.toBe(old.hash)
 const captures=[{url:termsUrl,text:`<main>${text}</main>`,httpStatus:200,collectedAt:asOf},
  {url:`https://${host}/robots.txt`,text:'User-agent: *\nAllow: /',httpStatus:200,collectedAt:asOf}].map(c=>({...c,sha256:createHash('sha256').update(c.text).digest('hex')}))
 const stored:unknown[]=[]
 const result=await refreshSourceTerms({state:{proofs:[],decisions:[],policies:[policy],terms:[]},store:{saveSourceTerms:async t=>{stored.push(t);return true}},asOf,
  capturesByCurrency:{PEN:captures},read:async()=>{throw Error('unexpected network')}})
 expect(result.results).toMatchObject([{currency:'PEN',status:'available',networkCalls:0}])
 expect(stored).toHaveLength(1)
 expect(result.state.policies[0].approvedTermsHash).toBe(policy.approvedTermsHash)
 expect(resolve(proof(),result.state.policies,result.state.terms).reason).toBe('source_terms_changed')
 expect(JSON.stringify(stored)).not.toContain('<main>')
})

it('limits repeated checks and isolates transport or persistence failures to the affected scope',async()=>{
 let calls=0
 const state={proofs:[],decisions:[],policies:Array.from({length:9},(_,i)=>({...policy,id:`scope-${i}`,pathPrefix:`/section-${i}/`})),terms:[]}
 const result=await refreshSourceTerms({state,store:{saveSourceTerms:async()=>true},asOf,mode:'live',read:async()=>{calls++;throw Error('timeout')}})
 expect(calls).toBe(8);expect(result.results).toHaveLength(8)
 await refreshSourceTerms({state:result.state,store:{saveSourceTerms:async()=>true},asOf,mode:'live',read:async()=>{calls++;throw Error('timeout')}})
 expect(calls).toBe(9) // The remaining scope, not a retry of the first eight.
 const failed=await refreshSourceTerms({state:{...state,policies:[policy]},store:{saveSourceTerms:async()=>{throw Error('db unavailable')}},asOf,mode:'live',
  read:async url=>({status:200,text:url.endsWith('robots.txt')?'User-agent: *\nAllow: /':'Verified terms with enough detail for a content fingerprint. '.repeat(4)})})
 expect(failed.state.terms[0].status).toBe('unavailable')
})

it('rejects forged saved terms and same-time competing revisions before reusable admission',async()=>{
 const text='Verified terms about allowed processing and independent summaries. '.repeat(4),hash=createHash('sha256').update(text).digest('hex')
 const captures=[{url:`https://${host}/robots.txt`,text:'User-agent: *\nAllow: /',httpStatus:200,collectedAt:asOf,sha256:createHash('sha256').update('User-agent: *\nAllow: /').digest('hex')},
  {url:termsUrl,text,httpStatus:200,collectedAt:asOf,sha256:hash},{url:termsUrl,text:text+' revised',httpStatus:200,collectedAt:asOf,sha256:'b'.repeat(64)}]
 const r=await refreshSourceTerms({state:{policies:[policy],terms:[]},store:{saveSourceTerms:async()=>true},asOf,capturesByCurrency:{PEN:captures}})
 expect(r.state.terms[0]).toMatchObject({status:'unavailable',hash:null})
})
