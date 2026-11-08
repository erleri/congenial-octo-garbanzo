import { useEffect, useState, useSyncExternalStore } from 'react'
import { createAdminAccess } from '../lib/adminAccess'
import { getAppClient, isAppClientConfigured } from '../lib/appClient'

export function useAdminAccess() {
  const [controller] = useState(() => createAdminAccess(getAppClient))
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => {
    let active = true, unsubscribe: (() => void) | undefined
    void controller.start().then(stop => { if (active) unsubscribe = stop; else stop() })
    const resume = () => { if (document.visibilityState !== 'hidden') controller.resume() }
    const visibility = () => document.visibilityState === 'hidden' ? controller.pause() : document.hasFocus() ? resume() : undefined
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void controller.refresh() }, 30_000)
    window.addEventListener('blur', controller.pause)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      active = false; controller.stop(); unsubscribe?.(); clearInterval(timer)
      window.removeEventListener('blur', controller.pause); window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [controller])
  return { ...snapshot, configured: isAppClientConfigured(), canManage: snapshot.phase === 'active',
    login: controller.login, logout: controller.logout, recheck: controller.refresh }
}
export type AdminAccess = ReturnType<typeof useAdminAccess>
