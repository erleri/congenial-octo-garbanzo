// Comparable quotes are separate from the immutable values in older reports.
export const HANA_EFFECTIVE_FROM='2026-11-19'
export function hanaComparison(data,currency,date) {
 const transition=data?.hanaTransition
 if(transition?.version!=='hana-transition/1'||!Array.isArray(transition.quotes))return null
 const matches=transition.quotes.filter(q=>q.currency===currency&&q.requestedDate===date)
 if(matches.length!==1)return null
 const q=matches[0],s=q.source,b=s?.bankQuote,initial=['BRL','MXN','CLP','COP'].includes(currency)
 if(!['BRL','MXN','CLP','COP','PEN','ARS'].includes(currency)||!/^\d{4}-\d{2}-\d{2}$/.test(q.date)
  ||q.date>date||s?.provider!=='hana_bank'||s.providerDate!==q.date||s.origin!=='response'
  ||s.providerTimeZone!=='Asia/Seoul'||s.digestMeaning!=='parsed_json'||!/^[a-f0-9]{64}$/.test(s.responseSha256??'')
  ||!Number.isFinite(Date.parse(s.capturedAt))||Date.parse(s.capturedAt)>Date.parse(data.fetchedAt)
  ||typeof b?.rawValue!=='string'||!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(b.rawValue))return null
 const raw=Number(b.rawValue.replaceAll(',',''))
 if(raw<=0||q.value!==(initial?1/raw:raw)||b.kind!==(initial?'initial':'cross')
  ||b.bulletin!==(initial?1:null)||b.unit!==(initial?'USD_per_local':'local_per_USD')
  ||s.endpoint!==`https://www.kebhana.com/cms/rate/wpfxd651_${initial?'01':'10'}i_01.do`)return null
 return q
}
