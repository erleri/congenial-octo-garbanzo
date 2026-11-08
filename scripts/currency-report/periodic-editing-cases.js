// Regression snippets, not new reports, admissible evidence or model outputs.
// Saved snippets are matched to the immutable actual trial by the local replay.
export const PERIODIC_EDITING_CASES = Object.freeze([
  { id: 'saved-process-title', origin: 'saved_sol_quote', target: 'title',
    text: '전회 설명은 이번에도 분석가의 견해를 통해 점검할 수 있다', codes: ['process_title'] },
  { id: 'saved-process-summary', origin: 'saved_sol_quote', target: 'summary',
    text: '이번 검토 요지에는 페소 지지력과 미국으로의 자금 유인을 환율에 연결한 분석가의 견해가 담겼다.', codes: ['process_prose'] },
  { id: 'saved-period-scope', origin: 'saved_sol_quote', target: 'summary',
    text: '기존 설명을 다시 검토할 근거이지, 비교 기간 전체의 원인 지속이나 요인 간 우열을 입증한 자료는 아니다.', codes: ['scope_announcement'] },
  { id: 'saved-repeated-scope', origin: 'saved_sol_quote', target: 'drivers',
    text: '전회 구리 항목을 이번에도 점검할 근거이며, 구리의 단독 효과나 기여 크기를 확인한 것은 아니다.', codes: ['process_prose', 'scope_announcement'] },
  { id: 'saved-process-close', origin: 'saved_sol_quote', target: 'drivers',
    text: '전회 미국 금리 항목을 이번에도 자금 유인 경로를 중심으로 재점검할 수 있다.', codes: ['process_prose'] },
  { id: 'saved-attributed-copper', origin: 'saved_sol_quote', target: 'drivers',
    text: 'Capitaria의 Lucas Santillán은 구리 조정에 따른 페소 지지력 약화가 대외 달러 압력과 함께 작용했다고 해석했다.', codes: [] },
  { id: 'saved-attributed-rates', origin: 'saved_sol_quote', target: 'drivers',
    text: 'Vantrust Capital의 Juan Pablo Iturriaga는 칠레와 미국의 금리 여건 차이에 주목해, 미국 국채금리의 매력이 자금을 미국으로 유인하며 달러 압력을 지지한다고 봤다.', codes: [] },
  { id: 'synthetic-conclusion-title', origin: 'synthetic_style_contrast', target: 'title',
    text: '미국 국채의 매력이 설명하는 달러 자금 유인', codes: [] },
  { id: 'synthetic-material-condition', origin: 'synthetic_style_contrast', target: 'drivers',
    text: '다만 헤지한 결제에는 같은 달러 대금의 환산 비교를 그대로 적용할 수 없다.', codes: [] },
  { id: 'synthetic-price-basis', origin: 'synthetic_style_contrast', target: 'drivers',
    text: '두 매체의 가격 기준이 서로 달라 같은 관측값으로 비교하지 않는다.', codes: [] },
  { id: 'synthetic-partial-title', origin: 'synthetic_style_contrast', target: 'title',
    text: '금리 경로는 확인, 구리의 역할은 재확인', codes: [] },
])
export function periodicSnippetContent(row) {
  return { title: row.target === 'title' ? row.text : '검토용 제목',
    summary: row.target === 'summary' ? row.text : '',
    drivers: row.target === 'drivers' ? [{ title: '검토용 항목', text: row.text }] : [], watch: [] }
}
