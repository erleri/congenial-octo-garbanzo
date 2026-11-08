import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { composeEmailBody, wrapPreviewDocument, MAJOR_CURRENCIES } from './email-template.js'

const { values } = parseArgs({ options: {
  dataset: { type: 'string' }, reports: { type: 'string' }, reasons: { type: 'string' }, serve: { type: 'boolean' },
} })
const root = process.cwd()
const destination = path.join(root, 'artifacts/email2-preview-20261103')
const privateDir = path.join(root, '.local-reports/private/email2-preview-20261103')
const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

async function generate() {
  if (!values.dataset || !values.reports) throw Error('explicit_saved_dataset_and_reports_required')
  const [datasetBytes, reportBytes] = await Promise.all([
    fs.readFile(values.dataset), fs.readFile(values.reports),
  ])
  const dataset = JSON.parse(datasetBytes)
  const saved = JSON.parse(reportBytes)
  const reasonRows = values.reasons ? JSON.parse(await fs.readFile(values.reasons,'utf8')) : []
  if (!Array.isArray(reasonRows) || new Set(reasonRows.map(r=>r.reportId)).size !== reasonRows.length
    || reasonRows.some(r=>!saved.some(s=>s.id===r.reportId && s.currency===r.currency))) throw Error('saved_publication_reason_mismatch')
  if (saved.length !== 6 || new Set(saved.map(r=>r.currency)).size !== 6
    || saved.some(r=>!MAJOR_CURRENCIES.includes(r.currency) || r.baseDate !== dataset.baseDate
      || !r.content?.title || !r.content?.summary)) throw Error('six_matching_saved_reports_required')
  const segmenter = new Intl.Segmenter('ko', { granularity: 'sentence' })
  const reports = MAJOR_CURRENCIES.map(currency => {
    const r = saved.find(item=>item.currency===currency)
    const sentences = [...segmenter.segment(r.content.summary)].map(s=>s.segment.trim()).filter(Boolean)
    return { currency, baseDate:r.baseDate, title:r.content.title,
      summary:r.content.summary, shortSummary:sentences.at(-1) ?? '',
      // A static local detail preserves the exact saved version; no live app lookup.
      href:`reports/${currency}.html`, reportId:r.id,
      publicationReason:reasonRows.find(reason=>reason.reportId===r.id)?.reason ?? null }
  })
  await fs.mkdir(path.join(destination, 'reports'), { recursive: true })
  await fs.mkdir(path.join(privateDir, 'data'), { recursive: true })
  // Reuse the actual chart generator in an isolated working directory, forcing
  // JSON-only data. It neither reads environment files nor queries the database.
  await fs.writeFile(path.join(privateDir, 'data/fx-full-history.json'), datasetBytes)
  execFileSync(process.execPath, [path.join(root,'scripts/create-email-chart.js')], {
    cwd:privateDir, env:{...process.env, FX_EMAIL_DATA_SOURCE:'json'}, timeout:90000, stdio:'pipe',
  })
  await fs.copyFile(path.join(privateDir,'email-chart.png'), path.join(destination,'email-chart.png'))
  const scenarios = [{ id:'none',label:'새 리포트 없음',count:0 }, { id:'one',label:'새 리포트 1건',count:1 }, { id:'six',label:'새 리포트 6건',count:6 }]
  const index = []
  for (const scenario of scenarios) {
    const digest = scenario.count === 1 ? reports.filter(r=>r.currency==='MXN') : reports.slice(0,scenario.count)
    const {subject,html} = composeEmailBody({dataset, chartSrc:'email-chart.png', reportDigest:digest})
    const document = wrapPreviewDocument(subject,html)
      .replace('<meta charset="utf-8">','<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">')
      .replace('.preview-shell { max-width: 900px; margin: 0 auto; padding: 28px 14px; }', '.preview-shell { max-width: 710px; margin: 0 auto; padding: 20px 14px; }')
      .replace('</style>','@media(max-width:620px){.preview-shell{padding:0}.email-frame{padding:20px 18px;border:0;box-shadow:none}body{background:#fff}}\n</style>')
    await fs.writeFile(path.join(destination,`${scenario.id}.html`),document)
    index.push({...scenario, htmlBytes:Buffer.byteLength(document), reportIds:digest.map(r=>r.reportId)})
  }
  // Saved public content only: no original article text, review/cost records or credentials.
  for (const report of saved) {
    const c = report.content
    // Read field names used by the public CurrencyReport, with old aliases retained.
    const groups = [
      ['왜 움직였나',c.drivers ?? c.background ?? []],
      ['영업 환경',c.implications ?? c.businessImplications ?? []],
      ['앞으로 확인할 변수',c.watch ?? c.watchItems ?? []],
    ]
    const detail = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(c.title)}</title>
    <style>body{margin:0;background:#edf1f6;color:#1d3049;font:16px/1.8 Arial,'Malgun Gothic',sans-serif}main{max-width:700px;margin:24px auto;background:#fff;padding:32px;border-radius:12px}h1{font-size:28px;line-height:1.5}h2{font-size:20px;margin-top:28px}h3{font-size:16px;margin-bottom:4px}p{margin:8px 0}a{color:#24598c;overflow-wrap:anywhere}small{color:#667085}@media(max-width:620px){main{margin:0;padding:24px 20px;border-radius:0}h1{font-size:24px}}</style>
    <main><a href="../index.html" target="_top">← 메일 비교로 돌아가기</a><p><small>저장된 로컬 승인본 · ${escape(report.currency)} · 기준 ${escape(report.baseDate)}<br>운영 게시본이 아닌 메일 시안의 연결 확인용입니다.</small></p>
    <h1>${escape(c.title)}</h1><p>${escape(c.summary)}</p>
    ${groups.map(([label,items])=>Array.isArray(items)&&items.length?`<h2>${label}</h2>${items.map(item=>`<h3>${escape(item.title??'')}</h3><p>${escape(item.text??'')}</p>`).join('')}`:'').join('')}
    <h2>출처</h2>${report.sources.map(s=>`<p><a href="${escape(s.url)}">${escape(s.publisher)} · ${escape(s.title)}</a><br><small>${escape(s.publishedAt??'')} · ${escape(s.period??'')}</small></p>`).join('')}
    </main></html>`
    await fs.writeFile(path.join(destination,'reports',`${report.currency}.html`),detail)
  }
  const gallery = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LATAM FX · 이메일 2.0 비교</title><link rel="stylesheet" href="preview.css"></head><body>
    <header><div><p class="eyebrow">LATAM FX · EMAIL 2.0</p><h1>메일에서 핵심을 읽고, 앱에서 자세히.</h1><p class="intro">기존 환율 카드와 차트에 새 리포트를 연결한 시안입니다.</p></div><span class="preview-label">로컬 시안 · 발송 안 함</span></header>
    <nav aria-label="메일 시안 선택"><div class="controls"><button data-case="none">새 리포트 없음</button><button data-case="one">새 리포트 1건</button><button data-case="six">새 리포트 6건</button></div><div class="controls"><button data-device="desktop">PC</button><button data-device="mobile">휴대폰 390px</button></div></nav>
    <div class="context"><p id="explanation"></p><p id="metrics"></p><p>저장된 2026-11-02 환율·리포트를 재사용했습니다. ‘새 리포트’ 건수는 배치 비교를 위한 가정입니다. 6건 요약은 기존 요약의 마지막 문장 발췌이며 새로 승인된 메일 소개문이 아닙니다.</p></div>
    <main><div class="mail-window"><div class="mail-header"><span class="avatar">FX</span><div><strong>LATAM FX Admin</strong><p id="subject"></p></div><a id="standalone" href="one.html" target="_blank" rel="noopener">메일만 열기 ↗</a></div><iframe title="이메일 본문 미리보기" src="one.html"></iframe></div></main>
    <footer>앱 버튼은 기존 운영 사이트로 연결됩니다. 통화별 ‘리포트 읽기’는 동일 저장 판본의 로컬 설명 화면으로 연결됩니다.<br>환율 숫자·월평균·52주 범위·차트는 기존 메일 계산과 렌더링을 사용합니다. 실제 Gmail·Outlook 수신 시험은 아직 하지 않았습니다.</footer>
    <script src="preview.js"></script></body></html>`
  await fs.writeFile(path.join(destination,'index.html'),gallery)
  await fs.writeFile(path.join(destination,'preview.css'),`*{box-sizing:border-box}body{margin:0;background:#edf1f6;color:#182c48;font:14px/1.65 Arial,'Malgun Gothic',sans-serif}header,nav,.context,footer{max-width:1080px;margin:auto}header{padding:30px 24px 20px;display:flex;justify-content:space-between;gap:24px}.eyebrow{font-size:11px;letter-spacing:2px;color:#476487;font-weight:700;margin:0}h1{font-size:28px;letter-spacing:-1px;line-height:1.5;margin:6px 0}.intro{margin:0;color:#5e6b7e}.preview-label{white-space:nowrap;align-self:flex-start;background:#dfe8f2;color:#35587c;padding:5px 10px;border-radius:20px;font-size:12px}nav{padding:0 24px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.controls{display:flex;gap:6px}button{font:inherit;background:#fff;border:1px solid #cbd5e2;border-radius:7px;color:#455975;padding:9px 14px;cursor:pointer}button[aria-pressed=true]{background:#203d62;border-color:#203d62;color:#fff}button:focus-visible,a:focus-visible{outline:3px solid #619bd2;outline-offset:3px}.context{padding:12px 24px;color:#627086;font-size:12px}.context p{margin:3px 0}#explanation{font-size:14px;color:#253e5e;font-weight:600}main{padding:8px 20px 28px}.mail-window{width:760px;max-width:100%;margin:auto;border:1px solid #d6dfea;box-shadow:0 8px 28px #18334f0d;background:white;border-radius:10px;overflow:hidden;transition:width .15s}.mail-header{padding:15px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #e3e8ef;background:#fff}.avatar{display:grid;place-items:center;width:36px;height:36px;flex-shrink:0;background:#e5edf6;color:#294c75;border-radius:50%;font-size:12px;font-weight:700}.mail-header strong{font-size:13px}.mail-header p{margin:0;font-size:11px;color:#6a788c}.mail-header a{margin-left:auto;font-size:11px;color:#45648a;white-space:nowrap}iframe{display:block;width:100%;height:1100px;border:0;background:#fff}body[data-device=mobile] .mail-window{width:390px}footer{padding:0 24px 28px;color:#66758a;font-size:12px}@media(max-width:650px){header{display:block;padding:22px 16px 16px}h1{font-size:23px}.preview-label{display:inline-block;margin-top:12px}nav,.context{padding-left:16px;padding-right:16px}button{padding:8px 10px;font-size:12px}main{padding:8px 0 20px}.mail-window{border-radius:0}.mail-header{padding:12px}.mail-header a{font-size:10px}footer{padding:0 16px 24px}}`)
  await fs.writeFile(path.join(destination,'preview.js'),`const params=new URLSearchParams(location.search);let selected=['none','one','six'].includes(params.get('case'))?params.get('case'):'one';let device=params.get('device')==='mobile'?'mobile':'desktop';const frame=document.querySelector('iframe');const text={none:'새 리포트가 없으면 기존 환율 정보가 바로 이어집니다.',one:'1건일 때는 제목과 기존 요약 전체를 읽을 수 있습니다.',six:'6건일 때는 모든 통화를 같은 형식으로 보여주고, 요약은 기존 요약의 마지막 한 문장만 표시합니다.'};function resize(){try{const d=frame.contentDocument;frame.style.height='1px';frame.style.height=(d.documentElement.scrollHeight+4)+'px';const section=d.querySelector('[data-email-section=reports]');document.querySelector('#metrics').textContent='메일 너비 '+d.documentElement.clientWidth+'px · 리포트 영역 '+Math.round(section?.getBoundingClientRect().height??0)+'px · 전체 본문 '+d.documentElement.scrollHeight+'px'}catch{frame.style.height='1400px'}}function render(){document.body.dataset.device=device;document.querySelectorAll('[data-case]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.case===selected)));document.querySelectorAll('[data-device]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.device===device)));document.querySelector('#explanation').textContent=text[selected];document.querySelector('#subject').textContent='[LATAM FX] ${dataset.baseDate} Daily FX Brief';document.querySelector('#standalone').href=selected+'.html';if(frame.getAttribute('src')!==selected+'.html')frame.src=selected+'.html';history.replaceState(null,'','?case='+selected+'&device='+device);setTimeout(resize,200)}document.querySelectorAll('[data-case]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.case;render()}));document.querySelectorAll('[data-device]').forEach(b=>b.addEventListener('click',()=>{device=b.dataset.device;render()}));frame.addEventListener('load',resize);window.addEventListener('resize',resize);render();`)
  const manifest = {version:'email2-local-demo/1',baseDate:dataset.baseDate,
    datasetHash:hash(datasetBytes),savedReportsHash:hash(reportBytes),scenarios:index,
    summaryMethod:'original summary; last complete sentence when more than two reports (demo only, not automatic production selection)',
    deliverySelection:'simulated, not connected',source:'saved locally approved reports',
    publicationReasons:reports.map(r=>({reportId:r.reportId,currency:r.currency,reason:r.publicationReason})),
    modelCalls:0,databaseQueries:0,emailsSent:0,productionChanges:0}
  await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
  console.log(JSON.stringify({destination,baseDate:dataset.baseDate,scenarios:index,emailsSent:0,modelCalls:0},null,2))
}

if (values.serve) {
  const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8'}
  const server = http.createServer(async(req,res)=>{
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return}
    let file
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1:4182').pathname)
      file=path.resolve(destination,'.'+(pathname==='/'?'/index.html':pathname))
      if (!file.startsWith(destination+path.sep) || !types[path.extname(file)] || pathname.split('/').some(s=>s.startsWith('.'))) throw Error('forbidden')
      const real=await fs.realpath(file)
      if (!real.startsWith(destination+path.sep)) throw Error('forbidden')
      const body=await fs.readFile(real)
      res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'})
      res.end(req.method==='HEAD'?undefined:body)
    } catch {res.writeHead(404);res.end('Not found')}
  })
  server.listen(4182,'127.0.0.1',()=>console.log('Email design preview: http://127.0.0.1:4182/'))
} else await generate()
