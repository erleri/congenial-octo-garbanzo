// Explicit local collection or saved-capture replay; no secrets, model or DB.
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { BCCH_DAILY_URL, BCCH_METHOD, collectBcchPriceSeries, discoverBcchPriceSeries,
  parseBcchPriceSeries, prepareOfficialClpResearch } from './clp-official-price.js'
import { createBcchWindowsTransport } from './bcch-windows-transport.js'
import { readReviewedEmolQuote } from './price-basis.js'
import { planResearchNeeds } from './research-needs.js'

try {
  const {values}=parseArgs({options:{live:{type:'boolean',default:false},capture:{type:'string'},
    year:{type:'string'},'captured-at':{type:'string'},'as-of':{type:'string'},'through-session':{type:'string'},
    methodology:{type:'string'},powershell:{type:'string'},articles:{type:'string'}},strict:true})
  if (!values.live && !values.capture) {
    console.log(JSON.stringify({mode:'plan',sources:[BCCH_DAILY_URL,BCCH_METHOD.url],networkCalls:0,modelCalls:0,
      publicReuseApproved:false,publicationApproved:false}));
  } else {
    if (values.live && values.capture) throw new Error('choose_live_or_replay')
    const privateRoot=await fs.realpath('.local-reports/private')
    async function readPrivate(filename) {
      const resolved=await fs.realpath(filename),relative=path.relative(privateRoot,resolved),stat=await fs.stat(resolved)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !stat.isFile() || stat.size > 2_000_000)
        throw new Error('invalid_private_original')
      return fs.readFile(resolved)
    }
    const methodologyRaw=await readPrivate(values.methodology)
    const year=Number(values.year)
    let collected,transport=null
    if (values.live) {
      transport=values.powershell?createBcchWindowsTransport(values.powershell):null
      collected=await collectBcchPriceSeries({year,methodologyRaw,...(transport?{fetchImpl:transport.fetchImpl}:{})})
    } else {
      const rawIndex=await readPrivate(path.join(values.capture,'bcch-daily.html'))
      const raw=await readPrivate(path.join(values.capture,`bcch-series-${year}.html`))
      const url=discoverBcchPriceSeries(rawIndex.toString('utf8'))
      collected={status:'collected_local_review_only',series:parseBcchPriceSeries({raw,url,year,methodologyRaw,capturedAt:values['captured-at']}),
        requests:[],captures:[]}
    }
    const directory=await fs.mkdtemp(path.join(privateRoot,'clp-official-price-result-'))
    for (const [i,capture] of collected.captures.entries()) await fs.writeFile(path.join(directory,`original-${i}.html`),capture.raw,{flag:'wx'})
    await fs.writeFile(path.join(directory,'capture.json'),JSON.stringify({...collected,captures:collected.captures.map((c,i)=>({
      url:c.url,capturedAt:c.capturedAt,file:`original-${i}.html`}))},null,2),{flag:'wx'})
    if (collected.status === 'failed') {
      console.log(JSON.stringify({directory,status:collected.status,reason:collected.reason,requests:collected.requests.length,
        modelCalls:0,apiCostUsd:0,publicationApproved:false}));process.exitCode=1
    } else {
      const articleQuotes=[]
      if (values.articles) {
        const stat=await fs.stat(values.articles)
        if (!stat.isFile() || stat.size > 100_000) throw new Error('invalid_article_manifest')
        const manifest=JSON.parse(await fs.readFile(values.articles,'utf8'))
        const originals=JSON.parse(await readPrivate(manifest.articleOriginalsFile))
        for (const descriptor of manifest.articleReviews) articleQuotes.push(readReviewedEmolQuote({
          original:originals.find(o=>o.id===descriptor.id),rawHtml:await readPrivate(descriptor.rawFile),
          review:descriptor.review,quoteSide:descriptor.quoteSide}))
      }
      const asOf=values['as-of']??(values.live?new Date().toISOString():null)
      const result=prepareOfficialClpResearch(collected.series,{throughSessionDate:values['through-session'],asOf,articleQuotes})
      const input={packet:result.packet,purpose:'fx_explanation',asOf,topics:[],requirements:{market:[{
        id:'local-market-basis',period:values['through-session'],scope:{subject:'CLP/USD formal spot transactions',
          metric:'transaction_weighted_average',unit:'CLP per USD',comparison:'previous verified local transaction day',
          priceBasis:'BCCh official transaction-weighted average, not bid/ask close'},
      }]},maxQueries:4,priority:'core_first'}
      const plan=planResearchNeeds(input)
      await fs.writeFile(path.join(directory,'research-input.json'),JSON.stringify(input,null,2),{flag:'wx'})
      await fs.writeFile(path.join(directory,'research-plan.json'),JSON.stringify(plan,null,2),{flag:'wx'})
      await fs.writeFile(path.join(directory,'price-research.json'),JSON.stringify(result,null,2),{flag:'wx'})
      console.log(JSON.stringify({directory,status:collected.status,reportDate:result.packet.baseDate,
        actualTransactionDate:result.packet.observedDate,priceDataStatus:result.priceDataStatus,
        recentObservations:result.packet.marketData.reportPriceBasis.observations,
        articleLink:result.articleLink,writingEligibility:result.writingEligibility,
        researchCoreStatus:plan.coreStatus,unverifiedCalendarRows:collected.series.calendarUnverified,
        requests:collected.requests.length,transport:transport?{mode:transport.mode,sizeBound:transport.sizeBound}:
          {mode:values.live?'node_fetch':'saved_capture_replay'},modelCalls:0,apiCostUsd:0,publicationApproved:false},null,2))
    }
  }
} catch(error) {
  // Do not print arbitrary source HTML, private inputs, paths or credentials.
  const message=/^[a-z_]+$/.test(error.message)?error.message:'invalid_official_price_input'
  console.error(`clp_official_price_failed:${message}`);process.exitCode=1
}
