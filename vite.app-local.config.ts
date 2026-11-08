import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'
import { localDbConfig } from './scripts/currency-report/local-db.js'
import { readLocalApiHealth } from './scripts/currency-report/api-health-local.js'

// Existing app, isolated reads. No production env or report-generation middleware.
export default mergeConfig(base, defineConfig({
  envDir: false,
  envPrefix: 'LOCAL_REPORT_PUBLIC_',
  define: { __LOCAL_CURRENCY_REPORTS__: true },
  server: { host: '127.0.0.1', port: 4176, strictPort: true, fs: { deny: ['**/.env*', '**/.git/**', '**/.local-reports/**', '**/data/mailing_list.json'] } },
  plugins: [{ name: 'isolated-report-config', enforce: 'pre', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      let pathname: string
      try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname).replaceAll('\\', '/') }
      catch { res.statusCode = 400; res.end(); return }
      if (/\/(?:\.env[^/]*|\.git|\.local-reports)(?:\/|$)/i.test(pathname) || pathname.endsWith('/data/mailing_list.json') || pathname === '/api/mailing-list') {
        res.statusCode = 403; res.end('Forbidden'); return
      }
      if (pathname.startsWith('/__report') || pathname.startsWith('/__evidence-review')) { res.statusCode = 404; res.end(); return }
      next()
    })
    server.middlewares.use('/__local-api/status', async (req, res) => {
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
      res.setHeader('X-Content-Type-Options','nosniff')
      if(req.method!=='GET'){res.statusCode=405;res.end('{}');return}
      const host=req.headers.host??'',origin=req.headers.origin,remote=req.socket.remoteAddress
      if(!/^(?:127\.0\.0\.1|localhost):4176$/.test(host)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote??'')
        ||origin&&origin!==`http://${host}`||req.headers['sec-fetch-site']==='cross-site') {res.statusCode=403;res.end('{}');return}
      try{res.end(JSON.stringify(await readLocalApiHealth()))}catch{res.statusCode=503;res.end('{"error":"local_check_records_unavailable"}')}
    })
    server.middlewares.use('/__local-db/config', async (req, res) => {
      res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store')
      if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return }
      try { res.end(JSON.stringify(await localDbConfig())) } catch { res.statusCode = 503; res.end('{"error":"local_db_unavailable"}') }
    })
  } }],
  build: { outDir: 'dist-app-local' },
}))
