// Local acquisition profiles, not licenses or permission to send publisher text
// to a model. Exact hosts and article paths prevent a catalog edit widening access.
export const NEWS_ACCESS_VERSION='news-publisher-access/1'
export const NEWS_PUBLISHERS=Object.freeze({
 'brl-camara-radio':{currency:'BRL',host:'www.camara.leg.br',path:/^\/radio\/programas\/\d+-[^/]+\/$/},
 'brl-cnn':{currency:'BRL',host:'www.cnnbrasil.com.br',path:/^\/economia\/money\/mercado\/[^/]+\/$/},
 'mxn-forbes':{currency:'MXN',host:'forbes.com.mx',path:/^\/[^/]*(?:peso|dolar)[^/]*\/$/},
 'mxn-elfinanciero':{currency:'MXN',host:'www.elfinanciero.com.mx',path:/^\/(?:economia|mercados)\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/},
 'cop-valora':{currency:'COP',host:'www.valoraanalitik.com',path:/^\/[^/]*(?:dolar|peso)[^/]*\/$/},
 'clp-biobio':{currency:'CLP',host:'www.biobiochile.cl',index:'/news-sitemap.xml',path:/^\/noticias\/economia\/actualidad-economica\/\d{4}\/\d{2}\/\d{2}\/[^/]+\.shtml$/},
 'clp-cooperativa':{currency:'CLP',host:'www.cooperativa.cl',path:/^\/noticias\/economia\/divisas\/dolar\/.+\/\d{4}-\d{2}-\d{2}\/\d+\.html$/},
 'ars-iprofesional':{currency:'ARS',host:'www.iprofesional.com',path:/^\/finanzas\/\d+-[^/]+$/},
 'pen-elcomercio':{currency:'PEN',host:'elcomercio.pe',path:/^\/economia\/(?:peru|mercados)\/[^/]+-noticia\/$/},
 'pen-andina':{currency:'PEN',host:'andina.pe',index:'/agencia/news-sitemap.xml',path:/^\/agencia\/noticia-[^/]+-\d+\.aspx$/},
 'pen-infobae':{currency:'PEN',host:'www.infobae.com',index:'/arc/outboundfeeds/news-sitemap/category/peru/',path:/^\/peru\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/$/},
 'pen-revistaeconomia':{currency:'PEN',host:'www.revistaeconomia.com',index:'/feed/',sitemap:'/sitemap_index.xml',
  sitemapChild:/^\/post-sitemap(?:[1-9]\d*)?\.xml$/,
  path:/^\/(?=(?:[a-z0-9]+-)*(?:sol|dolar|tipo-de-cambio)(?:-|\/))[a-z0-9]+(?:-[a-z0-9]+)*\/$/},
})

export function newsPublisherProfile(sourceId,currency,url){
 const profile=NEWS_PUBLISHERS[sourceId]
 if(!profile)return null
 const u=new URL(url)
 if(profile.currency!==currency||u.protocol!=='https:'||u.hostname!==profile.host||u.username||u.password||u.port)
  throw Error('publisher_profile_mismatch')
 return {...profile,robotsUrl:u.origin+'/robots.txt',indexUrl:profile.index?u.origin+profile.index:null,
  sitemapUrl:profile.sitemap?u.origin+profile.sitemap:null,version:NEWS_ACCESS_VERSION}
}

// RFC-style group selection, longest matching rule, Allow wins equal length.
// Only supported directives are interpreted; robots is never a reuse license.
export function inspectRobots(text,url,agent='LATAM-FX-local-research'){
 if(typeof text!=='string'||Buffer.byteLength(text)>200_000||/<(?:html|body|script)\b/i.test(text))throw Error('invalid_robots_document')
 const groups=[];let group=null
 for(const raw of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
  const line=raw.replace(/#.*$/,'').trim(),m=/^([\w-]+)\s*:\s*(.*)$/.exec(line)
  if(!m)continue
  const key=m[1].toLowerCase(),value=m[2].trim()
  if(key==='user-agent'){
   if(!group||group.hasDirectives){group={agents:[],rules:[],delay:null,hasDirectives:false};groups.push(group)}
   group.agents.push(value.toLowerCase())
  }else if(group&&['allow','disallow'].includes(key)){group.hasDirectives=true;if(value)group.rules.push({allow:key==='allow',value})}
  else if(group&&key==='crawl-delay'&&/^\d+(?:\.\d+)?$/.test(value)){group.hasDirectives=true;group.delay=Number(value)}
 }
 const target=new URL(url),query=target.pathname+target.search,identity=agent.toLowerCase()
 const scored=groups.map(g=>({...g,score:Math.max(-1,...g.agents.map(a=>a==='*'?0:identity.includes(a)?a.length:-1))}))
 const best=Math.max(-1,...scored.map(g=>g.score)),selected=scored.filter(g=>g.score===best&&best>=0)
 const hits=selected.flatMap(g=>g.rules).filter(r=>{
  const end=r.value.endsWith('$'),s=end?r.value.slice(0,-1):r.value
  const pattern=s.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')
  return new RegExp('^'+pattern+(end?'$':'')).test(query)
 }).sort((a,b)=>b.value.replace(/\*/g,'').length-a.value.replace(/\*/g,'').length||Number(b.allow)-Number(a.allow))
 return {allowed:hits[0]?.allow??true,matchedRule:hits[0]?.value??null,crawlDelaySeconds:Math.max(0,...selected.map(g=>g.delay??0)),
  licenseGranted:false}
}

export function publisherAccessBarrier(html){
 if(/"isAccessibleForFree"\s*:\s*(?:false|"false")/i.test(html))return 'publisher_paywall'
 // El Comercio's server includes hidden premium text. Never extract it even
 // when a search reader can display it or JSON-LD claims the page is free.
 if(/class=["'][^"']*\bsc__nota-premium\b[^"']*["']/i.test(html)
  ||/class=["'][^"']*\bpaywall\b[^"']*["'][^>]*style=["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(html))return 'publisher_paywall'
 return null
}

export function articleOriginHints(url,blocks){
 const body=blocks.map(b=>b.text).join('\n')
 const credits=[...new Set([...body.matchAll(/(?:con informaci[oó]n de|com informa[çc][õo]es d[ae]|fuente\s*:|source\s*:)\s*(Reuters|Bloomberg|EFE|AFP|Estad[aã]o Conte[uú]do|Diario La Rep[uú]blica)/gi)].map(m=>m[1]))]
 return {retrievalUrl:url,creditedOrigins:credits,independence:'not_assessed',
  duplicateReviewRequired:true,externalModelUse:'pending',publicDisplayUse:'pending'}
}
