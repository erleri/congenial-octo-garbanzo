import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Local-only Node module. It is never imported into a browser bundle.
import { evidenceReviewSummary, fixtureReports, localEvidenceReviews, localReports, summary } from './scripts/currency-report/storage.js'
import fs from 'node:fs/promises'
import { localDbConfig } from './scripts/currency-report/local-db.js'
import { rawSheetAssetsPlugin } from './scripts/raw-sheet-assets.js'

export default defineConfig({
  define: { __LOCAL_CURRENCY_REPORTS__: true },
  envDir: false,
  envPrefix: 'LOCAL_REPORT_PUBLIC_',
  plugins: [react(), rawSheetAssetsPlugin(), {
    name: 'local-report-read-only',
    configureServer(server) {
      server.middlewares.use('/__local-db/config', async (req,res)=>{
        res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store')
        if(req.method!=='GET'){res.statusCode=405;res.end('{}');return}
        try {res.end(JSON.stringify(await localDbConfig()))} catch {res.statusCode=503;res.end('{"error":"local_db_unavailable"}')}
      })
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        let pathname: string
        try { pathname = decodeURIComponent(url.pathname).replaceAll('\\', '/') } catch { res.statusCode = 400; res.end(); return }
        if (/\/(?:\.env[^/]*|\.git|\.local-reports\/private)(?:\/|$)/i.test(pathname) || pathname.endsWith('/data/mailing_list.json')) {
          res.statusCode = 403; res.end('Forbidden'); return
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
          res.statusCode = 302; res.setHeader('Location', '/local-experience.html' + url.search); res.end(); return
        }
        next()
      })
      server.middlewares.use('/__report', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return }
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          if (url.pathname === '/generation-status') {
            try { res.end(await fs.readFile('.local-reports/reviewable/generation-status.json', 'utf8')) }
            catch { res.statusCode = 404; res.end('{"error":"not_found"}') }
            return
          }
          if (url.pathname === '/official-calendar') {
            try { res.end(await fs.readFile('.local-reports/reviewable/official-calendar.json', 'utf8')) }
            catch { res.statusCode = 404; res.end('{"error":"not_found"}') }
            return
          }
          if (['/comparison', '/editorial-comparison', '/explanation-comparison', '/rules-comparison'].includes(url.pathname)) {
            const file = url.pathname === '/rules-comparison' ? 'clp-rules-comparison.json' : url.pathname === '/comparison' ? 'clp-comparison.json' : url.pathname === '/editorial-comparison' ? 'clp-editorial-comparison.json' : 'clp-explanation-comparison.json'
            try { res.end(await fs.readFile(`.local-reports/reviewable/${file}`, 'utf8')) }
            catch { res.statusCode = 404; res.end('{"error":"not_found"}') }
            return
          }
          if (url.pathname === '/data') {
            try { res.end(await fs.readFile('.local-reports/reviewable/market-data.json', 'utf8')) }
            catch { res.end(await fs.readFile('public/data.json', 'utf8')) }
            return
          }
          const reports = url.searchParams.get('mode') === 'live-local' ? await localReports() : await fixtureReports()
          if (url.pathname === '/index') { res.end(JSON.stringify(reports.map(summary))); return }
          const id = url.pathname.slice(1)
          const report = reports.find((r: { id: string }) => r.id === id)
          res.statusCode = report ? 200 : 404
          res.end(JSON.stringify(report ?? { error: 'not_found' }))
        } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'local_data_unavailable' })) }
      })
      server.middlewares.use('/__evidence-review', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        if (req.method !== 'GET') { res.statusCode = 405; res.end('{}'); return }
        try {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1')
          const reviews = await localEvidenceReviews()
          if (url.pathname === '/index') { res.end(JSON.stringify(reviews.map(evidenceReviewSummary))); return }
          const id = url.pathname.slice(1)
          const review = /^(BRL|MXN|CLP)-\d{4}-\d{2}-\d{2}$/.test(id) ? reviews.find(item => item.id === id) : null
          res.statusCode = review ? 200 : 404
          res.end(JSON.stringify(review ?? { error: 'not_found' }))
        } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'local_review_unavailable' })) }
      })
    },
  }],
  server: { host: '127.0.0.1', port: 4175, strictPort: true, open: false, fs: { deny: ['**/.env*', '**/.git/**', '**/.local-reports/private/**', '**/data/mailing_list.json'] } },
  build: { outDir: 'dist-report-ui', rollupOptions: { input: 'local-experience.html' } },
})
