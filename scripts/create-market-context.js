import fs from 'node:fs'
import path from 'node:path'
import { MAJOR_CURRENCIES, formatRate, loadJson } from './email-template.js'

const DATA_PATH = path.resolve('public/data.json')
const OUTPUT_PATH = path.resolve('email-market-context.json')
const ALPHA_VANTAGE_ENDPOINT = 'https://www.alphavantage.co/query'
const FALLBACK_BULLET = 'No clear public-news signal was found from the automated source.'
const FALLBACK_BIAS = 'Mixed until clearer public-news signals appear.'

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

function summarizeFeedTopics(articles, limit = 3) {
  const counts = new Map()

  for (const article of articles) {
    if (!Array.isArray(article.topics)) {
      continue
    }

    for (const topic of article.topics) {
      const topicName = topic.topic
      if (!topicName) {
        continue
      }
      counts.set(topicName, (counts.get(topicName) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic]) => topic)
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

function describeMove(move, includeVsUsd = true) {
  const suffix = includeVsUsd ? ' vs USD' : ''
  return `${move.currency} ${move.direction} ${Math.abs(move.changePct).toFixed(2)}%${suffix}`
}

function buildUsdToneSentence(articles) {
  const feedTopics = summarizeFeedTopics(articles)

  if (!feedTopics.length) {
    return null
  }

  return `USD-related public-news flow centered on ${feedTopics.join(', ')}; treated as automated context only.`
}

function buildRegionalPressureSentence(moves) {
  if (!moves.length) {
    return FALLBACK_BULLET
  }

  const selectedMoves = moves.slice(0, 3)
  const hasWeaker = selectedMoves.some((move) => move.direction === 'weakened')
  const hasStronger = selectedMoves.some((move) => move.direction === 'strengthened')
  const tone = hasWeaker && hasStronger
    ? 'was mixed'
    : hasWeaker
      ? 'tilted weaker'
      : 'tilted stronger'
  const moveText = selectedMoves
    .map((move) => describeMove(move, false))
    .join('; ')

  return `Regional price action ${tone}: ${moveText} against USD.`
}

function buildCurrencyMoveSentence(move, evidence) {
  const moveText = describeMove(move)
  if (!evidence.length) {
    return `Price action was led by ${move.currency}, which ${move.direction} ${Math.abs(move.changePct).toFixed(2)}% vs USD; no clear matching public-news topic was found in the automated source.`
  }

  const topicText = summarizeTopics(evidence[0])
  if (!topicText) {
    return `Price action was led by ${moveText}; related public-market headlines were available but no clear topic label was attached.`
  }

  return `Price action was led by ${moveText}; automated public-news context referenced ${topicText}.`
}

function buildWhatMovedToday(moves, articles) {
  if (!moves.length) {
    return [FALLBACK_BULLET]
  }

  const bullets = []
  const usdTone = buildUsdToneSentence(articles)

  if (usdTone) {
    bullets.push(usdTone)
  }

  bullets.push(buildRegionalPressureSentence(moves))
  bullets.push(buildCurrencyMoveSentence(moves[0], findEvidence(moves[0].currency, articles)))

  return bullets.slice(0, 3)
}

function classifyMoveBias(move) {
  const absChange = Math.abs(move.changePct)
  if (absChange < 0.2) {
    return 'rangebound'
  }

  return move.changePct < 0 ? 'supportive' : 'pressured'
}

function joinCurrencyList(currencies) {
  if (!currencies?.length) {
    return ''
  }

  if (currencies.length === 1) {
    return currencies[0]
  }

  return `${currencies.slice(0, -1).join(', ')} and ${currencies.at(-1)}`
}

function subjectVerb(currencies, singularVerb, pluralVerb) {
  return currencies.length === 1 ? singularVerb : pluralVerb
}

function buildNearTermBias(moves, articles) {
  if (!moves.length) {
    return FALLBACK_BIAS
  }

  const grouped = moves.slice(0, 3).reduce((acc, move) => {
    const bias = classifyMoveBias(move)
    acc[bias] = [...(acc[bias] ?? []), move.currency]
    return acc
  }, {})
  const segments = []

  if (grouped.pressured?.length) {
    segments.push(`${joinCurrencyList(grouped.pressured)} ${subjectVerb(grouped.pressured, 'looks', 'look')} pressured on price action`)
  }

  if (grouped.supportive?.length) {
    segments.push(`${joinCurrencyList(grouped.supportive)} ${subjectVerb(grouped.supportive, 'looks', 'look')} supportive on price action`)
  }

  if (grouped.rangebound?.length) {
    segments.push(`${joinCurrencyList(grouped.rangebound)} ${subjectVerb(grouped.rangebound, 'remains', 'remain')} rangebound`)
  }

  const confidence = articles.length ? 'public-news signal was available' : 'public-news signal was limited'

  return `Near-term bias remains mixed: ${segments.join(', ')}; ${confidence}.`
}

async function main() {
  const dataset = loadJson(DATA_PATH)
  if (!dataset?.baseDate) {
    throw new Error('public/data.json is missing baseDate.')
  }

  const moves = getLatestMoves(dataset)
  const articles = await fetchNews(dataset.baseDate)
  const whatMovedToday = buildWhatMovedToday(moves, articles)
  const nearTermBias = buildNearTermBias(moves, articles)
  const payload = {
    status: moves.length ? 'ok' : 'fallback',
    generatedAt: new Date().toISOString(),
    baseDate: dataset.baseDate,
    bullets: whatMovedToday,
    whatMovedToday,
    nearTermBias,
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
    whatMovedToday: [FALLBACK_BULLET],
    nearTermBias: FALLBACK_BIAS,
    topMoves: [],
    source: 'fallback',
    error: error instanceof Error ? error.message : String(error),
  }
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(fallback, null, 2)}\n`, 'utf-8')
  console.log(`Wrote fallback ${OUTPUT_PATH}`)
})
