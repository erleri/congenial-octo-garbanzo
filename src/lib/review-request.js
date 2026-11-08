// Shared by the administrator UI and server email composer. Links identify a
// review target and its version; they never contain credentials or decisions.
const kinds=new Set(['report','correction','source','policy','incident'])
const idPattern=/^(?:[a-f0-9]{64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|global)$/
export function validReviewTarget(value) {
  return !!value&&kinds.has(value.kind)&&idPattern.test(value.id)&&/^[a-f0-9]{64}$/.test(value.version)
}
export function reviewRequestPath(target) {
  if(!validReviewTarget(target))throw Error('invalid_review_target')
  return `/?${new URLSearchParams({review:`${target.kind}:${target.id}`,reviewVersion:target.version})}#admin`
}
export function parseReviewRequest(search) {
  if(typeof search!=='string'||search.length>500)return null
  const p=new URLSearchParams(search)
  if(p.getAll('review').length!==1||p.getAll('reviewVersion').length!==1)return null
  const match=/^([a-z]+):([^:]+)$/.exec(p.get('review')??'')
  const value=match?{kind:match[1],id:match[2],version:p.get('reviewVersion')}:null
  return validReviewTarget(value)?value:null
}
export function reviewLoginReturn(origin,href) {
  try {
    const url=new URL(href),target=parseReviewRequest(url.search)
    return url.origin===origin&&target?new URL(reviewRequestPath(target),origin).href:origin
  }catch{return origin}
}
