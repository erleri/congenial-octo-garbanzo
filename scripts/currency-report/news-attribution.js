// Legacy named-person records remain readable. New institutional/publication
// views never fabricate a person's name to satisfy an old shape restriction.
export const NEWS_INTERPRETATION_VERSION='news-interpretation/2'
export function validNewsAttribution(a) {
 if(!a||typeof a!=='object')return false
 const type=a.type??'person',keys=a.type?['type','person','organization']:['person','organization']
 const name=v=>typeof v==='string'&&v===v.trim()&&v.length>=2&&v.length<=80
 return Object.keys(a).length===keys.length&&keys.every(k=>Object.hasOwn(a,k))&&name(a.organization)
  &&(['institution','publication'].includes(type)?a.person==='':type==='person'&&name(a.person))
}
export function extractedAttribution(c,job) {
 if(c.kind==='fact')return null
 return {type:c.kind==='publication_view'?'publication':c.kind==='institutional_view'?'institution':'person',
  person:c.person,organization:c.kind==='publication_view'?new URL(job.url).hostname:c.organization}
}
export function attributionInOriginal(c,job,positions) {
 const a=extractedAttribution(c,job)
 if(!a)return true
 if(!validNewsAttribution(a)||c.kind==='publication_view'&&c.organization!==a.organization)return false
 const norm=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
 const context=norm(positions.map(i=>job.blocks[i].text).join(' '))
 return a.type==='publication'||context.includes(norm(a.organization))&&(a.type!=='person'||context.includes(norm(a.person)))
}
