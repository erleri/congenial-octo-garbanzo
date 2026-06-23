import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const dataset = JSON.parse(fs.readFileSync(path.resolve('public/data.json'), 'utf8'))

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

export function numericValuesMatch(expected, actual, tolerance = 1e-10) {
  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined
  }

  if (actual === null || actual === undefined) {
    return false
  }

  const expectedNumber = Number(expected)
  const actualNumber = Number(actual)
  if (!Number.isFinite(expectedNumber) || !Number.isFinite(actualNumber)) {
    return false
  }

  const scale = Math.max(1, Math.abs(expectedNumber), Math.abs(actualNumber))
  return Math.abs(expectedNumber - actualNumber) <= tolerance * scale
}

function describeValue(value) {
  if (value === null) {
    return 'null'
  }
  if (value === undefined) {
    return 'undefined'
  }
  return JSON.stringify(value)
}

async function main() {
  const supabase = createClient(
    requiredEnv('VITE_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )

  const { data: state, error: stateError } = await supabase
    .from('fx_dataset_state')
    .select('*')
    .eq('dataset_key', 'primary')
    .single()
  if (stateError) {
    throw stateError
  }

  const failures = []
  if (state.base_date !== dataset.baseDate) {
    failures.push(`baseDate ${state.base_date} !== ${dataset.baseDate}`)
  }
  if (state.daily_row_count !== dataset.dailyRates.length) {
    failures.push(`daily rows ${state.daily_row_count} !== ${dataset.dailyRates.length}`)
  }
  if (state.monthly_row_count !== dataset.monthlyRates.length) {
    failures.push(`monthly rows ${state.monthly_row_count} !== ${dataset.monthlyRates.length}`)
  }

  const [
    { count: dailyCount, error: dailyCountError },
    { count: monthlyCount, error: monthlyCountError },
  ] = await Promise.all([
    supabase.from('fx_daily_rates').select('*', { count: 'exact', head: true }),
    supabase.from('fx_monthly_rates').select('*', { count: 'exact', head: true }),
  ])
  if (dailyCountError) {
    failures.push(`daily count: ${dailyCountError.message}`)
  } else if (dailyCount !== dataset.dailyRates.length) {
    failures.push(`stored daily rows ${dailyCount} !== ${dataset.dailyRates.length}`)
  }
  if (monthlyCountError) {
    failures.push(`monthly count: ${monthlyCountError.message}`)
  } else if (monthlyCount !== dataset.monthlyRates.length) {
    failures.push(`stored monthly rows ${monthlyCount} !== ${dataset.monthlyRates.length}`)
  }

  const samples = dataset.dailyRates.filter((_, index) =>
    index === 0 ||
    index === dataset.dailyRates.length - 1 ||
    index % Math.max(1, Math.floor(dataset.dailyRates.length / 20)) === 0
  )

  for (const sample of samples) {
    const { data, error } = await supabase
      .from('fx_daily_rates')
      .select('rate_value,status,source,imputation_method')
      .eq('currency', sample.currency)
      .eq('rate_type', sample.rateType)
      .eq('rate_date', sample.date)
      .single()
    if (error) {
      failures.push(`${sample.currency}/${sample.rateType}/${sample.date}: ${error.message}`)
      continue
    }
    const valueMatches = numericValuesMatch(sample.value, data.rate_value)
    if (
      !valueMatches ||
      data.status !== sample.status ||
      data.source !== sample.source ||
      data.imputation_method !== sample.imputationMethod
    ) {
      failures.push(
        `${sample.currency}/${sample.rateType}/${sample.date}: mismatch ` +
        `(expected value=${describeValue(sample.value)}, status=${sample.status}, ` +
        `source=${sample.source}, method=${sample.imputationMethod}; ` +
        `actual value=${describeValue(data.rate_value)}, status=${data.status}, ` +
        `source=${data.source}, method=${data.imputation_method})`,
      )
    }
  }

  if (failures.length) {
    throw new Error(`Supabase verification failed:\n${failures.join('\n')}`)
  }

  console.log(`Verified state and ${samples.length} representative daily rows.`)
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
