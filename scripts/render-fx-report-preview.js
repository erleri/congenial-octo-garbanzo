import fs from 'node:fs/promises'
import path from 'node:path'

const inputPath = path.resolve(process.argv[2] ?? 'fx-report-run.json')
const outputDir = path.resolve('dist-report')

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function list(items) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
}

function statements(items, facts) {
  return items.map((item) => {
    const chips = item.factIds.map((id) => facts.get(id)).filter(Boolean)
      .map((fact) => `<span class="fact">${escapeHtml(fact.label)}</span>`).join('')
    return `<article><p>${escapeHtml(item.text)}</p><div class="facts">${chips}</div></article>`
  }).join('')
}

const report = JSON.parse(await fs.readFile(inputPath, 'utf8'))
const content = report.selectedContent
const evidence = report.evidence
const facts = new Map(evidence.facts.map((fact) => [fact.id, fact]))
const confidence = { high: '높음', medium: '보통', low: '낮음' }[content.confidence] ?? content.confidence
const html = `<!doctype html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LATAM FX 샘플 리포트</title>
<style>
:root{font-family:Inter,Pretendard,"Noto Sans KR",system-ui,sans-serif;color:#152033;background:#f5f7fa}*{box-sizing:border-box}body{margin:0}.shell{max-width:1120px;margin:0 auto;padding:28px 20px 60px}.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.brand{font-weight:900;font-size:24px}.brand span{color:#1769e0}.meta{color:#687386;font-size:13px}.panel{background:#fff;border:1px solid #dce2ea;border-radius:14px;box-shadow:0 8px 28px rgba(30,48,75,.06);padding:28px}.eyebrow{display:flex;gap:8px;align-items:center;color:#1769e0;font-size:13px;font-weight:800}.badge{display:inline-block;border-radius:999px;padding:5px 10px;background:#eaf2ff;color:#1459bd}.lead{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #e8ecf1;padding-bottom:22px}.lead h1{font-size:27px;line-height:1.4;margin:12px 0 0;max-width:780px}.confidence{white-space:nowrap;border-radius:999px;background:#eef8f2;color:#167542;padding:7px 12px;font-size:13px;font-weight:800}.summary{background:#f7faff;border-left:4px solid #1769e0;border-radius:8px;margin:22px 0;padding:15px 18px}.summary ul{margin:0;padding-left:20px}.summary li{margin:7px 0;line-height:1.55}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.section{border:1px solid #e4e8ee;border-radius:10px;padding:18px;margin-top:18px}.section h2{font-size:17px;margin:0 0 14px}.section article+article{border-top:1px solid #edf0f4;margin-top:14px;padding-top:14px}article p{line-height:1.6;margin:0 0 9px}.facts{display:flex;flex-wrap:wrap;gap:7px}.fact{font-size:12px;color:#1459bd;background:#edf4ff;border:1px solid #ccdcf6;border-radius:5px;padding:4px 7px}.section ul{padding-left:20px;margin:0}.section li{line-height:1.65;margin:5px 0}.limit{margin-top:18px;color:#687386;font-size:13px}.notice{margin-top:15px;padding:11px 14px;background:#fff8e8;border:1px solid #f4d990;border-radius:8px;color:#755400;font-size:13px}@media(max-width:720px){.grid{grid-template-columns:1fr}.lead{display:block}.confidence{display:inline-block;margin-top:14px}.panel{padding:20px}.lead h1{font-size:22px}}
</style></head><body><main class="shell">
<header class="top"><div class="brand">LATAM <span>FX</span></div><div class="meta">로컬 샘플 · 운영 미게시</div></header>
<section class="panel">
<div class="eyebrow"><span class="badge">${report.generationMode === 'ai_enhanced' ? 'AI 보강' : '자동 분석'}</span><span>기준일 ${escapeHtml(report.baseDate)}</span></div>
<div class="lead"><h1>${escapeHtml(content.headline)}</h1><span class="confidence">신뢰도 ${escapeHtml(confidence)}</span></div>
<div class="summary">${list(content.executiveSummary)}</div>
<div class="grid">
<section class="section"><h2>주요 환율 움직임</h2>${statements(content.keyMoves, facts)}</section>
<section class="section"><h2>계획환율 대비 관찰 사항</h2>${statements(content.planObservations, facts)}</section>
</div>
<section class="section"><h2>다음 관찰 항목</h2>${list(content.scenarios)}</section>
<details class="section limit"><summary>분석 기준과 한계</summary>${list(content.limitations)}</details>
<div class="notice">이 화면은 로컬 검토용입니다. Supabase 저장, 공개 게시 및 이메일 발송을 수행하지 않았습니다.</div>
</section></main></body></html>`

await fs.mkdir(outputDir, { recursive: true })
await fs.writeFile(path.join(outputDir, 'index.html'), html, 'utf8')
console.log(`Wrote ${path.join(outputDir, 'index.html')}`)

