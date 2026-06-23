import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const DATA_PATH = path.resolve('public/data.json')
const BATCH_SIZE = 500

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function periodMonth(year, month) {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

async function upsertBatches(client, table, rows, onConflict) {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    const { error } = await client.from(table).upsert(batch, {
      onConflict,
      ignoreDuplicates: false,
    })
    if (error) {
      throw new Error(`${table} upsert failed at row ${offset}: ${error.message}`)
    }
  }
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`${DATA_PATH} does not exist.`)
  }

  const raw = fs.readFileSync(DATA_PATH, 'utf8')
  const dataset = JSON.parse(raw)
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
  const dataVersion = crypto.createHash('sha256').update(raw).digest('hex')
  const now = new Date().toISOString()
  const { data: previousState } = await supabase
    .from('fx_dataset_state')
    .select('base_date,load_status')
    .eq('dataset_key', 'primary')
    .maybeSingle()
  const isFullSync =
    process.env.FX_FULL_SYNC === 'true' ||
    !previousState ||
    previousState.load_status !== 'ready'
  const incrementalStart = new Date(`${dataset.baseDate}T00:00:00Z`)
  incrementalStart.setUTCDate(incrementalStart.getUTCDate() - 7)
  const incrementalStartText = incrementalStart.toISOString().slice(0, 10)
  const monthlyStart = new Date(Date.UTC(
    incrementalStart.getUTCFullYear(),
    incrementalStart.getUTCMonth() - 1,
    1,
  )).toISOString().slice(0, 10)

  const allDailyRows = dataset.dailyRates.map((row) => ({
    rate_date: row.date,
    currency: row.currency,
    rate_type: row.rateType,
    rate_value: row.value,
    status: row.status,
    source: row.source,
    imputation_method: row.imputationMethod,
    updated_at: now,
  }))
  const allMonthlyRows = dataset.monthlyRates.map((row) => ({
    period_month: periodMonth(row.year, row.month),
    currency: row.currency,
    rate_type: row.rateType,
    rate_value: row.value,
    status: row.status,
    source: row.source,
    imputation_method: row.imputationMethod,
    updated_at: now,
  }))
  const dailyRows = isFullSync
    ? allDailyRows
    : allDailyRows.filter((row) => row.rate_date >= incrementalStartText)
  const monthlyRows = isFullSync
    ? allMonthlyRows
    : allMonthlyRows.filter((row) => row.period_month >= monthlyStart)

  const stateBase = {
    dataset_key: 'primary',
    base_date: dataset.baseDate,
    fetched_at: dataset.fetchedAt,
    data_version: dataVersion,
    daily_row_count: allDailyRows.length,
    monthly_row_count: allMonthlyRows.length,
    updated_at: now,
  }

  const { error: loadingError } = await supabase
    .from('fx_dataset_state')
    .upsert({ ...stateBase, load_status: 'loading', error_message: null })
  if (loadingError) {
    throw loadingError
  }

  try {
    await upsertBatches(
      supabase,
      'fx_daily_rates',
      dailyRows,
      'currency,rate_type,rate_date',
    )
    await upsertBatches(
      supabase,
      'fx_monthly_rates',
      monthlyRows,
      'currency,rate_type,period_month',
    )

    const { error: readyError } = await supabase
      .from('fx_dataset_state')
      .upsert({ ...stateBase, load_status: 'ready', error_message: null })
    if (readyError) {
      throw readyError
    }
  } catch (error) {
    await supabase.from('fx_dataset_state').upsert({
      ...stateBase,
      load_status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  console.log(
    `${isFullSync ? 'Full' : 'Incremental'} sync: ${dailyRows.length} daily and ${monthlyRows.length} monthly rows.`,
  )
  console.log(`Data version: ${dataVersion}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
