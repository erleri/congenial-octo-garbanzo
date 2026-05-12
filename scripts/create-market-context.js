import fs from 'node:fs'
import path from 'node:path'
import { MAJOR_CURRENCIES, formatRate, loadJson } from './email-template.js'

const DATA_PATH = path.resolve('public/data.json')
const OUTPUT_PATH = path.resolve('email-market-context.json')
const ALPHA_VANTAGE_ENDPOINT = 'https://www.alphavantage.co/query'
const FALLBACK_BULLET = 'No clear public-news signal was found from the automated source.'

const CURRENCY_TERMS = {
  BRL: ['brl', 'brazil', 'brazilian', 'real'],
  MXN: ['mxn', 'mexico', 'mexican', 'peso'],
  CLP: ['clp', 'chile', 'chilean'],
  COP: ['cop', 'colombia', 'colombian'],
  ARS: ['ars', 'argentina', 'argentine'],
  PEN: ['pen', 'peru', 'peruvian', 'sol'],
}

function getLatestMoves(dataset) {
  const dailyRates = dataset.dailyRates ?? []
  const baseDate = dataset.baseDate

  return MAJOR_CURRENCIES.map((currency) => {
    const rows = dailyRates
      .filter((row) =>
        row.currency === currency &&
        row.rateType === 'LOCAL_PER_USD' &&
        row.date <= baseDate &&
        typeof row.value === 'number',
      )
      .sort((a, b) => a.date.localeCompare(b.date))
    const latest = rows.at(-1)
    const previous = rows.slice(0, -1).reverse().find((row) => row.date < latest?.date)

    if (!latest || !previous || !previous.value) {
      return null
    }

    const changePct = ((latest.value - previous.value) / previous.value) * 100
    return {
      currency,
      latest: latest.value,
      previous: previous.value,
      changePct,
      direction: changePct >= 0 ? 'weakened' : 'strengthened',
    }
  })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 3)
}

async function fetchNews(baseDate) {
  const apiKey = process.env.VITE_ALPHA_VANTAGE_API_KEY?.trim()
  if (!apiKey) {
    return []
  }

  const params = new URLSearchParams({
    function: 'NEWS_SENTIMENT',
    tickers: 'FOREX:USD',
    sort: 'LATEST',
    limit: '50',
    apikey: apiKey,
  })

  try {
    const response = await fetch(`${ALPHA_VANTAGE_ENDPOINT}?${params.toString()}`)
    if (!response.ok) {
      return []
    }

    const payload = await response.json()
    return Array.isArray(payload.feed) ? payload.feed : []
  } catch {
    return []
  }
}

function summarizeTopics(article) {
  const topics = Array.isArray(article.topics)
    ? article.topics.map((topic) => topic.topic).filter(Boolean)
    : []
  return topics.slice(0, 2).join(', ')
}

function findEvidence(currency, articles) {
  const terms = CURRENCY_TERMS[currency] ?? []
  const directMatches = articles.filter((article) => {
    const haystack = `${article.title ?? ''} ${article.summary ?? ''}`.toLowerCase()
    const tickerMatches = Array.isArray(article.ticker_sentiment)
      ? article.ticker_sentiment.some((ticker) => String(ticker.ticker ?? '').toUpperCase() === `FOREX:${currency}`)
      : false
    return tickerMatches || terms.some((term) => haystack.includes(term))
  })

  return directMatches.length ? directMatches : articles.slice(0, 2)
}

function buildBullet(move, evidence) {
  const moveText = `${move.currency} ${move.direction} ${Math.abs(move.changePct).toFixed(2)}% vs USD`
  if (!evidence.length) {
    return `${moveText}; no clear matching public-news topic was found.`
  }

  const article = evidence[0]
  const topicText = summarizeTopics(article)
  const contextText = topicText ? `referenced topics: ${topicText}` : 'related market headlines found'

  return `${moveText}; ${contextText}.`
}

async function main() {
  const dataset = loadJson(DATA_PATH)
  if (!dataset?.baseDate) {
    throw new Error('public/data.json is missing baseDate.')
  }

  const moves = getLatestMoves(dataset)
  const articles = await fetchNews(dataset.baseDate)
  const bullets = moves.map((move) => buildBullet(move, findEvidence(move.currency, articles))).slice(0, 3)
  const payload = {
    status: bullets.length ? 'ok' : 'fallback',
    generatedAt: new Date().toISOString(),
    baseDate: dataset.baseDate,
    bullets: bullets.length ? bullets : [FALLBACK_BULLET],
    topMoves: moves.map((move) => ({
      currency: move.currency,
      latest: formatRate(move.latest),
      previous: formatRate(move.previous),
      changePct: Number(move.changePct.toFixed(4)),
    })),
    source: articles.length ? 'Alpha Vantage NEWS_SENTIMENT' : 'fallback',
  }

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  console.log(`Wrote ${OUTPUT_PATH}`)
}

main().catch((error) => {
  const fallback = {
    status: 'fallback',
    generatedAt: new Date().toISOString(),
    baseDate: loadJson(DATA_PATH, {})?.baseDate ?? null,
    bullets: [FALLBACK_BULLET],
    topMoves: [],
    source: 'fallback',
    error: error instanceof Error ? error.message : String(error),
  }
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(fallback, null, 2)}\n`, 'utf-8')
  console.log(`Wrote fallback ${OUTPUT_PATH}`)
})
