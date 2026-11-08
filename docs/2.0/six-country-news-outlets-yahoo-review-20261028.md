# 6개국 뉴스 매체와 Yahoo Finance 경로 검토

2026-10-28 · 무료 공개 검색/읽기와 기존 로컬 자료 검토 · 조사 결과이며 실행 설정 변경 아님

## 결론

현재 출처는 경제 전문지, 경제 전문 디지털 매체, 종합 뉴스, 공영 통신사가 섞여 있다. 부적절한 매체만 사용한 것은 아니지만, 각국 경제 전문지를 모두 주 경로에 넣었다고 설명해서는 안 된다. BRL의 Valor Econômico, MXN의 El Financiero, ARS의 Ámbito를 조사 우선순위에 명시하는 것이 좋다. 이는 추가 제안이며 이번에 수집 설정이나 이용 승인을 변경하지 않았다.

Yahoo Finance에서 여섯 통화 관련 기사를 검색할 수 있었다. Reuters·Bloomberg 등의 게시 사례가 있으며, PEN도 과거 원인 설명 사례가 있다. 그러나 이번 직접 열기 6건은 모두 HTTP 429였다. 검색에 노출된 내용과 날짜를 확인한 것이며, 새로운 원문 바이트 확보·기사 카드 승인·안정적 자동 수집 성공으로 기록하지 않는다.

아래의 ‘주요’는 경제·금융 전문성과 편집 기능을 근거로 한 조사 우선순위다. 동일 기준의 최신 발행부수/독자 수를 비교하지 않았으므로 국가별 1~3위 순위가 아니다. 매체의 자체 ‘1위’ 홍보 문구도 객관적 순위로 옮기지 않는다.

## 현재 사용 위치를 구분한 점검

- `six-currency-source-register-20261027.json`의 newsRoutes와 `six-currency-explanation-sources-20261027.json`의 국가별 newsRefs를 읽었다. BRL InfoMoney/Agência Brasil, MXN El Economista/Expansión, COP La República/Portafolio, PEN Gestión/RPP, ARS Infobae/El Cronista, CLP 기존 DF/Pulso/Emol/Yahoo 사례다.
- `research-source-selection.js`는 이 등록 자료를 질문별 조사 경로로 연결한다. 등록은 본문 확보나 모델 입력 허가가 아니다. `selected-source-collection.js`와 기존 국가별 조사/준비 결과는 확보·실패·검토 상태를 분리한다.
- 별도 기존 `news-discovery.js`의 GDELT 분류는 BRL/MXN/CLP만 지원한다. 여기에는 Valor와 El Financiero도 있지만, 6개국 공통 조사 등록부의 주 경로와 동일하지 않다. Yahoo는 이 분류에서 별도 우선 매체로 지정돼 있지 않다.
- `local-source-discovery.js`의 전용 사이트맵 수집은 CLP의 Emol/Reporte Minero다. 여섯 국가 모든 신문에 전용 자동 수집기가 있다는 뜻이 아니다.
- 따라서 ‘사이트 목록에 있음 / 검색 우선순위에 있음 / 실제 본문을 받음 / 검토된 카드가 있음 / 반복 자동 수집 가능’을 별도 상태로 유지해야 한다.

## 국가별 매체와 제안 우선순위

| 통화 | 현재 등록·기존 확인 경로 | 경제 전문 매체 점검 | 무료 조사 제안 |
| --- | --- | --- | --- |
| BRL | InfoMoney, Agência Brasil; 별도 GDELT 분류에 Valor | Valor Econômico는 경제 일간지. InfoMoney는 시장·투자·비즈니스 전문 디지털 매체. Agência Brasil은 공영 종합 통신사이며 경제신문과 다르다. | Valor를 주요 사건 발견 경로에 명시하고 실제 공개 본문만 사용. InfoMoney 시장 기사, Agência Brasil 경제 보도를 실용적인 무료 후보로 병행. Yahoo 국제 보도 추가 검색. |
| MXN | El Economista, Expansión; 별도 GDELT 분류에 El Financiero | El Economista·El Financiero는 경제·금융 전문지. Expansión은 비즈니스 잡지 기반 매체/포털로, 경제 일간지와 구분. | El Economista + El Financiero를 주 조사 축으로, Expansión과 Yahoo를 보완 경로로 제안. |
| COP | La República, Portafolio; 후속 사례 Infobae | La República와 Portafolio 모두 경제·비즈니스 전문 매체. Infobae는 종합 뉴스. 콜롬비아 larepublica.co와 페루 larepublica.pe를 혼동하지 않는다. | 기존 두 전문지 우선순위 유지. 공개 본문과 내용 적합성을 확인하고 Infobae/Yahoo로 보완. Sep24 La República의 현지 달러 조달 설명은 기존 사례에서 확보. |
| PEN | Gestión, RPP; 추가 Macroconsult 공개 브리프 | Gestión은 경제·금융·비즈니스 전문지. RPP는 종합 방송/뉴스 매체. Macroconsult는 경제 분석기관의 브리프이며 신문이 아니다. | Gestión의 단순 ‘오늘 달러 얼마’ 글보다 시장 원인·딜러 견해 보도를 우선. RPP·Yahoo를 보완. 현재 저장 사례의 직접 원인 부족은 계속 남는다. |
| CLP | DF, Pulso, Emol, Yahoo; 전용 수집 Emol/Reporte Minero | Diario Financiero는 경제 전문지. Pulso는 현재 La Tercera의 경제·비즈니스 영역. Emol은 종합 포털 경제면, Reporte Minero는 광업 전문 매체. | DF/Pulso에서 주요 이슈를 찾고 공개 가능한 Emol 시장 기사와 Yahoo를 함께 검토. 구리 기사를 CLP의 직접 원인으로 자동 승격하지 않는다. |
| ARS | Infobae, El Cronista | El Cronista는 경제·금융 전문지. Infobae는 종합 디지털 뉴스. Ámbito는 금융 전문 매체로 추가 조사할 가치가 있다. | El Cronista + Ámbito를 전문 매체 축으로 제안하고 Infobae·Yahoo Reuters 스페인어 보도를 병행. mayorista/oficial/MEP/CCL/blue를 구분. |

### 매체 성격 확인 출처

- BRL: [Valor 경제 일간지·소유구조 조사](https://brazil.mom-gmr.org/br/midia/detail/outlet/valor-economico/)는 과거 자료로 매체 유형 확인에만 사용. 이번 Valor 홈페이지 읽기는 robots 차단으로 최신 직접 점검 미완료. [InfoMoney 자체 소개](https://www.infomoney.com.br/quem-somos/), [Agência Brasil 자체 소개](https://agenciabrasil.ebc.com.br/sobre).
- MXN: [El Economista 미디어 소개](https://www.eleconomista.com.mx/mediakit/index.html), [El Financiero 자체 소개](https://www.elfinanciero.com.mx/quienes-somos/), [Expansión 창간 회고](https://expansion.mx/empresas/2019/04/14/la-revista-expansion-cumple-50-anos).
- COP: [La República 소개](https://productos.larepublica.co/), [Portafolio 공식 사이트](https://www.portafolio.co/). 이번 Portafolio 읽기는 오래된 캐시였으므로 최신 기사 수집 성공으로 세지 않는다.
- PEN: [Gestión 편집 조직](https://gestion.pe/quienes-somos/), [Gestión 공식 사이트](https://gestion.pe/). RPP/Macroconsult의 기사 역할은 기존 `four-country-price-case-followup-20261028.md`의 실제 원문 검토를 재사용.
- CLP: [DF 창간·편집 성격 설명](https://www.df.cl/opinion/editorial/diario-financiero-27-anos-informando), [La Tercera의 Pulso 소개](https://www.latercera.com/nacional/noticia/con-catedra-de-exdirectores-de-la-tercera-se-concreta-traspaso-de-archivo-periodistico-de-copesa-a-la-udd/). Pulso 목록 URL은 이번 404/robots 결과가 있어 반복 접근 경로 보완 필요.
- ARS: [El Cronista 자체 소개](https://www.cronista.com/institucionales/quienes-somos/), [Ámbito의 전문 편집 정체성](https://www.ambito.com/anuario-2025/ambito-financiero-cumple-49-anos-reafirmando-su-compromiso-el-periodismo-calidad). Cronista 루트는 이번 USA판으로 이동했으므로 국가판과 금융 섹션을 고정할 필요가 있다. [구독 안내](https://www.cronista.com/suscripciones/)가 있으며 기존 표본의 구독벽을 우회하지 않는다.

## Yahoo Finance 실제 검색 결과

검색 범위: finance.yahoo.com / es.finance.yahoo.com 중심, 일부 ca.finance.yahoo.com 결과 포함. 영어 통화명과 스페인어 명칭·dólar·기간을 조합했다. 무기간 검색과 2026년 10월/9월 검색을 나눴다. 아래는 경로 존재·설명 가능성을 확인하는 예시이며 현재 리포트에 채택한 새 근거가 아니다.

| 통화 | 검색에 확인된 게시 사례 | 설명 역할과 한계 |
| --- | --- | --- |
| BRL | [Reuters, 2024-11-11: 재정 조치 지연과 헤알 약세](https://finance.yahoo.com/news/brazils-currency-weakens-amid-government-152245683.html) | 국가 고유 사건과 통화 연결이 있는 사례. 2024년 기사이므로 2026년 특정 거래일 근거로 전용 불가. |
| MXN | [Reuters, 2026-08-25: super peso 설명](https://finance.yahoo.com/markets/currencies/articles/explainer-super-peso-back-starting-225352201.html) | 달러·금리차·자금 흐름을 구분한 누적 움직임 설명. 특정 10월 일간 변동 원인으로 사용하지 않음. |
| COP | [Reuters, 2025-01-27: 관세 갈등과 페소 움직임](https://ca.finance.yahoo.com/news/analysis-mexican-peso-tumbles-investors-214036775.html) | 제목은 MXN 중심이나 COP의 하락·회복 설명도 존재. 제목/통화 태그만으로 내용을 버리거나 전부 COP에 적용하지 않음. |
| PEN | [Reuters, 2025-01-30: 달러 공급·무역흑자와 솔 안정](https://finance.yahoo.com/news/perus-dollar-mountain-lets-sol-100259595.html) | PEN 구조적 설명 경로가 존재한다. 기존 2026-10-20/22/26의 일별 원인 부족은 해결하지 않음. |
| CLP | [2026-10-13: 신흥시장 위험회피와 CLP/BRL](https://finance.yahoo.com/markets/currencies/articles/ai-selloff-drags-emerging-stocks-204545101.html) | 광역 시장 배경 후보. 모든 CLP 움직임의 현지 직접 원인을 입증하지 않음. [Bloomberg 2026-09-08 정책 전망](https://es.finance.yahoo.com/noticias/chile-mantendr%C3%ADa-tasa-riesgo-fed-120236057.html)도 발견했으나 예정·전망과 발생 사실을 구분. |
| ARS | [Reuters, 2026-08-24: 도매 페소 약세와 달러 공급/정책 해석](https://es.finance.yahoo.com/noticias/peso-argentino-toca-nivel-m%C3%ADnimo-144928790.html) | 도매 환율과 발언자 귀속이 있는 설명 후보. BCRA 기준값이나 MEP/CCL/blue와 혼합하지 않음. |

위 표의 첫 번째 링크 여섯 개를 직접 열려고 했으나 모두 HTTP 429였다. 검색 서비스가 제공한 인덱스 텍스트는 확보했지만 새 원문 캡처·해시 검증은 하지 못했다. 추가 재시도나 다른 접속 경로를 통한 차단 우회는 하지 않았다.

PEN/COP의 2026년 10월로 좁힌 검색에는 환율 표와 기업 실적 보도자료가 많이 섞였다. 통화가 언급됐다는 이유로 원인 근거로 채택하지 않는다. 이 제한적 검색의 미발견을 ‘Yahoo에 해당 기사가 전혀 없음’으로 확대하지 않는다.

## Yahoo를 쓰는 방법과 사용할 수 없는 전제

1. **검색/발견:** 검색엔진의 사이트 제한 + 현지 통화명 + 거래일/기간, Yahoo 공개 검색/관련 뉴스 기능을 사용해 후보 URL을 찾는다. 예: `site:es.finance.yahoo.com "peso colombiano" "2026" "septiembre"`. 검색 결과는 후보이며 기사 카드가 아니다.
2. **게시 부분 확인:** Yahoo에 표시된 발행처·작성자·날짜·본문 범위를 읽는다. Reuters/Bloomberg 등의 게시 부분이 충분하면 원 발행사 사이트까지 중복 방문하는 것을 필수로 만들지 않는다. 잘림·출처 불명·충돌이 있을 때만 추가 확인한다.
3. **카드:** 확인한 범위에서 자체 표현한 짧은 사실과 발언자 귀속 견해, 날짜·가격 기준·URL을 저장한다. 원문 전체·번역문·이미지의 자동 전송과 구분한다. 새로운 카드는 기존 사용 범위 검토를 거친다.
4. **중복:** Yahoo의 Reuters 기사와 같은 Reuters 기사를 실은 다른 매체는 독립 근거 두 건이 아니다. 발행처/작성자/사건/시각을 연결한다. Yahoo의 보도자료도 독립 취재 기사와 구분한다.
5. **반복 자동 수집:** 이번 조사에서 6개 통화를 매일 안정적으로 공급하는 공식 무료 뉴스 API는 확인하지 못했다. 비공식 query 엔드포인트나 yfinance를 사용 허가의 대체물로 제안하지 않는다. RSS 주소가 발견되더라도 해당 피드의 접근·사용 조건 확인이 필요하다.

[Yahoo 검색 도움말](https://help.yahoo.com/kb/SLN2340.html)은 금융 검색 기능을, [시장 정보 도움말](https://help.yahoo.com/kb/SLN24381.html)은 환율 관련 뉴스 경로를 안내한다. [콘텐츠 공급 안내](https://help.yahoo.com/kb/SLN24383.html)는 다양한 공급자와 기업 보도자료를 포함함을 설명한다.

[Yahoo 서비스 약관](https://legal.yahoo.com/us/es/yahoo/terms/otos/index.html)의 1.4.9는 사전 명시적 허가 없는 자동 수집을 제한한다. 검색·읽기 가능만으로 LATAM FX의 반복 수집 허가를 얻었다고 판단하지 않는다. 이것은 모든 사실의 자체 요약이 불법이라는 결론이 아니며, 개별 기사 사실 카드의 이용 판단과 자동 접근 방식의 조건을 구분해야 한다. 이번에는 법적 허가나 거부 결론, 기존 카드 승인 상태를 변경하지 않았다.

## 무료 중심 운영 설계에 대한 제안

- 경제 전문지와 무료 접근 가능한 매체를 함께 등록하되, 공개 본문만 읽는다. 제목만 보이는 구독 기사는 발견용으로만 남긴다. 전문지라는 이유로 반드시 사용하지 않는다.
- 국가별 검색은 **동일 거래일 시장 기사 → 해당 국가의 정책/수급 해설 → Yahoo 국제/재배포 기사 → 필요한 소비 배경** 순으로 후보를 비교한다. 앞단에서 충분한 근거가 확보되면 모든 매체를 채우려고 수집하지 않는다.
- ‘환율이 얼마’보다 누가 어떤 사건·수급·정책에 반응했다고 설명하는지를 선별한다. 특히 PEN은 단순 일일 시세 글 추가보다 딜러·기업 결제·수출업체 달러 공급·정책 반응 보도가 필요하다.
- 기관 통계는 수치/기간/소비 환경 확인에 사용하고, 뉴스의 빈 원인 설명을 대신하지 않는다.
- 기술적 읽기, 내용 지지, 이용 범위, 외부 모델 입력, 공개 표시를 따로 기록한다. [La República 약관](https://www.larepublica.co/aviso-legal) 등에도 조건이 있으므로 Yahoo만 특별히 검사하고 다른 매체는 자동 허용하지 않는다. Agência Brasil도 자체 [재사용 정책](https://agenciabrasil.ebc.com.br/sobre)과 제3자 콘텐츠 예외를 구분한다.
- 이번 단계에서는 조사 결과만 추가한다. 다음 구현은 기존 등록부의 전문 매체 우선순위·국가판·Yahoo 후보 경로와 실패 상태를 정리하는 범위로 한정하는 것이 적절하다. 권장 개발 모델: Sol High. 당일 설명의 실제 지지 범위 판단은 Astra High 검토가 적합하다.

## 변경·검증 경계

새 조사 문서 한 개만 작성했다. 기존 환율·원고·카드·사용 승인·소스 등록부·생성 코드·운영 설정은 변경하지 않았다. 새 모델/API 유료 호출, 구독, 메시지 발송, 배포는 0건이다. 문서 링크/매체 구분과 기존 코드 연결을 확인했으며 코드 변경이 없어 전체 테스트/빌드를 반복 실행하지 않았다. 이번 검색 표본은 일별 보도 커버리지 측정이나 새 원고 품질 시험이 아니다.
