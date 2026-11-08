import {attributionInOriginal} from './news-attribution.js'

// Extraction context and comparison evidence have different jobs. Preserve
// both, but never infer semantic support from their union. A narrow exception
// permits a separately checked continuing quotation to cite its body while the
// candidate supplies the immediately preceding, named introduction.
export function comparisonContext(claim,review,job,dateProof) {
 const direct=[...new Set([...review.blockPositions,...review.conditionBlockPositions])]
 const missing=claim.blockPositions.filter(i=>!direct.includes(i))
 if(missing.length){
  const intro=missing[0],body=intro+1
  const continued=/^(?:agrego|anadio|aseguro|senalo|explico|advirtio|acrescentou|afirmou|disse|explicou)\b/.test(
   job.blocks[body]?.text.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().trim()??'')
  const supported=review.verdict==='supported'&&review.allSubclaimsSupported&&review.attributionMatches&&review.scopeMatches&&review.conditionsPreserved
  // New comparisons explicitly acknowledge all candidate context separately
  // from direct support. Old date proofs were already independently checked
  // before this function; preserve those locators without treating them as
  // additional semantic support. Never merge reference sets to infer a verdict.
  const contextChecked=Array.isArray(review.contextBlockPositions)&&missing.every(i=>review.contextBlockPositions.includes(i))
  const legacy=review.contextBlockPositions===undefined
  const dated=legacy&&claim.kind==='fact'&&dateProof&&dateProof.basis!=='unknown'&&missing.every(i=>dateProof.blockPositions.includes(i))
  const introduction=legacy&&missing.length===1&&claim.kind==='attributed_view'&&direct.includes(body)&&continued&&attributionInOriginal(claim,job,[intro])
  if(!supported||!direct.length||!(contextChecked||dated||introduction))
   throw Error('comparison_dropped_candidate_context')
 }
 const retained=[...new Set([...claim.blockPositions,...direct])].sort((a,b)=>a-b)
 if(retained.length>8)throw Error('comparison_context_reference_limit')
 if(claim.kind!=='fact'&&!attributionInOriginal(claim,job,retained))throw Error('comparison_attribution_reference_mismatch')
 return {direct,retained,retainedIntroduction:missing.filter(i=>claim.kind==='attributed_view'&&attributionInOriginal(claim,job,[i]))}
}
