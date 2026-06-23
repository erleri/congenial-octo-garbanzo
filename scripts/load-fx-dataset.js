import fs from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const DATA_PATH = path.resolve('public/data.json')

function normalizeDaily(row) {
  const date = String(row.date ?? row.rate_date)
  const [year, month, day] = date.split('-').map(Number)
  const rawValue = row.value ?? row.rate_value
  return {
    currency: row.currency,
    year,
    month,
    day,
    date,
    rateType: row.rateType ?? row.rate_type,
    value: rawValue === null || rawValue === undefined ? null : Number(rawValue),
    status: row.status,
    source: row.source,
    imputationMethod: row.imputationMethod ?? row.imputation_method,
  }
}

function normalizeMonthly(row) {
  const period = String(row.periodMonth ?? row.period_month)
  const [year, month] = period.split('-').map(Number)
  const rawValue = row.value ?? row.rate_value
  return {
    currency: row.currency,
    year,
    month,
    rateType: row.rateType ?? row.rate_type,
    value: rawValue === null || rawValue === undefined ? null : Number(rawValue),
    status: row.status,
    source: row.source,
    imputationMethod: row.imputationMethod ?? row.imputation_method,
  }
}

async function loadJsonDataset() {
  return JSON.parse(await fs.readFile(DATA_PATH, 'utf8'))
}

async function loadSupabaseDashboardDataset() {
  const url = process.env.VITE_SUPABASE_URL?.trim()
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY
  )?.trim()
  if (!url || !key) {
    throw new Error('Supabase email data source is not configured.')
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const { data, error } = await supabase.rpc('get_fx_dashboard')
  if (error) {
    throw error
  }
  if (!data?.baseDate) {
    throw new Error('Supabase dashboard dataset is empty.')
  }
  return {
    baseDate: data.baseDate,
    fetchedAt: data.fetchedAt,
    dailyRates: (data.dailyRates ?? []).map(normalizeDaily),
    monthlyRates: (data.monthlyRates ?? []).map(normalizeMonthly),
    movingComparison: [],
  }
}

export async function loadOperationalFxDataset() {
  const mode = (
    process.env.FX_EMAIL_DATA_SOURCE ??
    process.env.VITE_FX_DATA_SOURCE ??
    'auto'
  ).trim().toLowerCase()

  if (mode !== 'json') {
    try {
      return await loadSupabaseDashboardDataset()
    } catch (error) {
      if (mode === 'supabase') {
        throw error
      }
      console.warn(
        `Supabase FX data is unavailable; using public/data.json. ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }

  return loadJsonDataset()
}
