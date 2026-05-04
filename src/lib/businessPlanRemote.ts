import type {
  BusinessPlan,
  BusinessPlanType,
  CurrencyCode,
} from '../types/exchangeRate'
import { CURRENCIES } from '../types/exchangeRate'
import { isSupabaseConfigured, supabase } from './supabaseClient'

interface BusinessPlanRateRow {
  period_month: string
  plan_type: BusinessPlanType
  currency: CurrencyCode
  rate_value: number | null
  created_by_email: string | null
  created_at: string
}

export interface RemoteBusinessPlanResult {
  plan: BusinessPlan
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
}

export function getBusinessPlanPeriodMonth(baseDate: string): string {
  const date = new Date(`${baseDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return `${baseDate.slice(0, 7)}-01`
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

export async function requestBusinessPlanLogin(email: string): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  })

  if (error) {
    throw error
  }
}

export async function signOutBusinessPlanUser(): Promise<void> {
  if (!supabase) {
    return
  }

  const { error } = await supabase.auth.signOut()
  if (error) {
    throw error
  }
}

export async function loadBusinessPlanFromSupabase(
  periodMonth: string,
): Promise<RemoteBusinessPlanResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const { data, error } = await supabase
    .from('business_plan_rates')
    .select('period_month, plan_type, currency, rate_value, created_by_email, created_at')
    .eq('period_month', periodMonth)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  const plan: BusinessPlan = { leading: {}, moving: {} }
  let lastUpdatedAt: string | null = null
  let lastUpdatedBy: string | null = null

  for (const row of (data ?? []) as BusinessPlanRateRow[]) {
    const bucket = plan[row.plan_type]
    if (row.rate_value === null) {
      delete bucket[row.currency]
    } else {
      bucket[row.currency] = row.rate_value
    }

    if (!lastUpdatedAt || row.created_at > lastUpdatedAt) {
      lastUpdatedAt = row.created_at
      lastUpdatedBy = row.created_by_email
    }
  }

  return { plan, lastUpdatedAt, lastUpdatedBy }
}

export async function loadBusinessPlanAdminAccess(email: string | null): Promise<boolean> {
  if (!supabase || !email) {
    return false
  }

  const { data, error } = await supabase
    .from('business_plan_admins')
    .select('email')
    .eq('email', email.toLowerCase())
    .eq('active', true)
    .maybeSingle()

  if (error) {
    throw error
  }

  return Boolean(data)
}

export async function saveBusinessPlanToSupabase(
  periodMonth: string,
  plan: BusinessPlan,
  userEmail: string,
): Promise<RemoteBusinessPlanResult> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const normalizedEmail = userEmail.toLowerCase()
  const rows = CURRENCIES.flatMap((currency) =>
    (['leading', 'moving'] as const).map((planType) => ({
      period_month: periodMonth,
      plan_type: planType,
      currency,
      rate_value: plan[planType][currency] ?? null,
      created_by_email: normalizedEmail,
    })),
  )

  const { error } = await supabase.from('business_plan_rates').insert(rows)
  if (error) {
    throw error
  }

  return {
    plan,
    lastUpdatedAt: new Date().toISOString(),
    lastUpdatedBy: normalizedEmail,
  }
}

export function canUseRemoteBusinessPlan(): boolean {
  return isSupabaseConfigured
}
