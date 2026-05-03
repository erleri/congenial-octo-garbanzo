import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'local-mailing-list-api',
      configureServer(server) {
        server.middlewares.use('/api/mailing-list', (req, res, next) => {
          const filePath = path.resolve(__dirname, 'data/mailing_list.json')
          
          if (req.method === 'GET') {
            try {
              const data = fs.readFileSync(filePath, 'utf-8')
              res.setHeader('Content-Type', 'application/json')
              res.end(data)
            } catch {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'File not found' }))
            }
          } else if (req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk.toString() })
            req.on('end', () => {
              try {
                JSON.parse(body) // Validate JSON
                fs.writeFileSync(filePath, body, 'utf-8')
                res.statusCode = 200
                res.end(JSON.stringify({ success: true }))
              } catch {
                res.statusCode = 400
                res.end(JSON.stringify({ error: 'Invalid JSON' }))
              }
            })
          } else {
            next()
          }
        })
      }
    }
  ],
})
