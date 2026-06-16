const EXCHANGE_RATE_ENDPOINT = 'https://v6.exchangerate-api.com/v6'
const FETCH_TIMEOUT_MS = 10000

function readRequiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} secret is missing or empty.`)
  }
  return value
}

function readOptionalEnv(name) {
  return process.env[name]?.trim() ?? ''
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

async function main() {
  const exchangeRateApiKey = readRequiredEnv('VITE_EXCHANGERATE_API_KEY')
  const alphaVantageApiKey = readOptionalEnv('VITE_ALPHA_VANTAGE_API_KEY')

  await validateExchangeRateApi(exchangeRateApiKey)

  if (alphaVantageApiKey) {
    console.log('Alpha Vantage API key: configured; live validation skipped to preserve daily quota.')
  } else {
    console.warn('Alpha Vantage API key: not configured; cached data and fallback context will be used.')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
