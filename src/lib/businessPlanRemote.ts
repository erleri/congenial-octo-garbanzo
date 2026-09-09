import type {
  BusinessPlan,
  BusinessPlanHistoryEntry,
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

interface BusinessPlanCurrentRow {
  period_month: string
  plan_type: BusinessPlanType
  currency: CurrencyCode
  rate_value: number | null
  updated_at: string
}

export interface BusinessPlanHistoryPage {
  entries: BusinessPlanHistoryEntry[]
  hasMore: boolean
  nextCursor: string | null
}

interface BusinessPlanHistoryRow {
  change_group: string
  legacy: boolean
  period_month: string
  created_at: string
  created_by_email: string | null
  plan_type: BusinessPlanType
  currency: CurrencyCode
  previous_rate_value: number | string | null
  rate_value: number | string | null
}

export interface RemoteBusinessPlanResult {
  plan: BusinessPlan
  lastUpdatedAt: string | null
  lastUpdatedBy: string | null
  lastVerifiedAt: string | null
  verificationStatus: 'verified' | 'unverified'
  verificationMessage: string | null
}

export function getBusinessPlanPeriodMonth(baseDate: string): string {
  const date = new Date(`${baseDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    return `${baseDate.slice(0, 7)}-01`
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function numberOrNull(value: number | string | null): number | null {
  if (value === null || value === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function isSchemaCompatibilityError(error: { code?: string; message?: string } | null): boolean {
  return ['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code ?? '')
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

  const currentResult = await supabase
    .from('business_plan_current')
    .select('period_month, plan_type, currency, rate_value, updated_at')
    .eq('period_month', periodMonth)
    .order('updated_at', { ascending: true })

  if (!currentResult.error) {
    const plan: BusinessPlan = { leading: {}, moving: {} }
    let lastUpdatedAt: string | null = null

    for (const row of (currentResult.data ?? []) as BusinessPlanCurrentRow[]) {
      const bucket = plan[row.plan_type]
      if (row.rate_value === null) {
        delete bucket[row.currency]
      } else {
        bucket[row.currency] = row.rate_value
      }
      if (!lastUpdatedAt || row.updated_at > lastUpdatedAt) {
        lastUpdatedAt = row.updated_at
      }
    }

    return {
      plan,
      lastUpdatedAt,
      lastUpdatedBy: null,
      lastVerifiedAt: new Date().toISOString(),
      verificationStatus: 'verified',
      verificationMessage: null,
    }
  }

  if (!isSchemaCompatibilityError(currentResult.error)) {
    throw currentResult.error
  }

  const { data, error } = await supabase
    .from('business_plan_rates')
    .select('period_month, plan_type, currency, rate_value, created_at')
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
      lastUpdatedBy = null
    }
  }

  return {
    plan,
    lastUpdatedAt,
    lastUpdatedBy,
    lastVerifiedAt: new Date().toISOString(),
    verificationStatus: 'verified',
    verificationMessage: null,
  }
}

export function buildBusinessPlanInsertRows(
  periodMonth: string,
  plan: BusinessPlan,
  userEmail: string,
  changeSetId: string,
) {
  const normalizedEmail = userEmail.toLowerCase()
  return CURRENCIES.flatMap((currency) =>
    (['leading', 'moving'] as const).map((planType) => ({
      period_month: periodMonth,
      plan_type: planType,
      currency,
      rate_value: plan[planType][currency] ?? null,
      created_by_email: normalizedEmail,
      change_set_id: changeSetId,
    })),
  )
}

export function groupBusinessPlanHistoryRows(
  rows: BusinessPlanHistoryRow[],
): BusinessPlanHistoryEntry[] {
  const groups = new Map<string, BusinessPlanHistoryEntry>()

  for (const row of rows) {
    const previousValue = numberOrNull(row.previous_rate_value)
    const nextValue = numberOrNull(row.rate_value)
    let entry = groups.get(row.change_group)
    if (!entry) {
      entry = {
        changeSetId: row.change_group,
        legacy: row.legacy,
        periodMonth: row.period_month,
        createdAt: row.created_at,
        createdBy: row.created_by_email,
        changes: [],
      }
      groups.set(row.change_group, entry)
    }

    if (previousValue !== nextValue) {
      entry.changes.push({
        currency: row.currency,
        planType: row.plan_type,
        previousValue,
        nextValue,
      })
    }
  }

  return [...groups.values()]
    .filter((entry) => entry.changes.length > 0)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function verifyBusinessPlanSave(
  plan: BusinessPlan,
  normalizedEmail: string,
  reload: () => Promise<RemoteBusinessPlanResult>,
): Promise<RemoteBusinessPlanResult> {
  try {
    return await reload()
  } catch (verificationError) {
    return {
      plan,
      lastUpdatedAt: null,
      lastUpdatedBy: normalizedEmail,
      lastVerifiedAt: null,
      verificationStatus: 'unverified',
      verificationMessage:
        verificationError instanceof Error
          ? verificationError.message
          : 'Saved rows were inserted, but the operational value could not be re-read.',
    }
  }
}

export async function loadBusinessPlanHistoryFromSupabase(
  periodMonth: string,
  before: string | null = null,
  limit = 20,
): Promise<BusinessPlanHistoryPage> {
  if (!supabase) {
    throw new Error('Supabase is not configured.')
  }

  const cursor = before ? JSON.parse(before) as { createdAt: string; changeGroup: string } : null
  const { data, error } = await supabase.rpc('get_business_plan_history', {
    p_period_month: periodMonth,
    p_before: cursor?.createdAt ?? null,
    p_before_group: cursor?.changeGroup ?? null,
    p_limit: limit,
  })

  if (error) {
    if (isSchemaCompatibilityError(error)) {
      return { entries: [], hasMore: false, nextCursor: null }
    }
    throw error
  }

  const rows = (data ?? []) as BusinessPlanHistoryRow[]
  return buildBusinessPlanHistoryPage(rows, limit)
}

export function buildBusinessPlanHistoryPage(rows: BusinessPlanHistoryRow[], limit = 20): BusinessPlanHistoryPage {
  // RPC order is the database cursor order; do not re-sort using browser collation.
  const returnedGroups = [...new Map(rows.map((row) => [row.change_group,
    { createdAt: row.created_at, changeGroup: row.change_group },
  ])).values()]
  return {
    entries: groupBusinessPlanHistoryRows(rows),
    hasMore: returnedGroups.length >= limit,
    nextCursor: returnedGroups.length ? JSON.stringify(returnedGroups.at(-1)) : null,
  }
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
  const changeSetId = globalThis.crypto.randomUUID()
  const rows = buildBusinessPlanInsertRows(periodMonth, plan, normalizedEmail, changeSetId)

  const result = await supabase.from('business_plan_rates').insert(rows)
  if (result.error) {
    if (!isSchemaCompatibilityError(result.error)) {
      throw result.error
    }
    const legacyRows = rows.map((row) => {
      const legacyRow: Omit<typeof row, 'change_set_id'> & { change_set_id?: string } = { ...row }
      delete legacyRow.change_set_id
      return legacyRow
    })
    const legacyResult = await supabase.from('business_plan_rates').insert(legacyRows)
    if (legacyResult.error) {
      throw legacyResult.error
    }
  }

  return verifyBusinessPlanSave(
    plan,
    normalizedEmail,
    () => loadBusinessPlanFromSupabase(periodMonth),
  )
}

export function canUseRemoteBusinessPlan(): boolean {
  return isSupabaseConfigured
}
