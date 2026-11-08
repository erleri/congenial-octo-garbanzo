// Synthetic private previews only. No .env loading, auth, DB writes or SMTP.
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import {buildAdminReviewEmail} from './admin-review.js'
const directory=path.resolve('.local-reports/private/admin-review-notification-20261109/preview')
await fs.mkdir(directory,{recursive:true})
if(!process.argv.includes('--serve')) {
const server=await createServer({configFile:false,envDir:directory,define:{__LOCAL_CURRENCY_REPORTS__:'false','import.meta.env.VITE_SUPABASE_URL':'""','import.meta.env.VITE_SUPABASE_ANON_KEY':'""'},oxc:{jsx:{runtime:'automatic'}},server:{middlewareMode:true,hmr:false}})
const {ReviewRequestNotice}=await server.ssrLoadModule('/src/components/AdminReviewInbox.tsx')
const items=[
 {kind:'report',id:'91000000-0000-0000-0000-000000000001',version:'a'.repeat(64),currency:'CLP',base_date:'2026-11-09',title:'칠레 환율 리포트 검토',summary:'새 원고와 근거 대조 결과를 확인할 수 있습니다.',reason:'환율 설명과 인용 근거를 확인한 뒤 승인 또는 반려해 주세요.',target_id:'91000000-0000-0000-0000-000000000001'},
 {kind:'policy',id:'91000000-0000-0000-0000-000000000002',version:'b'.repeat(64),currency:'MXN',base_date:null,title:'새 매체의 이용 범위 검토',summary:'예시 경제신문 · /economia/',reason:'확보한 이용 조건을 확인하고 적용할 범위를 결정해 주세요.',target_id:'91000000-0000-0000-0000-000000000002'},
]
const payload=buildAdminReviewEmail(items)
await fs.writeFile(path.join(directory,'email.html'),payload.html)
await fs.writeFile(path.join(directory,'payload.json'),JSON.stringify(payload,null,2))
const style='body{margin:0;background:#f1f5f9;color:#18334d;font:15px/1.7 Arial,sans-serif}main{max-width:850px;margin:24px auto;padding:16px}h1{font-size:23px}.preview-label{padding:10px 16px;background:#fff3cd;border:1px solid #e3cf89;border-radius:6px}.review-request-notice{padding:18px;border-left:3px solid #385b7c;background:#f2f6fa;border-radius:8px;margin:16px 0}.review-request-notice p{margin:8px 0}.table-help{font-size:13px;color:#60748a}button{font:inherit;color:#254b6d;background:white;border:1px solid #cad7e2;border-radius:6px;padding:8px 12px}.card{background:white;padding:20px;border:1px solid #dce4ec;border-radius:12px;margin:20px 0}a{color:#234d75}iframe{border:0;width:100%;min-height:1120px;background:white}.links{display:flex;gap:18px;flex-wrap:wrap}'
const states=['current','changed','resolved_or_unavailable'].map(state=>`<section class="card"><h2>${({current:'현재 버전과 일치',changed:'메일 발송 후 변경',resolved_or_unavailable:'이미 처리된 항목'})[state]}</h2>${renderToStaticMarkup(React.createElement(ReviewRequestNotice,{target:items[0],state,item:items[0]}))}</section>`).join('')
await fs.writeFile(path.join(directory,'request.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LATAM FX 검토 링크 상태</title><style>${style}</style><main><p class="preview-label">합성 자료로 만든 로컬 미리보기 · 실제 원고·승인·발송 아님</p><h1>메일에서 열린 검토 항목</h1>${states}</main></html>`)
await fs.writeFile(path.join(directory,'index.html'),`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LATAM FX 관리자 알림 미리보기</title><style>${style}</style><main><p class="preview-label">합성 검토 2건 · 메일 미발송 · 운영 미반영</p><h1>관리자 검토 알림</h1><p class="links"><a href="/email.html">메일 미리보기</a><a href="/request.html">검토 링크 상태 3가지</a></p><iframe title="실제 발송 템플릿 미리보기" src="/email.html"></iframe></main></html>`)
await server.close()
}
const allowed=new Set(['index.html','email.html','request.html'])
http.createServer(async(req,res)=>{
 try{const name=new URL(req.url,'http://127.0.0.1:4184').pathname.slice(1)||'index.html';if(!allowed.has(name)){res.writeHead(404);res.end();return}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(await fs.readFile(path.join(directory,name)))}catch{res.writeHead(500);res.end()}
}).listen(4184,'127.0.0.1',()=>console.log('Synthetic review-email preview: http://127.0.0.1:4184/'))
