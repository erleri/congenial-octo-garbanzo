import { isSupabaseConfigured, supabase } from './supabaseClient'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function sendAdminLoginLink(client: SupabaseClient, email: string, origin: string, returnUrl=origin) {
  if(new URL(returnUrl).origin!==origin)throw Error('same_origin_login_return_required')
  const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: returnUrl } })
  if (error) throw error
}

export function isLocalApp() {
  return typeof __LOCAL_CURRENCY_REPORTS__ !== 'undefined' && __LOCAL_CURRENCY_REPORTS__
}

export function isAppClientConfigured() {
  return isLocalApp() || isSupabaseConfigured
}

// Plan rates, report reviews and public reports share one Auth session.
// Only local builds can import the isolated connection.
export async function getAppClient() {
  if (__LOCAL_CURRENCY_REPORTS__) {
    const { getLocalDbClient } = await import('../local-report/dbClient')
    return getLocalDbClient()
  }
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}
