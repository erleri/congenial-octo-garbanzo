import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAdminAccess } from '../adminAccess'

function fixture() {
  let email: string | null = 'ADMIN@example.test'
  let active = true
  let roleReply: (() => Promise<{ data: { active: boolean } | null; error: unknown }>) | undefined
  let authEvent: (event: string, session: unknown) => void = () => {}
  const signInWithOtp = vi.fn(async () => ({ error: null }))
  const signOut = vi.fn(async () => { email = null; authEvent('SIGNED_OUT', null); return { error: null } })
  const unsubscribe = vi.fn()
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: email ? { user: { email } } : null }, error: null })),
      signInWithOtp, signOut,
      onAuthStateChange: vi.fn(callback => { authEvent = callback; return { data: { subscription: { unsubscribe } } } }),
    },
    from: vi.fn(() => {
      const query = { select: () => query, eq: () => query, abortSignal: () => query,
        maybeSingle: () => roleReply ? roleReply() : Promise.resolve({ data: { active }, error: null }) }
      return query
    }),
  }
  const controller = createAdminAccess(async () => client as unknown as SupabaseClient)
  return { controller, client, unsubscribe, setActive: (value: boolean) => { active = value },
    setEmail: (value: string | null) => { email = value },
    deferRole: (reply: typeof roleReply) => { roleReply = reply },
    emit: (event: string) => authEvent(event, email ? { user: { email } } : null) }
}
afterEach(() => vi.useRealTimers())

describe('one administrator session for reports and plan history', () => {
  it('keeps the exact review request through the shared email-link login',async()=>{
    const f=fixture(),search='?review=report%3A91000000-0000-0000-0000-000000000001&reviewVersion='+'a'.repeat(64)
    vi.stubGlobal('window',{location:{origin:'https://latamforex.netlify.app',href:'https://latamforex.netlify.app/'+search+'#admin'}})
    await f.controller.login('admin@example.test')
    expect(f.client.auth.signInWithOtp).toHaveBeenCalledWith({email:'admin@example.test',options:{emailRedirectTo:'https://latamforex.netlify.app/'+search+'#admin'}})
  })
  it('uses the existing email-link method and the same origin, without a password request', async () => {
    const f = fixture()
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:4176' } })
    await f.controller.login(' admin@example.test ')
    expect(f.client.auth.signInWithOtp).toHaveBeenCalledExactlyOnceWith({ email: 'admin@example.test', options: { emailRedirectTo: 'http://127.0.0.1:4176' } })
    expect(f.client.auth.signOut).not.toHaveBeenCalled()
  })

  it('distinguishes no session, inactive membership, active membership and lookup failure', async () => {
    const f = fixture()
    f.setEmail(null); await f.controller.refresh()
    expect(f.controller.getSnapshot().phase).toBe('signed_out')
    expect(f.client.from).not.toHaveBeenCalled()
    f.setEmail('admin@example.test'); f.setActive(false); await f.controller.refresh()
    expect(f.controller.getSnapshot().phase).toBe('denied')
    f.setActive(true); await f.controller.refresh()
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'active', email: 'admin@example.test' })
    f.deferRole(async () => { throw Error('network') }); await f.controller.refresh()
    expect(f.controller.getSnapshot().phase).toBe('unavailable')
  })

  it('clears shared access before sign-out completes and ignores a late privileged response', async () => {
    const f = fixture(); await f.controller.refresh()
    let resolveRole!: (value: { data: { active: boolean }; error: null }) => void
    f.deferRole(() => new Promise(resolve => { resolveRole = resolve }))
    const pending = f.controller.refresh()
    await vi.waitFor(() => expect(resolveRole).toBeTypeOf('function'))
    const logout = f.controller.logout()
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'signed_out', email: null })
    resolveRole({ data: { active: true }, error: null })
    await Promise.all([pending, logout])
    expect(f.controller.getSnapshot().phase).toBe('signed_out')
  })

  it('revalidates membership after focus and cannot restore access from a paused request', async () => {
    const f = fixture(); await f.controller.refresh()
    f.controller.pause()
    expect(f.controller.getSnapshot().phase).toBe('paused')
    f.setActive(false); f.controller.resume()
    await vi.waitFor(() => expect(f.controller.getSnapshot().phase).toBe('denied'))
  })

  it('rejects a hanging membership check and hides both admin areas', async () => {
    vi.useFakeTimers()
    const f = fixture(); await f.controller.refresh()
    f.deferRole(() => new Promise(() => {}))
    const pending = f.controller.refresh()
    await vi.advanceTimersByTimeAsync(5001); await pending
    expect(f.controller.getSnapshot().phase).toBe('unavailable')
  })

  it('shares cross-tab auth invalidation and unsubscribes without restoring a stale session', async () => {
    const f = fixture(); const stop = await f.controller.start()
    await vi.waitFor(() => expect(f.controller.getSnapshot().phase).toBe('active'))
    f.setEmail(null); f.emit('SIGNED_OUT')
    expect(f.controller.getSnapshot().phase).toBe('signed_out')
    f.controller.stop(); stop()
    expect(f.unsubscribe).toHaveBeenCalledTimes(1)
    await f.controller.refresh()
    expect(f.controller.getSnapshot().phase).toBe('signed_out')
  })

  it('keeps failed sign-out blocked despite a background token refresh', async () => {
    const f = fixture(); const stop = await f.controller.start()
    await vi.waitFor(() => expect(f.controller.getSnapshot().phase).toBe('active'))
    f.client.auth.signOut.mockRejectedValueOnce(Error('offline'))
    await expect(f.controller.logout()).rejects.toThrow('관리 자료는 숨겼습니다')
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:4176' } })
    await f.controller.login('admin@example.test')
    f.emit('TOKEN_REFRESHED'); await f.controller.refresh()
    expect(f.controller.getSnapshot().phase).toBe('unavailable')
    f.controller.stop(); stop()
  })
})
