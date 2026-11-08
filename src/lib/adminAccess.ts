import type { SupabaseClient } from '@supabase/supabase-js'
import { withConnectionDeadline } from './reports/connection-deadline'
import { sendAdminLoginLink } from './appClient'

export type AdminPhase = 'checking' | 'signed_out' | 'active' | 'denied' | 'unavailable' | 'paused'
export interface AdminSnapshot {
  phase: AdminPhase
  email: string | null
  revision: number
}

// The UI cache is never an authorization boundary: table RLS and review/save
// operations still check current active membership on the server.
export function createAdminAccess(getClient: () => Promise<SupabaseClient>) {
  let snapshot: AdminSnapshot = { phase: 'checking', email: null, revision: 0 }
  let epoch = 0, lifecycle = 0, attended = true, stopped = false, signingOut = false, blocked = false
  const listeners = new Set<() => void>()
  const publish = (phase: AdminPhase, email: string | null = snapshot.email, invalidate = false) => {
    if (!invalidate && snapshot.phase === phase && snapshot.email === email) return
    snapshot = { phase, email, revision: snapshot.revision + 1 }
    listeners.forEach(listener => listener())
  }
  const pause = () => { attended = false; ++epoch; publish('paused', snapshot.email, true) }
  const refresh = async () => {
    if (stopped || !attended || blocked || signingOut) return
    const version = ++epoch
    try {
      const result = await withConnectionDeadline(async signal => {
        const client = await getClient()
        const { data, error } = await client.auth.getSession()
        if (error) throw error
        const email = data.session?.user.email?.toLowerCase() ?? null
        if (!email) return { phase: 'signed_out' as const, email: null }
        const role = await client.from('business_plan_admins').select('active')
          .eq('email', email).abortSignal(signal).maybeSingle()
        if (role.error) throw role.error
        return { phase: role.data?.active === true ? 'active' as const : 'denied' as const, email }
      }, 5000)
      if (!stopped && attended && epoch === version) publish(result.phase, result.email)
    } catch {
      if (!stopped && epoch === version) publish('unavailable')
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    async start() {
      stopped = false
      const startup = ++lifecycle
      try {
        const client = await getClient()
        if (stopped || startup !== lifecycle) return () => {}
        const { data } = client.auth.onAuthStateChange((event, session) => {
          ++epoch
          // Do not run another Auth call inside the Auth callback lock.
          if (event === 'SIGNED_OUT') publish('signed_out', null, true)
          else if (!signingOut && !blocked) {
            publish(attended ? 'checking' : 'paused', session?.user.email?.toLowerCase() ?? null, true)
            queueMicrotask(() => { void refresh() })
          }
        })
        void refresh()
        return () => data.subscription.unsubscribe()
      } catch {
        if (!stopped) publish('unavailable')
        return () => {}
      }
    },
    stop() { stopped = true; ++epoch; ++lifecycle },
    pause,
    resume() { attended = true; if (!blocked) { publish('checking'); void refresh() } },
    refresh,
    async login(email: string) {
      const client = await getClient()
      await sendAdminLoginLink(client, email, window.location.origin)
      // Sending a link alone is not a new login. If sign-out failed, keep the
      // old session hidden until the verification link reloads the application.
    },
    async logout() {
      signingOut = true; blocked = true; ++epoch
      publish('signed_out', null, true)
      try {
        const { error } = await (await getClient()).auth.signOut()
        if (error) throw error
        blocked = false
      } catch {
        publish('unavailable', null)
        throw new Error('로그아웃을 확인하지 못했습니다. 관리 자료는 숨겼습니다. 다시 로그인해 주세요.')
      } finally { signingOut = false }
    },
  }
}
