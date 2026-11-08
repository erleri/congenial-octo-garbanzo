// Lossless dictionary encoding. No source, sentence, restriction or period is
// dropped. Repeated long text is transmitted once and addressed by textRef.
export function encodeReviewInput(input) {
 const counts=new Map()
 const count=v=>{if(typeof v==='string'&&v.length>=40)counts.set(v,(counts.get(v)??0)+1)
  else if(v&&typeof v==='object')Object.values(v).forEach(count)}
 count(input)
 const strings={},ids=new Map()
 for(const [text,n]of counts)if(n>1){const id=`t${ids.size}`;ids.set(text,id);strings[id]=text}
 const encode=v=>typeof v==='string'&&ids.has(v)?{textRef:ids.get(v)}:Array.isArray(v)?v.map(encode):
  v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)])):v
 return {encoding:'review-text-dictionary/1',strings,input:encode(input)}
}
export function decodeReviewInput(encoded) {
 if(encoded.encoding!=='review-text-dictionary/1')throw Error('review_encoding_required')
 const decode=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1&&Object.hasOwn(v,'textRef')?
  encoded.strings[v.textRef]:Array.isArray(v)?v.map(decode):v&&typeof v==='object'?
   Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)])):v
 return decode(encoded.input)
}
