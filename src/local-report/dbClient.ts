import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let connection: Promise<SupabaseClient> | undefined
export async function getLocalDbClient() {
  if (!connection) connection = (async () => {
    const response = await fetch('/__local-db/config')
    if (!response.ok) throw new Error('로컬 DB 연결 설정을 불러오지 못했습니다.')
    const config = await response.json() as { url: string; anonKey: string }
    const url = new URL(config.url)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.port !== '56321' || url.pathname !== '/' || url.username || url.password || url.search || url.hash)
      throw new Error('격리된 로컬 DB 주소만 사용할 수 있습니다.')
    return createClient(url.origin, config.anonKey, { auth: { storageKey: 'latamfx-local-db-auth', persistSession: true, autoRefreshToken: true } })
  })().catch(error => { connection = undefined; throw error })
  return connection
}
