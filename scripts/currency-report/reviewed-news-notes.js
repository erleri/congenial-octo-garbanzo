import {validMarketPeriod,periodLabel} from './news-period.js'
// Reviewer-authored facts and attributed ideas, not article extracts or licences.
// No I/O, fetching, model calls or automatic source-use approval.
import {validNewsAttribution} from './news-attribution.js'
import {createHash} from 'node:crypto'

export const NEWS_NOTES_VERSION='reviewed-news-notes/2'
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))
const text=(v,max=300)=>typeof v==='string'&&v.trim().length>=2&&v===v.trim()&&v.length<=max
const day=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
const stamp=v=>day(v)||typeof v==='string'&&day(v.slice(0,10))&&/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const safe=v=>!/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시|[?&](?:token|apikey|api_key)=/i.test(JSON.stringify(v))
const sourceKeys=['id','country','publisher','author','url','publishedAt','publicationDisplay','eventDate','collectedAt']
const noteKeys=['id','kind','text','attribution','reportedPrice']
const reviewKeys=['origin','status','reason','supportingContentChecked','contentAccess','independentlyWorded','notTranslation','notArticleSubstitute','checkedOn']
function validate(source,notes,review) {
  let url
  try {url=new URL(source?.url)} catch {throw new Error('invalid_news_notes')}
  if(!exact(source,source.marketPeriod?[...sourceKeys,'marketPeriod']:sourceKeys)||!/^news-[a-z0-9-]{1,65}$/.test(source.id)||!['BRL','MXN','COP','PEN','CLP','ARS','GLOBAL'].includes(source.country)
    ||!text(source.publisher,80)||!text(source.author,100)||!text(source.publicationDisplay,100)
    ||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.search
    ||!stamp(source.publishedAt)||!(source.marketPeriod?source.eventDate===null&&validMarketPeriod(source.marketPeriod)&&source.marketPeriod.end<=review.checkedOn:day(source.eventDate))||!stamp(source.collectedAt)
    ||!Array.isArray(notes)||!notes.length||notes.length>8||new Set(notes.map(n=>n?.id)).size!==notes.length
    ||!exact(review,reviewKeys)||!['agent','human'].includes(review.origin)||review.status!=='checked'
    ||!text(review.reason,480)||review.reason.length<10||!day(review.checkedOn)
    ||!['supportingContentChecked','independentlyWorded','notTranslation','notArticleSubstitute'].every(k=>review[k]===true)
    ||!['publisher_page','publisher_feed','publisher_attributed_excerpt'].includes(review.contentAccess)
    ||source.publishedAt.slice(0,10)>review.checkedOn||source.eventDate>review.checkedOn
    ||source.collectedAt.slice(0,10)>review.checkedOn||!safe({source,notes,review})) throw new Error('invalid_news_notes')
  for(const n of notes) {
    if(!exact(n,noteKeys)||!/^n[0-7]$/.test(n.id)||!['fact','attributed_view'].includes(n.kind)
      ||!text(n.text,300)||n.text.length<10) throw new Error('invalid_news_notes')
    if(n.kind==='attributed_view' ? !validNewsAttribution(n.attribution)
      :n.attribution!==null) throw new Error('news_note_attribution_required')
    if(n.reportedPrice!==null) {
      const p=n.reportedPrice
      if(n.kind!=='fact'||!exact(p,['previous','current','delta','unit','basis','observedAt'])
        ||![p.previous,p.current,p.delta].every(Number.isFinite)||p.previous<=0||p.current<=0
        ||Math.abs(p.current-p.previous-p.delta)>1e-8||p.unit!=='CLP_per_USD'
        ||!['reported_market_close','reported_ask'].includes(p.basis)||p.observedAt!==null)
        throw new Error('invalid_news_note_price_basis')
    }
  }
  if(notes.reduce((n,v)=>n+v.text.length,0)>1200) throw new Error('news_notes_too_large')
}

export function createReviewedNewsEvidence(source,notes,review) {
  validate(source,notes,review)
  const payload={version:NEWS_NOTES_VERSION,source:structuredClone(source),notes:structuredClone(notes)}
  const binding=hash(payload)
  return {id:source.id,country:source.country,url:source.url,publishedAt:source.publishedAt,eventDate:source.eventDate,
    collectedAt:source.collectedAt,period:source.marketPeriod?periodLabel(source.marketPeriod):source.eventDate,...(source.marketPeriod?{marketPeriod:structuredClone(source.marketPeriod)}:{}),title:`${source.publisher} 검토 카드`,publisher:source.publisher,
    summary:notes.map(n=>n.text).join('\n'),scope:source.country==='GLOBAL'?'global':'country',role:'context',
    causalStatus:'source_attributed',provenance:'market_reporting',
    review:{originalVerified:true,admission:'attributed_context',scope:'검토자가 새로 작성한 사실·귀속 견해만 사용. 원문·번역문·독자적 기사 구성을 제공하지 않음.',checkedAt:review.checkedOn},
    newsNotes:{...payload,binding,review:{...structuredClone(review),binding}}}
}

// Exact reconstruction prevents a raw body, adjacent paragraph, arbitrary
// summary or stale attribution entering any existing writer projection.
export function projectReviewedNewsNotes(evidence) {
  const record=evidence?.newsNotes
  if(!exact(record,['version','source','notes','binding','review'])||record.version!==NEWS_NOTES_VERSION
    ||!exact(record.review,[...reviewKeys,'binding'])) throw new Error('unreviewed_or_stale_news_notes')
  const {binding:reviewBinding,...review}=record.review
  const rebuilt=createReviewedNewsEvidence(record.source,record.notes,review)
  if(record.binding!==rebuilt.newsNotes.binding||reviewBinding!==record.binding||JSON.stringify(evidence)!==JSON.stringify(rebuilt))
    throw new Error('unreviewed_or_stale_news_notes')
  const passages=record.notes.map(n=>({id:n.id,kind:n.kind==='fact'?'reviewer_fact':'reviewer_attributed_view',
    text:n.text,selected:true,attribution:n.attribution,reportedPrice:n.reportedPrice}))
  return {version:NEWS_NOTES_VERSION,sourceVersion:'reviewer_authored_notes',noteHash:record.binding,
    citation:{publisher:record.source.publisher,author:record.source.author,publishedAt:record.source.publishedAt,
      publicationDisplay:record.source.publicationDisplay,eventDate:record.source.eventDate},
    passageHash:hash(passages),passages}
}

export const NEWS_NOTES_INSTRUCTIONS=[
  'sourceVersion=reviewer_authored_notes는 원문 발췌·번역·직접 인용이 아니라 검토자가 작성한 사실·견해 요지다. 원문을 받았다고 표현하지 않는다.',
  'reviewer_attributed_view의 person·organization·type을 보존한다. type=publication은 기사 자체 해설, institution은 기관 견해이며 개인 전문가 발언으로 바꾸지 않는다. 전문가의 견해를 입증된 사실·공식 원인으로 승격하지 않는다.',
  'reportedPrice는 해당 매체·가격 기준의 보도값이다. 기준 환율이나 다른 매체의 호가와 혼합하지 않는다. 관측시각 null은 미상이다.',
  'notes-reference/1·2는 evidenceId·passageIds로 검토 요지를 참조한다. v2의 useRuleId는 researchBrief.cardUseRules, scopeRuleId는 scopeRuleSets의 value를 같은 규칙으로 적용한다. 원문이 아니며 채택 범위·한계는 유지한다.',
  '출처 링크를 열거나 입력에 없는 원문·수치·설명을 복원하지 않는다. 카드 범위 안에서 독자적인 종합 분석을 작성하며 기사 대체 요약을 만들지 않는다.',
].join('\n')
