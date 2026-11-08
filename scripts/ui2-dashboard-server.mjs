import http from 'node:http'
import fs from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import path from 'node:path'

// Loopback preview, fixed allowlist, GET/HEAD only. No env, DB or app API.
const project=path.resolve(fileURLToPath(new URL('..',import.meta.url)))
const files=new Map([
  ['/','artifacts/ui2-dashboard/index.html'],
  ['/index.html','artifacts/ui2-dashboard/index.html'],
  ['/compare.html','artifacts/ui2-dashboard/compare.html'],
  ['/comparison.css','artifacts/ui2-dashboard/comparison.css'],
  ['/preview.css','artifacts/ui2-dashboard/preview.css'],
  ['/preview.js','artifacts/ui2-dashboard/preview.js'],
  ['/snapshot.js','artifacts/ui2-dashboard/snapshot.js'],
  ['/artifacts/app-flow-approved-20261030.png','artifacts/app-flow-approved-20261030.png'],
])
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png'}
http.createServer(async(req,res)=>{
  const host=req.headers.host
  if(!['127.0.0.1:4180','localhost:4180'].includes(host)){res.writeHead(403).end();return}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return}
  const pathname=new URL(req.url,'http://127.0.0.1:4180').pathname
  const file=files.get(pathname)
  if(!file){res.writeHead(404).end('Not found');return}
  try{
    const content=await fs.readFile(path.join(project,file))
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'none'"})
    res.end(req.method==='HEAD'?undefined:content)
  }catch{res.writeHead(500).end('Preview asset unavailable')}
}).listen(4180,'127.0.0.1',()=>console.log('UI2 dashboard comparison http://127.0.0.1:4180/'))
