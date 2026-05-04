const EXCHANGE_RATE_ENDPOINT = 'https://v6.exchangerate-api.com/v6'
const ALPHA_VANTAGE_ENDPOINT = 'https://www.alphavantage.co/query'
const FETCH_TIMEOUT_MS = 10000

function readRequiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} secret is missing or empty.`)
  }
  return value
}

async function fetchJson(url) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

async function validateExchangeRateApi(apiKey) {
  const url = `${EXCHANGE_RATE_ENDPOINT}/${encodeURIComponent(apiKey)}/latest/USD`
  const payload = await fetchJson(url)

  if (payload?.result !== 'success' || typeof payload?.conversion_rates?.KRW !== 'number') {
    const errorType = typeof payload?.['error-type'] === 'string' ? payload['error-type'] : 'unexpected response'
    throw new Error(`ExchangeRate API validation failed: ${errorType}`)
  }

  console.log('ExchangeRate API: OK')
}

async function validateAlphaVantageApi(apiKey) {
  const params = new URLSearchParams({
    function: 'FX_DAILY',
    from_symbol: 'USD',
    to_symbol: 'CLP',
    outputsize: 'compact',
    apikey: apiKey,
  })

  const payload = await fetchJson(`${ALPHA_VANTAGE_ENDPOINT}?${params.toString()}`)
  const timeSeries = payload?.['Time Series FX (Daily)']

  if (!timeSeries || typeof timeSeries !== 'object') {
    const message =
      payload?.['Error Message'] ??
      payload?.Information ??
      payload?.Note ??
      'unexpected response'
    throw new Error(`Alpha Vantage API validation failed: ${message}`)
  }

  console.log('Alpha Vantage API: OK')
}

async function main() {
  const exchangeRateApiKey = readRequiredEnv('VITE_EXCHANGERATE_API_KEY')
  const alphaVantageApiKey = readRequiredEnv('VITE_ALPHA_VANTAGE_API_KEY')

  await validateExchangeRateApi(exchangeRateApiKey)
  await validateAlphaVantageApi(alphaVantageApiKey)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
