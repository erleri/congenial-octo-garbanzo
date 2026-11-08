// Discovery hints are not evidence. A past extraction failure must not make a
// useful explanation permanently lose to a price ticker at the same publisher.
export const NEWS_SELECTION_VERSION='news-selection/1'
export const explanationHint=c=>/por qu[eé]|a qu[eé] se debe|por que|ante|tras|explica|debido|pression|press[aã]o|fluxo|demanda|oferta|carry|diferencial/i.test(c.title??'')
export const dateHint=(url,day)=>typeof day==='string'&&[day,day.replaceAll('-','/'),day.replaceAll('-','')].some(s=>url.includes(s))
export function newsCandidateComparator(currency,{period,deprioritizeUrls=[]}={}) {
 const local={BRL:/real|brasil|brasileir/i,MXN:/peso|m[eé]xico|mexican/i,COP:/colombia|colombian/i,PEN:/per[uú]|sol(?:es)?\b/i,CLP:/chile|chilen/i,ARS:/argentin|mayorista|bcra/i}[currency]
 const score=c=>Number(local?.test(c.title))*3+Number(dateHint(c.url,period))
  -Number(/oro|gold|bitcoin|euro|yen/i.test(c.title)&&!local?.test(c.title))*4
 return (a,b)=>Number(explanationHint(b))-Number(explanationHint(a))
  ||Number(deprioritizeUrls.includes(a.url))-Number(deprioritizeUrls.includes(b.url))||score(b)-score(a)
}
export const rankNewsCandidates=(candidates,currency,options)=>[...candidates].sort(newsCandidateComparator(currency,options))
