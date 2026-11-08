// Reviewed public-source editorial examples, not AI outputs or point-in-time backtests.
const claim = (title, text, kind, factIds = [], evidenceIds = []) => ({ title, text, kind, factIds, evidenceIds })
export const fixtures = [
  {
    currency: 'BRL', baseDate: '2025-06-20',
    evidence: [{ id: 'bcb-june', country: 'BRL', title: 'Copom increases the Selic rate — June 2025', publisher: 'Banco Central do Brasil', url: 'https://www.bcb.gov.br/en/monetarypolicy/copomstatements/2615', publishedAt: '2025-06-18', eventDate: '2025-06-18', period: '2025년 6월 통화정책 결정', collectedAt: '2026-09-13', summary: 'BCB raised Selic by 0.25 percentage points to 15.00%. It reported inflation above target, some moderation in growth and uncertainty about US trade and fiscal policy. It anticipated a pause conditional on the expected scenario, while keeping policy restrictive for a prolonged period.' }],
    content: {
      title: '헤알의 가격과 소비의 체감은\n같은 속도로 움직이지 않는다',
      summary: '브라질은 높은 금리로 물가 압력을 억제하는 국면입니다. 환율의 단기 변화와 별개로, 내구재 시장에서는 수입가격 부담과 소비자의 금융 부담을 함께 이해할 필요가 있습니다.',
      change: claim('짧은 움직임과 누적 흐름을 함께', '이번 관측값은 {{spot}}입니다. {{day}}, {{five}}로, 하루의 변화만으로 새 추세가 시작됐다고 해석하지 않습니다. 아래 곡선은 같은 자료의 관측값이며 통화정책 사건이 개별 등락의 원인임을 증명하지는 않습니다.', 'fact', ['spot', 'day', 'five']),
      drivers: [
        claim('국가 요인 · 긴축의 강도가 높아졌다', '중앙은행은 물가와 기대인플레이션이 목표를 웃돈다는 판단 아래 기준금리를 추가로 높였습니다. 금리 수준은 통화가치를 이해하는 배경이지만, 결정이 사전에 얼마나 반영됐는지는 이 발표문만으로 알 수 없습니다.', 'fact', [], ['bcb-june']),
        claim('공통 요인 · 미국 정책의 불확실성', '발표문은 미국의 무역·재정정책과 지정학적 긴장이 글로벌 금융 여건에 영향을 준다고 설명합니다. 헤알의 움직임을 브라질 내부 사정만으로 해석하기 어려운 이유입니다. 각 요인의 기여도는 확인되지 않았습니다.', 'interpretation', [], ['bcb-june']),
      ],
      implications: [
        claim('구매력 · 환율과 할부 부담은 별개의 경로', '일반적으로 현지통화 가치가 회복되면 달러 표시 수입원가 부담이 줄어들 여지가 있습니다. 그러나 높은 금융비용은 할부 구매의 체감 부담을 남길 수 있습니다. 원가 여건의 개선과 최종 소비 수요의 회복이 동시에 나타난다고 단정할 수 없습니다.', 'mechanism', [], ['bcb-june']),
        claim('내구재 수요 · 경기 판단의 온도 차', '중앙은행은 경제활동에 일부 활력이 남아 있지만 성장에는 완만한 둔화가 관측된다고 설명했습니다. 이는 소비 배경이며 가전·TV의 실제 판매 감소를 뜻하지 않습니다. 이 사례에는 업종별 소매판매 자료가 포함되지 않았습니다.', 'interpretation', [], ['bcb-june']),
      ],
      watch: [claim('금리 동결 가능성과 물가의 경로', '중앙은행은 예상한 상황이 이어지면 인상 중단을 검토하되 긴축 수준은 오래 유지할 수 있다고 설명했습니다. 이후 물가와 경제활동이 이 조건에 부합하는지가 해석을 바꿀 변수입니다.', 'fact', [], ['bcb-june'])],
      limitations: ['공식 정책 발표 한 건으로 배경을 설명한 편집 시안입니다. 당일 환율의 직접 원인과 업종별 셀아웃은 확인되지 않았습니다.', '일반적 전달 경로는 조건부 설명이며 가격·판촉 업무에 대한 제안이 아닙니다.'],
    },
  },
  {
    currency: 'MXN', baseDate: '2025-05-16',
    evidence: [{ id: 'banxico-may', country: 'MXN', title: 'Monetary Policy Statement — May 15, 2025', publisher: 'Banco de México', url: 'https://www.banxico.org.mx/canales/%7BDD125F08-78AD-17EE-3CD1-1F4EC5C9213D%7D.pdf', publishedAt: '2025-05-15', eventDate: '2025-05-15', period: '2025년 5월 결정·1분기 경기 판단', collectedAt: '2026-09-13', summary: 'Banxico cut the target rate by 50 basis points to 8.50%, effective May 16. It described peso appreciation over the period since the previous decision, alongside broad dollar depreciation and a wide trading range. Economic activity remained weak, while trade uncertainty added downside risks. The English translation notes that the Spanish statement is authoritative.' }],
    content: {
      title: '페소의 회복을\n소비 회복으로 읽어도 될까',
      summary: '멕시코 중앙은행은 이전 결정 이후 페소 강세와 경기 부진을 함께 언급했습니다. 환율과 내수는 서로 다른 신호를 낼 수 있습니다. 내구재 영업에서 중요한 구분은 수입가격 여건과 소비자의 구매 의향입니다.',
      change: claim('변화의 기간을 구분해서 읽기', '이번 관측값은 {{spot}}이며 {{day}}, {{five}}입니다. 중앙은행의 환율 평가는 이전 정책 결정 이후의 기간을 뜻하므로, 이 화면의 하루·단기 변화와 동일한 기간으로 해석하지 않습니다.', 'fact', ['spot', 'day', 'five']),
      drivers: [
        claim('공통 요인 · 달러 흐름이 함께 작용', '중앙은행은 무역 긴장으로 세계 성장 전망이 약해진 환경에서 달러가 약세를 보였다고 설명했습니다. 페소의 회복을 멕시코 고유의 호재로만 설명하기에는 공통 요인의 영향이 남아 있습니다.', 'interpretation', [], ['banxico-may']),
        claim('국가 요인 · 완화와 경기 부진의 동행', '정책금리 인하에는 물가 상황뿐 아니라 약한 경제활동과 무역정책 불확실성이 고려됐습니다. 발표문에 따르면 페소는 이전 결정 이후 강세였지만 넓은 범위에서 거래됐습니다. 인하가 특정 일자의 환율 변화를 일으켰다는 의미는 아닙니다.', 'fact', [], ['banxico-may']),
      ],
      implications: [
        claim('수입가격 · 원가와 소비자가격 사이의 시간', '일반적으로 페소 가치의 회복은 달러 표시 수입제품의 현지통화 비용을 낮추는 방향입니다. 그러나 유통 재고와 계약·가격 반영 시차가 있어 소비자가격이나 판매량이 바로 달라진다고 볼 수는 없습니다.', 'mechanism', [], ['banxico-may']),
        claim('소비 여건 · 완화가 곧 수요 회복은 아니다', '금리 인하는 금융 부담이 완화될 여지를 주지만 실제 할부 조건은 금융기관과 상품에 따라 다릅니다. 중앙은행의 약한 경기 판단을 감안하면, 환율 여건의 개선만으로 가전 교체 수요가 회복됐다고 판단하기 어렵습니다.', 'mechanism', [], ['banxico-may']),
      ],
      watch: [claim('무역 불확실성과 물가의 조합', '중앙은행은 무역정책 변화가 성장과 물가 양쪽에 불확실성을 준다고 밝혔습니다. 이후 정책 해석에서는 금융 완화의 여지와 이러한 불확실성을 함께 보게 됩니다.', 'interpretation', [], ['banxico-may'])],
      limitations: ['공식 발표에 근거한 과거 편집 사례이며 AI 생성 결과가 아닙니다. 당시 이용 가능했던 환율 원본 버전은 확보하지 못했습니다.', '기업별 셀아웃·마진·재고와 가전·TV 소매판매를 측정한 보고서가 아닙니다.'],
    },
  },
  {
    currency: 'CLP', baseDate: '2026-09-11',
    evidence: [
      {
        id: 'emol-clp-close', country: 'CLP',
        title: 'Dólar avanza y cierra la semana en $943 con la mira en la decisión de tasas de EE.UU.',
        publisher: 'Emol Economía',
        url: 'https://www.emol.com/noticias/Economia/2026/09/11/1211251/dolar-mercado-cambiario-local.html',
        publishedAt: '2026-09-11T18:10:16.000Z', eventDate: '2026-09-11',
        period: '칠레 외환시장 마감 보도', collectedAt: '2026-09-22',
        summary: '현지 보도는 달러가 주간 기준 상승했고 미국 금리 결정에 시장의 시선이 모였다고 설명했다.',
        provenance: 'market_reporting', scope: 'country', role: 'context', causalStatus: 'contextual',
      },
      {
        id: 'reporte-clp-copper', country: 'CLP',
        title: 'Dólar en Chile sube mientras el cobre corrige desde máximos históricos',
        publisher: 'Reporte Minero',
        url: 'https://www.reporteminero.cl/noticia/noticias/2026/09/dolar-chile-sube-cobre-corrige-maximos-historicos',
        publishedAt: '2026-09-11T14:22:00.000Z', eventDate: '2026-09-11',
        period: '칠레 달러·구리 시장 보도', collectedAt: '2026-09-22',
        summary: '현지 광업 매체는 구리 가격이 고점에서 조정되는 가운데 칠레 달러 환율이 상승했다고 보도했다.',
        provenance: 'market_reporting', scope: 'country', role: 'context', causalStatus: 'source_attributed',
      },
      {
        id: 'emol-clp-copper', country: 'CLP',
        title: 'Dólar anota nueva alza ante caída del cobre y expectativas por tasas en EE.UU.',
        publisher: 'Emol Economía',
        url: 'https://www.emol.com/noticias/Economia/2026/09/10/1211142/dolar-mercado-cambiario-local.html',
        publishedAt: '2026-09-10T17:48:08.000Z', eventDate: '2026-09-10',
        period: '칠레 외환시장 전일 보도', collectedAt: '2026-09-22',
        summary: '현지 보도는 구리 가격 하락과 미국 금리 기대를 칠레 달러 환율의 배경으로 함께 언급했다.',
        provenance: 'market_reporting', scope: 'country', role: 'context', causalStatus: 'contextual',
      },
      {
        id: 'reporte-clp-inflation', country: 'CLP',
        title: 'Inflación de agosto retrasa la convergencia a la meta del Banco Central de Chile',
        publisher: 'Reporte Minero',
        url: 'https://www.reporteminero.cl/noticia/noticias/2026/09/inflacion-agosto-retasa-convergencia-meta-banco-central-chile',
        publishedAt: '2026-09-11T01:27:00.000Z', eventDate: '2026-09-11',
        period: '칠레 8월 물가·통화정책 배경', collectedAt: '2026-09-22',
        summary: '현지 보도는 8월 물가 결과가 중앙은행 목표 수렴과 향후 통화정책 경로에 불확실성을 남겼다고 설명했다.',
        provenance: 'market_reporting', scope: 'sales_context', role: 'context', causalStatus: 'contextual',
      },
    ],
    content: {
      title: '칠레 페소 약세, 구리 조정과 달러 흐름을 함께 본다',
      summary: '칠레 페소는 전 관측일보다 뚜렷한 약세 방향으로 움직였습니다. 현지 보도는 구리 가격 조정과 미국 금리 기대를 주요 배경으로 제시하지만, 환율의 일중 관측시각이 없어 직접 원인으로 확정하지 않습니다.',
      change: claim('하루의 급한 움직임과 누적 흐름', '이번 관측값은 {{spot}}입니다. {{day}}, {{five}}로 단기 변화가 두드러졌습니다. 다만 날짜 단위 환율만으로 기사에 언급된 사건의 선후 관계를 확정할 수 없습니다.', 'fact', ['spot', 'day', 'five']),
      drivers: [
        claim('국가 요인 · 구리 가격 조정', '복수의 현지 보도는 구리 가격이 고점에서 조정된 시기에 칠레 달러 환율이 상승했다고 설명했습니다. 구리는 칠레의 대외 여건을 읽는 핵심 배경이지만, 확보된 메타데이터만으로 각 요인의 기여도를 계산할 수는 없습니다.', 'interpretation', [], ['reporte-clp-copper', 'emol-clp-copper']),
        claim('공통 요인 · 미국 금리 기대와 달러', '현지 보도는 미국 금리 기대와 달러 흐름도 함께 언급했습니다. 이는 칠레 내부 요인만으로 페소 움직임을 설명하기 어렵다는 의미이며, 특정 발표가 해당 움직임을 직접 일으켰다는 판정은 아닙니다.', 'interpretation', [], ['emol-clp-close', 'emol-clp-copper']),
      ],
      implications: [
        claim('수입가격 · 약세가 이어질 때의 전달 경로', '일반적으로 현지통화 약세는 달러 표시 수입제품의 현지통화 환산 부담을 높이는 방향입니다. 실제 소비자가격에는 계약과 재고, 유통 단계의 시차가 있어 환율 변화와 같은 속도로 움직인다고 볼 수 없습니다.', 'mechanism', [], ['emol-clp-close']),
        claim('구매력 · 물가와 금융 여건을 함께 보기', '현지 물가 보도는 목표 수렴과 통화정책 경로에 불확실성이 남아 있음을 보여 줍니다. 이는 소비 환경의 배경이지만 가전과 텔레비전의 실제 판매량 변화를 뜻하지는 않습니다.', 'interpretation', [], ['reporte-clp-inflation']),
      ],
      watch: [claim('구리의 후속 방향과 미국 금리 신호', '앞으로의 해석은 구리 가격 조정이 이어지는지, 미국 금리 기대가 달러 흐름을 어떻게 바꾸는지에 따라 달라질 수 있습니다. 이는 관찰 항목이며 환율 전망이나 목표 수준을 제시하는 내용이 아닙니다.', 'interpretation', [], ['emol-clp-close', 'reporte-clp-copper'])],
      limitations: [
        '현지 보도의 제목과 공개 메타데이터를 바탕으로 만든 검토용 편집 시안입니다. 기사 원문과 독립 출처의 대조가 완료되지 않았습니다.',
        '환율의 일중 관측시각이 없어 보도 시각과 가격 움직임의 선후 관계를 확정하지 않습니다.',
        '기업별 셀아웃·마진·재고와 품목별 실제 판매량을 측정하거나 구체적인 업무를 제안하는 보고서가 아닙니다.',
      ],
    },
  },
]
