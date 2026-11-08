// Code-native comparison layout for remote screenshot delivery. No model calls.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export function renderWriterComparison({ currency, baseDate, facts, rows }) {
  if (!['CLP', 'BRL'].includes(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || rows.length !== 3 ||
    /sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY/i.test(JSON.stringify({ facts, rows }))) throw new Error('unsafe_comparison_projection')
  const title = currency === 'CLP' ? '칠레 · 페소' : '브라질 · 헤알'
  const blocks = (name, list) => `<section><h3>${escape(name)}</h3>${list?.length ? list.map(b => `<h4>${escape(b.title)}</h4><p>${escape(b.text)}</p>`).join('') : '<p class="empty">근거가 있는 생성 항목 없음</p>'}</section>`
  const prose = c => c ? `<h2>${escape(c.title)}</h2><p class="deck">${escape(c.summary)}</p>${blocks('왜 움직였나', c.drivers)}${blocks('영업 환경의 의미', c.implications)}${blocks('확인할 변수', c.watch)}` : '<h2>완성 원고 없음</h2><p>요청 또는 출력 검증 실패로 이번 모델의 실제 원고를 표시할 수 없습니다. 다른 원고로 대체하지 않았습니다.</p>'
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'"><title>LATAM FX ${escape(currency)} 모델 비교</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f4ed;color:#173133;font-family:'Malgun Gothic','Segoe UI',sans-serif}main{max-width:1480px;margin:auto;padding:36px}header{border-bottom:2px solid #234945;padding-bottom:22px}.brand{letter-spacing:3px;color:#226659;font-size:14px;font-weight:800}h1{font-size:32px;margin:14px 0}header p{margin:8px 0;color:#4b5c5b;font-size:16px;line-height:1.7}.facts{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0}.fact{border-left:3px solid #328575;padding-left:12px;font-size:16px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.card{padding:26px;background:white;border:1px solid #d9dfd5;border-top:5px solid #24685c}.model{font-size:23px;font-weight:800}.money{font-size:15px;color:#53645f;margin-top:7px}.badge{font-size:13px;display:inline-block;background:#fff2d0;color:#62451a;padding:6px 10px;margin:12px 0}h2{font-size:25px;line-height:1.5;word-break:keep-all;margin:15px 0}p{font-size:17px;line-height:1.8;margin:10px 0;overflow-wrap:anywhere}.deck{font-size:17px;border-bottom:1px solid #e1e6db;padding-bottom:20px}h3{font-size:17px;color:#226659;margin:26px 0 14px;padding-top:16px;border-top:1px solid #dce3d8}h4{font-size:18px;line-height:1.6;margin:20px 0 8px}.empty{color:#6d7771;font-size:15px}.review{margin-top:26px;border-top:1px solid #dce3d8;padding-top:14px}.review p{font-size:15px;color:#705629}footer{font-size:14px;color:#5b6963;line-height:1.7;border-top:1px solid #ced8ca;margin-top:28px;padding-top:18px}@media(max-width:800px){main{padding:18px}.grid{grid-template-columns:1fr}}
</style></head><body><main><header><div class="brand">LATAM FX / WRITER COMPARISON</div><h1>${escape(title)} — ${escape(baseDate)} · 세 모델의 실제 원고</h1><p>동일 근거 · 동일 새 BP 하네스 · medium · 모델별 한 표본. 본문을 교정하거나 새로 쓰지 않았습니다.</p><p>로컬 미게시 비교본입니다. 저장 환율의 관측시각은 미상이며 이후 기사 장중 상황과 같은 가격 기준으로 합치지 않습니다.</p></header><div class="facts">${facts.map(f => `<div class="fact">${escape(f.label)}</div>`).join('')}</div><div class="grid">${rows.map(r => `<article class="card"><div class="model">${escape(r.modelLabel)}</div><div class="money">생성 비용 ${r.costUsd === null ? '미확인' : '$' + Number(r.costUsd).toFixed(6)}${r.existing ? ' · 기존 결과 재사용' : ' · 이번 신규 호출'}</div><div class="badge">${escape(r.statusLabel)}</div>${prose(r.content)}<div class="review">${r.notes.map(n => `<p>${escape(n)}</p>`).join('')}</div></article>`).join('')}</div><footer>수치·차트는 코드의 동일 스냅샷, 설명은 각 모델의 실제 생성 결과입니다. 내용 검토는 에이전트의 잠정 판단이며 사람 게시 승인이나 모델 전체의 성능 순위가 아닙니다. 회사별 실적·가격 업무·목표환율을 제시하지 않습니다.</footer></main></body></html>`
}
async function main() {
  const review = JSON.parse(await fs.readFile('.local-reports/private/model-suitability-clp-brl-trial-v1/final-review.json', 'utf8'))
  await fs.mkdir('artifacts', { recursive: true })
  for (const country of review.countries) {
    const file = `artifacts/writer-comparison-${country.currency}.html`
    await fs.writeFile(file, renderWriterComparison(country), { flag: 'wx' })
    console.log(JSON.stringify({ file, currency: country.currency, modelCalls: 0 }))
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(() => { console.error('comparison_render_failed'); process.exitCode = 1 })
