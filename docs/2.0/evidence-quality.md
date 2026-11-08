# 통화별 원인 리포트의 발행 게이트

## 목적

모델의 문장 품질과 별개로, 환율 움직임과 공개 근거가 보고서를 발행하기에 충분한지를 먼저 판정한다. 이 게이트를 통과하지 못한 날에는 AI를 호출하지 않고 기존 보고서를 유지한다.

## 변동 판정

- 기준 수치: `LOCAL_PER_USD`의 전 관측일 대비 변화율. 양수는 현지통화 약세, 음수는 현지통화 강세다.
- 비교 표본: 현재 관측치를 제외한 최근 최대 60개 일간 절대변동률.
- `sharp`: 당일 절대변동률이 `max(1.50%, 표본 95백분위)` 이상.
- `notable`: 당일 절대변동률이 `max(0.75%, 표본 80백분위)` 이상.
- `calm`: 위 기준 미만. 새 원인 리포트를 만들지 않는다.
- 표본이 20개 미만이면 한계 문구를 붙이고 절대변동률 하한을 우선한다.

이는 통계적 이상치 탐지이며 경제적 중요도 자체를 뜻하지 않는다. 통화별 데이터가 축적되면 임계값은 과거 사례 평가를 거쳐 조정한다.

## 원인 근거 판정

근거에는 범위(`global`, `country`, `sales_context`), 역할(`trigger`, `context`), 인과 수준(`confirmed`, `source_attributed`, `contextual`)을 기록한다.

- 날짜만 있는 자료는 배경 설명에는 쓸 수 있지만 급변의 직접 계기로 사용하지 않는다.
- 급변 보고서에는 시각과 시간대가 있는 환율 관측과 `trigger` 근거가 최소 한 건씩 필요하다. 환율 자료에 날짜만 있으면 일중 선후 관계를 확정하지 않는다.
- 사건이 환율 관측보다 먼저였다는 사실만으로 인과관계가 증명되지는 않는다.
- 직접 원인이 확인되지 않으면 `sharp_move_without_timed_trigger`로 발행을 보류한다.
- 공식 자료의 문구가 원인을 명시하면 `source_attributed`, 사건과 시장 반응의 인과가 공식적으로 확인된 경우에만 `confirmed`로 분류한다.

근거 출처도 분리한다. 중앙은행·통계청은 `official`, 기존 Alpha Vantage 뉴스 피드에서 가져온 공개 보도는 `market_reporting`이다. 시장 보도는 현재 Reuters 도메인만 자동 후보로 받고, 추적 쿼리를 제거하며, 통화·달러 연관성·발행 시각·악성 지시문을 검사한다. 자동 수집된 보도는 항상 `contextual`로 시작하므로 사람의 검토 없이 급변 원인으로 승격되지 않는다.

### 다중 출처 발견 단계

Alpha Vantage에서 후보가 없을 때 원인을 추정하지 않는다. 대신 `npm run report:local -- --mode live-local --action discover-evidence --currency CLP --date YYYY-MM-DD`처럼 GDELT DOC 2.0의 최근 기사 검색을 별도 실행한다. BRL·MXN·CLP를 지원하며 기준일 전날부터 기준일까지 한 번의 범위 제한 검색을 수행한다.

- 결과는 `.local-reports/discovery/`에만 저장하며 공개 보고서 근거 폴더와 분리한다.
- API 응답에는 기사 본문이 아니라 제목·원문 URL·발행시각·언어·출처 국가만 보존한다.
- Reuters는 `trusted_reporting_review`, 검토 목록에 등록한 현지 경제지는 `local_reporting_review`, 그 밖의 매체는 `discovery_only`로 분류한다. 어느 등급도 자동으로 `trigger`나 `source_attributed`가 되지 않는다.
- BCB·Banxico·칠레 중앙은행의 공식 발표·캘린더 링크를 검토 대상으로 함께 기록한다. 링크가 존재한다는 사실만으로 해당 날짜에 사건이 있었다고 판단하지 않는다.
- GDELT의 정확한 시작·종료 시각 검색은 최근 3개월 범위로 제한되므로, 오래된 10개 사례의 당시 근거를 이 경로만으로 재현할 수 없다. 이 경우 `outside_gdelt_window`로 기록하고 별도 자료 조사 대상으로 남긴다.

수집 후 `npm run report:local -- --mode live-local --action prepare-evidence-review --currency CLP --date YYYY-MM-DD`로 읽기 전용 검토 자료를 만든다. 로컬 디자인 스튜디오를 `live-local` 모드로 열면 `근거 검토` 화면에서 다음을 같은 시간축으로 확인할 수 있다.

- 전 관측일·기준일 환율과 변동 방향
- 환율의 일중 관측시각 유무
- 기사 발행시각과 출처 검토 등급
- 각 후보가 근거로 사용될 수 없는 구체적 사유
- 중앙은행 발표·캘린더 원문 확인 링크

검토 화면은 결정을 쓰거나 근거를 승격하지 않는다. 원문을 열어 직접 귀속 문구와 사건시각을 확인하고 독립 출처로 대조하기 전까지 `causalConclusion=unconfirmed`, `publicationBlocked=true`를 유지한다. 발견 후보 파일과 검토 자료는 모두 Git에서 제외된 로컬 경로에만 둔다.

### 현지 공개 소스 직접 발견

검색 모델이 현지 시장 기사를 놓치는 경우를 줄이기 위해 통화별 공개 sitemap 어댑터를 둔다. 첫 구현은 CLP이며 Emol 경제와 Reporte Minero의 공개 sitemap에서 기준일과 전날의 후보 URL을 찾고, 허용된 기사 URL의 공개 메타데이터만 읽는다.

```powershell
npm.cmd run report:local -- --mode live-local --action discover-local-sources --currency CLP --date YYYY-MM-DD
npm.cmd run report:local -- --mode live-local --action prepare-evidence-review --currency CLP --date YYYY-MM-DD
```

- 허용 도메인·경로·기간을 코드에 고정하고 리디렉션, 비표준 포트, 과대 응답, 악성 지시문·이메일 패턴을 차단한다.
- 소스당 환율 변동 직접 보도를 먼저 선택하고 시장 배경 후보 수를 제한한다. 기사 본문은 저장하지 않고 제목·설명·URL·발행시각만 검토 자료에 보존한다.
- 발행시각에 오프셋이 없으면 소스별 현지 시간대를 적용하며 그 변환 방식을 후보에 표시한다.
- 결과는 언제나 `evidenceReady=false`, `causalStatus=unassessed`다. 기사 제목이 원인을 단정해도 사람이 원문과 독립 출처를 확인하기 전에는 보고서 근거로 승격하지 않는다.
- 같은 레지스트리·계약으로 다른 통화를 추가할 수 있지만, BRL·MXN 등은 각 국가의 허용 소스·URL 구조·시간대·이용 조건을 별도로 확인하고 테스트하기 전에는 지원한다고 간주하지 않는다.
- 2026-09-11 CLP 실검증에서 두 sitemap과 제한된 기사 메타데이터만 조회해 Emol·Reporte Minero 후보를 확보했다. 이 결과는 발견 성공이며 인과관계 승인 결과가 아니다.

### OpenRouter 보강 검색 실험

파일럿에서는 일간 절대변동률이 1% 이상인 CLP 변동인데 기존 후보 중 검토 가능한 출처가 하나도 없을 때만 다음 검색을 수동으로 실행할 수 있다. 검색은 보고서 생성과 분리되며 같은 OpenRouter 키를 사용한다. 통계 기반 `sharp/notable` 판정과의 통합은 사례 평가 후 결정한다.

```powershell
npm.cmd run report:local -- --mode live-local --action search-evidence --currency CLP --date YYYY-MM-DD
npm.cmd run report:local -- --mode live-local --action prepare-evidence-review --currency CLP --date YYYY-MM-DD
```

- 허용 도메인은 Emol, Diario Financiero, La Tercera, Reporte Minero, 칠레 중앙은행, Cochilco로 제한한다.
- 기본 검색 모델은 `perplexity/sonar`다. 리포트 작성 모델 설정과 무관하며 자동 유료 전환은 하지 않는다.
- 검색 결과는 최대 6개이며 URL·제목만 후보로 보존한다. 발행시각과 직접 귀속을 다시 확인하기 전에는 `evidenceReady=false`, `causalStatus=unassessed`다.
- 후보가 있어도 자동 게시하지 않는다. 검색 결과가 빈약하면 기존 보고서를 유지한다.
- 2026-09-11 CLP 실험에서 Sonar는 검색1회, 후보3개, 비용 `$0.00527`을 기록했지만 모두 칠레 중앙은행 일반 자료였다. 수동 조사에서 발견한 당일 현지 시장 보도는 찾지 못했으므로 품질 합격으로 간주하지 않는다.
- 같은 사례에서 Nemotron 설정은 HTTP404, `openrouter/free`는 HTTP429, GPT-4.1 Nano와 선택형 서버 검색은 모델이 검색을 실행하지 않는 결과가 있었다. 실패 기록과 호출 슬롯을 삭제하지 않았다.

OpenRouter의 선택형 `openrouter:web_search` 서버 도구는 모델이 검색 여부를 결정하므로 비용 상한만으로 검색 실행을 보장하지 않는다. 현재는 통합 검색형 Sonar를 로컬 비교 대상으로만 유지한다. 검색 품질이 충분하다는 결론 전에는 운영 경로에 연결하지 않는다.

[GDELT DOC 2.0 문서](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)는 ArticleList JSON, 정확한 시작·종료 시각과 최대 결과 수를 설명한다. GDELT의 검색·추출 결과 자체가 기사의 정확성이나 환율 인과관계를 보증하지 않는다는 전제로 사용한다. Investing.com의 비공개 화면 엔드포인트나 HTML 스크래핑은 이 수집 경로에 포함하지 않는다.

[OpenRouter 웹 검색 문서](https://openrouter.ai/docs/guides/features/server-tools/web-search)는 서버 검색 도구가 0회 이상 호출될 수 있고 결과 수·호출 수를 제한할 수 있다고 설명한다. 이 베타 기능의 동작과 가격은 변경될 수 있으므로 실제 응답의 사용량을 기록한다.

[BCB Copom 안내](https://www.bcb.gov.br/en/monetarypolicy/committee)는 결정을 회의 당일 18시 30분 이후 공개한다고 설명하며 [정책 성명 아카이브](https://www.bcb.gov.br/en/monetarypolicy/copomstatements/cronologicos)와 [RSS 안내](https://www.bcb.gov.br/en/about/rssen)를 제공한다. [Banxico 정책결정 아카이브](https://www.banxico.org.mx/publicaciones-y-prensa/anuncios-de-las-decisiones-de-politica-monetaria/anuncios-politica-monetaria-t.html)도 원문을 공개한다. 반면 [INEGI 지표 API 문서](https://www.inegi.org.mx/servicios/api_indicadores.html)는 유효한 토큰이 필요하다고 명시한다. [Alpha Vantage NEWS_SENTIMENT 문서](https://www.alphavantage.co/documentation/)의 시간 값은 UTC 계약으로 해석한다. 이 차이를 숨기지 않고 수집 상태에 반영한다.

## 과거 사례 후보

`npm run report:local -- --mode live-local --action cases`는 저장소 전체 이력에서 BRL·MXN 각 급변 3건과 평온 1건, CLP 급변 2건 등 총 10건을 고른다. 결과는 Git에서 제외된 로컬 경로에 저장된다. 날짜와 변화율만 계산하며 원인을 주장하지 않는다. 각 사례의 당시 공개 근거를 별도로 조사하기 전 상태는 `unresearched`다.

이 10건은 임계값과 설명 품질을 평가하는 시작점이지, 당시 이용 가능 데이터가 재현된 백테스트는 아니다.
