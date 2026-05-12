import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import { fileURLToPath } from 'node:url'
import type { ServerResponse } from 'node:http'

const mailingListPath = fileURLToPath(new URL('./data/mailing_list.json', import.meta.url))
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function sendJson(res: ServerResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

function parseMailingListPayload(rawBody: string): string[] | null {
  const parsed = JSON.parse(rawBody) as unknown

  if (!Array.isArray(parsed)) {
    return null
  }

  const normalized = parsed.map((item) => (typeof item === 'string' ? item.trim() : ''))
  if (normalized.some((email) => !emailPattern.test(email))) {
    return null
  }

  return [...new Set(normalized)]
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-mailing-list-api',
      configureServer(server) {
        server.middlewares.use('/api/mailing-list', (req, res) => {
          if (req.method === 'GET') {
            try {
              const data = fs.readFileSync(mailingListPath, 'utf-8')
              res.setHeader('Content-Type', 'application/json')
              res.end(data)
            } catch {
              sendJson(res, 404, { error: 'File not found' })
            }
          } else if (req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk.toString() })
            req.on('end', () => {
              try {
                const mailingList = parseMailingListPayload(body)
                if (!mailingList) {
                  sendJson(res, 400, { error: 'Invalid mailing list' })
                  return
                }

                fs.writeFileSync(mailingListPath, `${JSON.stringify(mailingList, null, 2)}\n`, 'utf-8')
                sendJson(res, 200, { success: true })
              } catch {
                sendJson(res, 400, { error: 'Invalid JSON' })
              }
            })
          } else {
            sendJson(res, 405, { error: 'Method not allowed' })
          }
        })
      }
    }
  ],
})
