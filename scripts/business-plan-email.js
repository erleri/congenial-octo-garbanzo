import { createClient } from '@supabase/supabase-js'

const CURRENCIES = ['ARS', 'BRL', 'CLP', 'COP', 'GTQ', 'MXN', 'PYG', 'PEN', 'CNY', 'UYU', 'USD']
const EMPTY_BUSINESS_PLAN = { leading: {}, moving: {} }

function getBusinessPlanPeriodMonth(baseDate) {
  const date = new Date(`${baseDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return `${String(baseDate).slice(0, 7)}-01`
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function createEmptyBusinessPlan() {
  return {
    leading: {},
    moving: {},
  }
}

export async function loadBusinessPlanForEmail(dataset) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL?.trim()
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim()

  if (!dataset?.baseDate || !supabaseUrl || !supabaseAnonKey) {
    return createEmptyBusinessPlan()
  }

  const periodMonth = getBusinessPlanPeriodMonth(dataset.baseDate)
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })

  try {
    const { data, error } = await supabase
      .from('business_plan_rates')
      .select('period_month, plan_type, currency, rate_value, created_at')
      .eq('period_month', periodMonth)
      .order('created_at', { ascending: true })

    if (error) {
      throw error
    }

    const plan = createEmptyBusinessPlan()

    for (const row of data ?? []) {
      if (!['leading', 'moving'].includes(row.plan_type) || !CURRENCIES.includes(row.currency)) {
        continue
      }

      const rateValue =
        typeof row.rate_value === 'number'
          ? row.rate_value
          : typeof row.rate_value === 'string'
            ? Number(row.rate_value)
            : null
      const bucket = plan[row.plan_type]
      if (typeof rateValue === 'number' && Number.isFinite(rateValue)) {
        bucket[row.currency] = rateValue
      } else {
        delete bucket[row.currency]
      }
    }

    return plan
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Business plan rates were not loaded for email; continuing without Moving vs values. ${message}`)
    return EMPTY_BUSINESS_PLAN
  }
}
