import {validDate} from './core.js'
// Relative words are not permission to stamp publication time onto an event.
// A quoted source span, publisher-local date, and matching relation are all
// required, then the separate comparison still checks the event's meaning.
export const NEWS_EVENT_DATE_VERSION='news-event-date/4'
// Retained byte-for-byte to verify the binding of already paid /2 requests.
export const LEGACY_NEWS_EVENT_DATE_GUIDE='eventDateEvidence는 basis(explicit/relative/unknown), quote, blockPositions, relation(same_day/previous_day/none)을 반환한다. 사건·거래일이 원문에 명시되면 explicit이다. hoy/hoje/ayer/ontem 또는 este/esta+요일처럼 현재 세션을 명시한 구절은 relative로 표시하고 time.publicationDate를 달력 기준으로 계산한다. 상대 표현 없는 발표일 대입, 수집일 대입, 요일만으로 최근 거래일 추측은 금지한다. quote는 원문 그대로 짧게, 판단 불가면 unknown·빈 eventDate다. 가격 관측시각은 이 계산으로 만들지 않는다.'
export const PREVIOUS_NEWS_EVENT_DATE_GUIDE=[
 'eventDateEvidence는 basis(explicit/relative/unknown), quote, blockPositions, relation(same_day/previous_day/none)을 반환한다. quote는 원문 그대로 짧게, blockPositions는 그 구절의 위치다.',
 '날짜가 명시되면 explicit·relation=none을 우선한다. 예: 30 de octubre와 발행연도가 일치하는 사건은 YYYY-10-30이다. hoy와 명시 날짜가 함께 있어도 explicit·none으로 작성한다. 연도가 원문에 없으면 발행연도와 모순되는 회고가 아닌지 확인한다.',
 '현재 세션을 지칭하는 hoy/hoje, este/esta/neste/nesta+요일, esta mañana/tarde/noche 또는 nesta manhã/tarde/noite는 relative·same_day다. ayer/ontem은 relative·previous_day다. time.publicationDate는 이런 구절의 현지 달력 기준일일 뿐 사건일의 독립 근거가 아니다.',
 '제목·URL·발표일·수집일만으로 거래일을 채우지 않는다. 날짜 미상은 unknown·relation=none·빈 eventDate다. 가격 관측시각은 계산하거나 만들어 넣지 않는다.',
 '한 후보의 eventDate·role·priceKind는 선택한 하나의 사건 또는 세션에 대한 것이다. 시장 설명에서는 가격 움직임과 귀속 해석의 같은 거래일을 고른다. 전일 종가·당일 예정회의·월간 자금흐름·채권 수익률 비교기간을 한 날짜로 묶지 않는다. 비교값의 전일 표시는 본문에 유지한다.',
 '예정 정책행사의 날짜는 policy_context의 근거가 될 수 있지만 이미 일어난 환율 반응의 근거가 아니다. 기준일 이후 예정행사는 별도 관찰 일정이며 이 경로의 현재 사건 카드로 채택하지 않는다. 월별 배경·주식/채권 회고 날짜를 FX 세션으로 바꾸지 않는다. 시장 설명을 확보할 수 없으면 지원되는 다른 역할만 선택하거나 부족 상태로 반환한다.',
 '요청 기간 밖 자료는 실제 날짜를 유지한다. 최신 날짜로 고치거나 다른 나라의 날짜 규칙을 적용하지 않는다. 서로 다른 날짜의 요지를 억지로 합치지 않고 해당 후보에서 제외한다.',
].join('\n')
export const NEWS_EVENT_DATE_V3_GUIDE=[
 'eventDateEvidence: basis(explicit/relative/unknown), 원문 그대로의 짧은 quote, 해당 blockPositions, relation(same_day/previous_day/none).',
 '명시 날짜는 explicit·none이다. 연도 생략은 발행연도와 회고 여부를 확인한다. 현재 세션 요일·일 조합(nesta sexta-feira (30))은 발행 현지 날짜의 요일·일이 모두 일치할 때만 허용한다.',
 'hoy/hoje, este/esta/neste/nesta+요일, esta mañana/tarde/noche, nesta manhã/tarde/noite는 relative·same_day, ayer/ontem은 relative·previous_day다. 발행 현지 날짜를 기준으로 계산하되 명시 날짜가 함께 있으면 explicit·none을 우선한다.',
 '제목·URL·발표일·수집일·요일만으로 사건일이나 가격 관측시각을 채우지 않는다. 날짜 미상은 unknown·none·빈 eventDate다.',
 '한 후보는 하나의 사건·세션이다. 가격 움직임과 귀속 해석의 같은 거래일을 고른다. 전일 비교값·예정회의·월간 자금흐름·채권 수익률 기간은 따로 보존한다. 정책 일정은 policy_context이고 실제 FX 반응이 아니다. 기준일 이후 예정행사는 별도 관찰 일정으로 둔다.',
 '회고·예정 날짜를 현재 FX 세션으로 바꾸지 않는다. 기간 밖 날짜는 원래대로 두고 해당 후보에서 제외한다. 시장 설명이 없으면 지원되는 역할만 반환하거나 보류한다.',
].join('\n')
// New selection guidance replaces the old session paragraph instead of
// accumulating warnings; preserve the exact /3 guide for paid prior requests.
export const NEWS_EVENT_DATE_GUIDE=NEWS_EVENT_DATE_V3_GUIDE.replace(
 '한 후보는 하나의 사건·세션이다. 가격 움직임과 귀속 해석의 같은 거래일을 고른다. 전일 비교값·예정회의·월간 자금흐름·채권 수익률 기간은 따로 보존한다. 정책 일정은 policy_context이고 실제 FX 반응이 아니다. 기준일 이후 예정행사는 별도 관찰 일정으로 둔다.',
 '먼저 사건·거래일별로 묶고 날짜·시장 움직임·현지 해석이 함께 확인되는 한 묶음만 고른다. 최신 날짜를 강제하지 않으며 이전 거래일도 원래 날짜로 쓸 수 있다. 날짜 없는 발언·전일 비교·예정행사를 다른 세션에 옮기지 않는다. 충돌하는 가격 수치는 제외하되 수치 없이도 지지되는 움직임·귀속 해석은 후보로 삼을 수 있다. 정책 일정은 policy_context다.')
const norm=s=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
const weekdays=[['domingo'],['lunes','segunda-feira'],['martes','terca-feira'],['miercoles','quarta-feira'],['jueves','quinta-feira'],['viernes','sexta-feira'],['sabado']]
function anchoredWeekdayDay(q,anchor,eventDate) {
 if(!validDate(anchor)||anchor!==eventDate)return false
 const day=new Date(anchor+'T12:00:00Z').getUTCDay(),date=Number(anchor.slice(-2))
 // Match the complete quote, not a substring in a retrospective/future clause.
 return weekdays[day].some(name=>new RegExp(`^(?:este|esta|neste|nesta)\\s+${name}\\s*\\(0?${date}\\)$`).test(q.trim()))
}
export function inspectEventDateEvidence(job,candidate) {
 const e=candidate.eventDateEvidence
 if(!e)return {status:'legacy_explicit_date_requires_comparison'}
 if(e.basis==='unknown')throw Error('event_date_unverified')
 if(!Array.isArray(e.blockPositions)||!e.blockPositions.length||e.blockPositions.length>8
  ||!e.blockPositions.every(i=>Number.isInteger(i)&&job.blocks[i])||typeof e.quote!=='string'||!e.quote.trim()||e.quote.length>480
  ||!e.blockPositions.some(i=>job.blocks[i].text.includes(e.quote)))throw Error('event_date_source_span_required')
 if(e.basis==='explicit'){
  if(!validDate(candidate.eventDate))throw Error('event_date_evidence_mismatch')
  const q=norm(e.quote),[year,month,day]=candidate.eventDate.split('-').map(Number)
  const months=['enero|janeiro','febrero|fevereiro','marzo|marco','abril','mayo|maio','junio|junho','julio|julho','agosto','septiembre|setiembre|setembro','octubre|outubro','noviembre|novembro','diciembre|dezembro']
  const full=q.includes(candidate.eventDate)||new RegExp(`\\b0?${day}[/.-]0?${month}[/.-]${year}\\b`).test(q)
   ||new RegExp(`\\b${day}\\s+(?:de\\s+)?(?:${months[month-1]})\\s+(?:de\\s+)?${year}\\b`).test(q)
  const withoutYear=job.time.publicationDate?.slice(0,4)===String(year)&&!/\b20\d{2}\b/.test(q)
   &&new RegExp(`\\b${day}\\s+(?:de\\s+)?(?:${months[month-1]})\\b`).test(q)
  if(!full&&!withoutYear&&!anchoredWeekdayDay(q,job.time.publicationDate,candidate.eventDate))throw Error('explicit_event_date_not_supported')
  // Redundant relative metadata is harmless only when the explicit source date
  // and the publisher's local calendar independently agree. Never rewrite it.
  if(e.relation!=='none'){
   const anchor=job.time.publicationDate
   if(!validDate(anchor)||!['same_day','previous_day'].includes(e.relation))throw Error('event_date_evidence_mismatch')
   const date=new Date(anchor+'T12:00:00Z');if(e.relation==='previous_day')date.setUTCDate(date.getUTCDate()-1)
   if(candidate.eventDate!==date.toISOString().slice(0,10))throw Error('event_date_evidence_mismatch')
  }
  return {status:'explicit_date_requires_comparison'}
 }
 const anchor=job.time.publicationDate,q=norm(e.quote)
 if(e.basis!=='relative'||!validDate(anchor))throw Error('relative_event_date_anchor_missing')
 const previous=/\b(ayer|ontem)\b/.test(q),today=/\b(hoy|hoje)\b/.test(q)
  ||/\b(?:esta\s+(?:manana|tarde|noche)|nesta\s+(?:manha|tarde|noite))\b/.test(q)
 const day=new Date(anchor+'T12:00:00Z').getUTCDay()
 const weekday=weekdays[day].some(d=>new RegExp(`\\b(?:este|esta|nesta|neste)\\s+${d}\\b`).test(q))
 if(weekday&&/\(\d{1,2}\)/.test(q)&&!anchoredWeekdayDay(q,anchor,candidate.eventDate))throw Error('relative_event_date_mismatch')
 if(previous&&(today||weekday)||e.relation==='previous_day'&&!previous||e.relation==='same_day'&&(!today&&!weekday||previous)
  ||!['same_day','previous_day'].includes(e.relation))throw Error('relative_event_date_ambiguous')
 const date=new Date(anchor+'T12:00:00Z');if(previous)date.setUTCDate(date.getUTCDate()-1)
 if(candidate.eventDate!==date.toISOString().slice(0,10))throw Error('relative_event_date_mismatch')
 return {status:'relative_date_requires_comparison',publicationDate:anchor,relation:e.relation}
}
