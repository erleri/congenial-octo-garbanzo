# 6통화 출처·가격·달력·지표 비교

구현 기준 `681de0c` / 2026-11-10. 국가별 출처·가격·달력·지표 정의는 이번 저장 구조 변경으로 바뀌지 않았습니다. [11월9일 카탈로그](evidence/source-catalog-20261109.json), [당시 실행 관측](evidence/operational-snapshot-20261109.json), [11월10일 운영 무과금 수집 관측](evidence/source-observation-20261110.json)을 구분합니다. 이번 문서 갱신에서는 새 수집·이용 조건 승인·모델 호출을 하지 않았습니다.

모든 통화의 대표 환율은 **대시보드 채택값**입니다. 아래 가격 정의는 보조 자료를 연결할 때의 차이이며 대표값의 공급자를 바꾸는 설정이 아닙니다. 회사 기준환율과의 동일성·현지 종가 여부는 확인되지 않은 가정을 사실로 바꾸지 않습니다. 누적2%·정기 점검·품질·예산·공개 기준은 [공통 규칙](rules.md)을 적용합니다.

| 국가·통화 | 자동 선택에 포함된 뉴스 ID | 보조 가격 정의의 차이 | 현지 시간대 | 공식 배경의 정의 | 11월9일 실행 관측 |
| --- | --- | --- | --- | --- | --- |
| 브라질 BRL | brl-infomoney, brl-agenciabrasil, brl-cnn, brl-camara-radio | PTAX 평균 기준과 현물 종가를 구분 | `America/Sao_Paulo` | IBGE PMC11708 실질 소매 전월비. BCB 정책·일정은 별도 경로 | 3건 수집 후보, 내용 승인 아님 |
| 멕시코 MXN | mxn-eleconomista, mxn-expansion, mxn-elfinanciero, mxn-forbes | Banxico FIX·적용일과 현지 종가·거래일을 구분 | `America/Mexico_City` | INEGI 718506 전국 실질 소매(2018=100), 910399 물가 전월비, 910406 전년비. Banxico 정책 자료 별도 | 9건 수집 후보, 내용 승인 아님 |
| 콜롬비아 COP | cop-larepublica, cop-valora | TRM 산출 거래일·적용일·현물 가격을 구분 | `America/Bogota` | DANE EMC_TOTAL 실질 소매·자동차 포함 전년비. BanRep·SFC는 별도 범위 | 3건 수집 후보, 내용 승인 아님 |
| 페루 PEN | pen-revistaeconomia, pen-gestion, pen-rpp, pen-elcomercio, pen-andina, pen-infobae | 은행간·매수/매도·평균과 기사 종가를 구분 | `America/Lima` | BCRP PN07845NM 현지통화 은행 신용카드 금리. 정책금리·전체 소비를 대체하지 않음 | 3건 수집 후보, 내용 승인 아님 |
| 칠레 CLP | clp-existing-four-outlets, clp-biobio, clp-cooperativa | Dólar observado 평균과 당일 장중·종가를 구분 | `America/Santiago` | INE IACM 실질 소매 전년비(2018 기준). BCCh·실질임금 별도 | 6건 수집 후보, 내용 승인 아님 |
| 아르헨티나 ARS | ars-infobae, ars-iprofesional | 공식·도매·소매·MEP·CCL·blue를 서로 다른 가격으로 구분 | `America/Argentina/Buenos_Aires` | INDEC/DatosArgentina 슈퍼마켓 실질지수 전년비(2017 기준). 전체 소매·당일 외환 원인 아님 | 7건 수집 후보, 내용 승인 아님 |

공통 달력은 기존 대시보드 자료의 날짜·휴일/보정 상태를 입력받습니다. 모든 국가의 공식 휴일 달력을 완비했다는 뜻은 아닙니다. 현지 시간대는 IANA 이름을 사용하며 칠레 등에서 고정 UTC 차이를 하드코딩한 설명으로 바꾸지 않습니다. 기사 거래일·가격 시각이 없으면 수집일로 채우지 않습니다.

## 등록과 실제 연결의 차이

### 11월10일 무과금 저장 확인에서 관측한 결과

전체 환율 이력과 아래 준비 입력은 같은 저장·복원 규칙으로 처리했습니다. 6통화 모두 조사 후보이며 누적 ±2%를 넘지 않았고 정기 점검 예정일은 11월16일입니다. **수집 후보 31건 → 모델 처리 준비 20건**은 다른 단계의 수치이며 검토 합격·발행 건수가 아닙니다.

| 통화 | 수집 후보 | 처리 준비 기사 | 확인된 공백·조건 |
| --- | ---: | ---: | --- |
| BRL | 3 | 3 | InfoMoney 목록에서 대상 후보 없음, 다른 등록 경로 사용 |
| MXN | 9 | 4 | 일부 경로·날짜는 공통 조회 횟수 한도로 미조회 |
| COP | 4 | 3 | 이번 조회 실패 없음. 내용 검토는 아직 미실행 |
| PEN | 4 | 4 | Gestión 유료벽·Andina robots 확인 실패, 일부 경로 미조회. 다른 확보 자료 사용 |
| CLP | 6 | 3 | BioBio·Cooperativa 대상 후보 없음, 일부 기간 조회 한도 |
| ARS | 5 | 3 | 이번 조회 실패 없음. 내용 검토는 아직 미실행 |

일부 공백이 다른 출처·국가의 저장 검증을 막지는 않았습니다. 출처별 상세·실제 조사 기간은 [관측 근거](evidence/source-observation-20261110.json)에 보존했습니다. **아래 국가별 등록 URL과 실행 설명은 11월9일 보존 관측**이며, 위 새 수치와 합산하거나 현재 완전성으로 해석하지 않습니다.

`existing_adapter`는 자동 탐색 경로가 있다는 뜻이며 최신 목록의 완전성·모든 기사의 무료 접근·AI 입력 허가·내용 검토 성공을 보장하지 않습니다. `excluded`는 현재 자동 탐색 제외입니다. Yahoo Finance는 6국 모두 제외 설정입니다. 과거 Yahoo 활용 논의·개별 읽기 성공을 현재 자동 수집으로 표시하지 않습니다. Câmara Rádio는 과거 프로그램 직접 수집 보조 경로이며 최신 시장 목록 대체로 쓰지 않습니다.

칠레 `clp-existing-four-outlets`라는 옛 이름은 현재 네 매체가 모두 정상 수집된다는 뜻이 아닙니다. 실제 로컬 어댑터는 Emol Economía와 Reporte Minero를 등록하고, BioBio·Cooperativa는 별도 경로입니다. DF·Pulso의 제외/개별 판정과 이를 구분합니다. [실제 레지스트리](../../scripts/currency-report/local-source-discovery.js).

공식 사이트 등록도 지표 수집 완료를 뜻하지 않습니다. BRL 정책 조회의 빈 응답, CLP·ARS 정책의 정확한 발표/시리즈 연결, CLP 일부 PDF 수치 추출 등 공백을 운영 관측에서 구분합니다. 원인 설명은 뉴스·정책의 해당 기간 근거가 따로 필요합니다. [국가 지표 정의](../../scripts/currency-report/official-country-statistics.js), [INEGI 정의](../../scripts/currency-report/inegi-report-indicators.js).

## 브라질 · BRL

11월9일 보존 관측: brl-infomoney: 0건; brl-agenciabrasil: 2건; brl-cnn: 1건. 발행 판단: `no_active_trigger`, 정기 점검 예정 2026-11-16. 조회 실패: []. 공식 지표 사유: 추가 사유 없음(모든 지표 완료 의미 아님).

| 출처 ID | 등록 URL | 자동 탐색 설정 | 구분 |
| --- | --- | --- | --- |
| brl-infomoney | [https://www.infomoney.com.br/mercados/](https://www.infomoney.com.br/mercados/) | existing_adapter | specialist |
| brl-agenciabrasil | [https://agenciabrasil.ebc.com.br/economia](https://agenciabrasil.ebc.com.br/economia) | existing_adapter | supplemental |
| brl-valor | [https://valor.globo.com/](https://valor.globo.com/) | excluded | specialist |
| brl-yahoo | [https://finance.yahoo.com/](https://finance.yahoo.com/) | excluded | syndicated |
| brl-cnn | [https://www.cnnbrasil.com.br/economia/money/mercado/](https://www.cnnbrasil.com.br/economia/money/mercado/) | existing_adapter | supplemental |
| brl-camara-radio | [https://www.camara.leg.br/radio/742791-economia-direta](https://www.camara.leg.br/radio/742791-economia-direta) | existing_adapter | supplemental |

제외 설정: brl-valor, brl-yahoo. 출처별 이용 조건·수집 범위는 실행 시 별도 검사하며 등록/수집만으로 승인하지 않습니다.

## 멕시코 · MXN

11월9일 보존 관측: mxn-eleconomista: 3건; mxn-elfinanciero: 2건; mxn-forbes: 2건; mxn-expansion: 2건. 발행 판단: `no_active_trigger`, 정기 점검 예정 2026-11-16. 조회 실패: []. 공식 지표 사유: 추가 사유 없음(모든 지표 완료 의미 아님).

| 출처 ID | 등록 URL | 자동 탐색 설정 | 구분 |
| --- | --- | --- | --- |
| mxn-eleconomista | [https://www.eleconomista.com.mx/seccion/mercados](https://www.eleconomista.com.mx/seccion/mercados) | existing_adapter | specialist |
| mxn-expansion | [https://expansion.mx/mercados](https://expansion.mx/mercados) | existing_adapter | supplemental |
| mxn-elfinanciero | [https://www.elfinanciero.com.mx/mercados/](https://www.elfinanciero.com.mx/mercados/) | existing_adapter | specialist |
| mxn-yahoo | [https://finance.yahoo.com/](https://finance.yahoo.com/) | excluded | syndicated |
| mxn-forbes | [https://forbes.com.mx/mercados/](https://forbes.com.mx/mercados/) | existing_adapter | specialist |

제외 설정: mxn-yahoo. 출처별 이용 조건·수집 범위는 실행 시 별도 검사하며 등록/수집만으로 승인하지 않습니다.

## 콜롬비아 · COP

11월9일 보존 관측: cop-larepublica: 1건; cop-valora: 2건. 발행 판단: `no_active_trigger`, 정기 점검 예정 2026-11-16. 조회 실패: []. 공식 지표 사유: 추가 사유 없음(모든 지표 완료 의미 아님).

| 출처 ID | 등록 URL | 자동 탐색 설정 | 구분 |
| --- | --- | --- | --- |
| cop-larepublica | [https://www.larepublica.co/finanzas](https://www.larepublica.co/finanzas) | existing_adapter | specialist |
| cop-portafolio | [https://www.portafolio.co/economia/finanzas](https://www.portafolio.co/economia/finanzas) | excluded | specialist |
| cop-yahoo | [https://finance.yahoo.com/](https://finance.yahoo.com/) | excluded | syndicated |
| cop-valora | [https://www.valoraanalitik.com/](https://www.valoraanalitik.com/) | existing_adapter | specialist |

제외 설정: cop-portafolio, cop-yahoo. 출처별 이용 조건·수집 범위는 실행 시 별도 검사하며 등록/수집만으로 승인하지 않습니다.

## 페루 · PEN

11월9일 보존 관측: pen-gestion: 0건; pen-revistaeconomia: 1건; pen-rpp: 1건; pen-elcomercio: 1건; pen-andina: 0건; pen-infobae: 0건. 발행 판단: `research_candidate`, 정기 점검 예정 2026-11-16. 조회 실패: [{"sourceId": "pen-gestion", "status": "access_failed", "category": "access_failure", "reason": "publisher_paywall", "requestedPeriods": ["2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02"]}, {"sourceId": "pen-andina", "status": "access_failed", "category": "access_failure", "reason": "robots_unavailable", "requestedPeriods": ["2026-11-09", "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05", "2026-11-04", "2026-11-03", "2026-11-02"]}]. 공식 지표 사유: 추가 사유 없음(모든 지표 완료 의미 아님).

| 출처 ID | 등록 URL | 자동 탐색 설정 | 구분 |
| --- | --- | --- | --- |
| pen-revistaeconomia | [https://www.revistaeconomia.com/mercado/](https://www.revistaeconomia.com/mercado/) | existing_adapter | supplemental |
| pen-gestion | [https://gestion.pe/noticias/tipo-de-cambio/](https://gestion.pe/noticias/tipo-de-cambio/) | existing_adapter | specialist |
| pen-rpp | [https://rpp.pe/economia](https://rpp.pe/economia) | existing_adapter | supplemental |
| pen-yahoo | [https://finance.yahoo.com/](https://finance.yahoo.com/) | excluded | syndicated |
| pen-elcomercio | [https://elcomercio.pe/economia/mercados/](https://elcomercio.pe/economia/mercados/) | existing_adapter | supplemental |
| pen-andina | [https://andina.pe/agencia/seccion-economia-2.aspx](https://andina.pe/agencia/seccion-economia-2.aspx) | existing_adapter | supplemental |
| pen-infobae | [https://www.infobae.com/peru/](https://www.infobae.com/peru/) | existing_adapter | supplemental |
| pen-larepublica | [https://larepublica.pe/economia](https://larepublica.pe/economia) | excluded | supplemental |

제외 설정: pen-yahoo, pen-larepublica. 출처별 이용 조건·수집 범위는 실행 시 별도 검사하며 등록/수집만으로 승인하지 않습니다.

## 칠레 · CLP

11월9일 보존 관측: clp-existing-four-outlets: 6건; clp-biobio: 0건; clp-cooperativa: 0건. 발행 판단: `no_active_trigger`, 정기 점검 예정 2026-11-16. 조회 실패: []. 공식 지표 사유: official_pdf_numeric_parser_required.

| 출처 ID | 등록 URL | 자동 탐색 설정 | 구분 |
| --- | --- | --- | --- |
| clp-existing-four-outlets | 기존 로컬 수집기 참조 | existing_adapter | supplemental |
| clp-df | [https://www.df.cl/](https://www.df.cl/) | excluded | specialist |
| clp-pulso | [https://www.latercera.com/](https://www.latercera.com/) | excluded | specialist |
| clp-yahoo | [https://finance.yahoo.com/](https://finance.yahoo.com/) | excluded | syndicated |
| clp-biobio | [https://www.biobiochile.cl/lista/categorias/economia](https://www.biobiochile.cl/lista/categorias/economia) | existing_adapter | supplemental |
| clp-cooperativa | [https://www.cooperativa.cl/noticias/site/tax/port/all/cooperativataxport_6___1.html](https://www.cooperativa.cl/noticias/site/tax/port/all/cooperativataxport_6___1.html) | existing_adapter | supplemental |

제외 설정: clp-df, clp-pulso, clp-yahoo. 출처별 이용 조건·수집 범위는 실행 시 별도 검사하며 등록/수집만으로 승인하지 않습니다.

## 아르헨티나 · ARS

11월9일 보존 관측: ars-iprofesional: 3건; ars-infobae: 4건. 발행 판단: `research_candidate`, 정기 점검 예정 2026-11-16. 조회 실패: []. 공식 지표 사유: 추가 사유 없음(모든 지표 완료 의미 아님).

| 출처 ID | 등록 URL | 자동 탐색 설정 | 구분 |
| --- | --- | --- | --- |
| ars-infobae | [https://www.infobae.com/economia/](https://www.infobae.com/economia/) | existing_adapter | supplemental |
| ars-cronista | [https://www.cronista.com/finanzas-mercados/](https://www.cronista.com/finanzas-mercados/) | excluded | specialist |
| ars-ambito | [https://www.ambito.com/](https://www.ambito.com/) | excluded | specialist |
| ars-yahoo | [https://finance.yahoo.com/](https://finance.yahoo.com/) | excluded | syndicated |
| ars-iprofesional | [https://www.iprofesional.com/finanzas](https://www.iprofesional.com/finanzas) | existing_adapter | specialist |

제외 설정: ars-cronista, ars-ambito, ars-yahoo. 출처별 이용 조건·수집 범위는 실행 시 별도 검사하며 등록/수집만으로 승인하지 않습니다.

## 공통 국제 자료

미국 연준 정책·BLS 물가 일정·H10 달러 자료·미 국채 금리, 구리(Cochilco)·유가(EIA)가 등록된 보조 경로입니다. 달러 흐름과 현지 통화의 관계는 같은 기간의 근거가 지지할 때만 설명합니다. 사이트 등록을 자동 수치·당일 인과 검증 완료로 확대하지 않습니다.
