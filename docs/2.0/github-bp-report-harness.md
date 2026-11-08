# LATAM FX 리포트 조사와 검토 하네스

## 결론과 적용 범위

리포트 품질을 높이기 위해 문체 지시를 계속 늘리는 대신, 독자의 질문을 먼저 정의하고 원문이 허용하는 설명을 집필 전에 정리한다. STORM의 질문과 목차 분리, Gemini 예제의 조사 공백 재검사, ReportBench의 문장과 출처 대조를 조합했다. 세 프로젝트는 금융 영업 리포트의 완성품이나 품질 보증이 아니라 설계 참고 자료다.

`report-harness/1`은 로컬 선택형 입력 준비와 저장 원고 평가 경로다. 기존 생성 명령·운영 경로·A안·과거 원고는 변경하지 않았다. 실제 검색과 생성의 비용 승인을 새로 받는 기능은 없다. 새 하네스가 준비한 요청을 실제로 전송하려면 기존 유료 실행기의 예약·가격·개인정보 조건 검사를 거쳐야 한다.

## 공개 검색과 실제 실행 연결 2026년 10월 8일

아래에서 준비한 두 요청은 사용자 승인 후 실행했다. [실제 원고·근거·비용 비교 결과](harness-comparison-results.md)에 새 하네스가 글의 품질을 높이지 못한 지점과 취사선택을 기록했다. 총 $0.02586975를 사용했고 자동 게시하지 않았다.

`public-research-adapter.js`와 `live-research-local.js`를 추가했다. 질문별 GDELT 검색과 허용된 공개 사이트의 원문 수집이 같은 하네스에 연결된다. BRL·MXN·CLP를 지원하며, 소비 질문은 환율 코드 없이 국가와 소비·물가·신용·소매를 검색하고 30일 범위를 사용한다. 후속 검색은 공식 사이트를 우선한다. 같은 URL이 여러 질문에 등장하면 모든 질문 연결을 보존한다.

검색의 최초 발견시각은 발행시각과 분리했다. 원문에서 최초 발행·수정 메타데이터를 수집하고, 칠레 등 해당 시장의 현지 날짜로 범위를 판단한다. JSON-LD 본문·검증된 기존 사이트 어댑터·단일 article 영역에서만 본문을 추출한다. 본문 영역이 없거나 페이지 접근이 실패하면 실패를 기록한다. 공개 원문을 다운로드했다는 사실이 검토 승인이 되지는 않는다. 최초 발행시각만으로 현재 본문이 당시에도 존재했다고 판단하지 않는다.

실제 칠레 사례에서는 공개 검색 네 요청이 연결 오류·HTTP 429·JSON이 아닌 응답으로 실패했다. 기존 DF와 La Tercera 원문 두 건은 수집됐다. 검색 실패를 관련 기사 부재로 바꾸지 않았으며 소비 질문은 미해결이다. API 키를 읽지 않았고 유료 모델 호출과 추가 API 비용은 0이다. 첫 수집 결과는 `.local-reports/private/harness-live/clp-do2cMo/research.json`, 공개 모델 경로 검사 결과는 `.local-reports/private/harness-live/clp-Vn3QGU/preflight.json`에 보존했다.

최종 현지 날짜 판정으로 다시 수집한 원문은 `.local-reports/private/harness-live/clp-2SiGnv/research.json`에 보존했다. La Tercera의 수정 메타데이터 `2026-10-06T00:06:56.703Z`는 칠레 현지로는 10월 5일이므로 다음 날 자료로 제외하지 않는다. 현재 페이지의 본문이 최초 발행 때와 같았다는 증거는 아니므로 역사적 본문 가용성은 미검증으로 유지한다. 기존 원고의 시각과 근거를 새 메타데이터로 덮어쓰지 않았다.

최종 검사에서는 전체 57개 파일의 418개 실행 사례와 타입·린트·운영 및 리포트 빌드·번들 경계가 통과했다. 신규 연결 검사는 10개이며 실제 AI 원고 평가 건수에 합산하지 않는다. 기존 대용량 번들 경고는 남아 있다.

별도 웹 조사에서 [INE의 2026년 9월 30일 상업활동 발표](https://www.ine.gob.cl/sala-de-prensa/prensa/general/noticia/2026/09/30/%C3%ADndice-de-actividad-del-comercio-anot%C3%B3-una-variaci%C3%B3n-de-0-0-interanualmente-en-agosto-de-2026)와 [예산국의 달러 매각 안내](https://www.dipres.gob.cl/598/w3-propertyvalue-25351.html)를 확인했다. 전자는 소비 환경 후보이며 당일 환율 원인이 아니다. 후자는 현재 공개된 안내로, 과거 기준일에 같은 본문이 있었는지 별도 확인이 필요하다. 이 자료는 기존 두 기사로 하는 입력 비교에 추가하지 않았다. GDELT 사용 조건은 [공식 DOC API 문서](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)를 확인했다.

### 준비한 생성 비교

`run-harness-comparison.js`는 새 실행 ID로 기존 입력과 하네스 입력을 각각 한 번 생성한다. 동일한 저장 packet, Gemini 3.8 Flash, medium 추론, Vertex Flex 경로와 출력 상한을 사용한다. 두 요청을 시작 전에 함께 예약하며 자동 재시도·모델 교체·자동 게시는 없다. 원고가 생성돼도 문장별 내용 검토는 별도로 필요하다. 중단·비용 미확인은 예약을 유지하고 같은 실행 ID는 다시 사용할 수 없다.

| 요청 | 보수적 입력 토큰 상한 | 출력 상한 | 신규 비용 예약 상한 |
| --- | --- | --- | --- |
| 기존 입력 | 28,493 | 16,384 | $0.08280975 |
| 하네스 입력 | 35,218 | 16,384 | $0.08785350 |
| 합계 | | | $0.17066325 |

이 표는 실제 청구액이 아니다. 과거 비용과 별개인 두 요청의 가격 제한에 따른 상한이며, 실행 전 경로·가격·ZDR·수집 금지를 다시 확인했다. 공개 카탈로그에서는 두 요청의 조건을 충족하는 경로를 확인했다. 신규 총예산 $0.18 승인 후 아래 명령을 실행했으며, 같은 실행 ID는 다시 사용할 수 없다.

```powershell
npm run report:harness:compare -- --plan .local-reports/private/harness-live/clp-Vn3QGU/comparison-plan.json --input .local-reports/private/clp-20261005-owned-content-trial-v1/snapshot.json --dossier .local-reports/private/harness-replays/clp-JEXZ1F/dossier.json --budget-usd 0.18 --run-id clp-20261005-harness-ab-v1
```

다음 독립 검토는 근거 충실도·새 정보 전달·설명 연결·영업 관련성·가독성을 같은 기준으로 비교한다. 신규 원문으로 자료를 확대하는 실험은 이 입력 비교 이후 별도 진행한다.

## 확인한 저장소와 실제 코드

세 저장소를 `Documents/Codex/.bp-reference/`에 shallow clone했다. 외부 코드는 실행하거나 의존성으로 설치하지 않았다. 아래 커밋의 코드를 읽었으며 기존 라이선스 파일도 보존한다. 구현은 설계 원리를 적용한 별도 JavaScript 코드이며 Python 코드를 복사하지 않았다.

| 저장소 | 고정 커밋 | 라이선스 |
| --- | --- | --- |
| STORM | `fb951af7744dab086e34962e9bc6fe878e145f83` | MIT |
| Gemini fullstack LangGraph quickstart | `e34e569de465340e42f36cd3cab4fac0c3ce7036` | Apache 2.0 |
| ReportBench | `ca3d65b9ff3136fd7e6107955eeb711b2a7fd894` | Apache 2.0 |

### STORM의 질문과 집필 분리

[knowledge_curation.py](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/knowledge_storm/storm_wiki/modules/knowledge_curation.py)의 `ConvSimulator`는 관점별 질문과 검색 기반 응답을 대화 기록에 남기고 최대 턴 수를 제한한다. `TopicExpert`는 질문을 검색어로 변환하고 중복을 제거한다. 검색 결과가 없으면 답을 만들어내지 않는다. 다만 답변 단계에서 각 결과의 첫 snippet을 사용하므로, 우리 원문·이웃 문맥 검사를 대체하지 않는다.

[persona_generator.py](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/knowledge_storm/storm_wiki/modules/persona_generator.py)는 유사 주제의 목차로 관점을 만든다. LATAM FX에서는 고정된 독자와 짧은 분량에 맞춰 시장 관측·국가 요인·글로벌 요인·반대 조건·소비 환경·관찰 변수라는 여섯 질문을 사용한다. 매일 가상 전문가를 여럿 생성하는 비용은 추가하지 않는다.

[outline_generation.py](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/knowledge_storm/storm_wiki/modules/outline_generation.py)는 초안 목차를 조사 대화로 보완한다. [article_generation.py](https://github.com/stanford-oval/storm/blob/fb951af7744dab086e34962e9bc6fe878e145f83/knowledge_storm/storm_wiki/modules/article_generation.py)는 절별로 관련 근거를 찾아 집필한다. 우리는 고정된 A안 안에서 설명별 근거를 배정하되, 근거가 없는 절은 채우지 않는다. 장문 백과사전 목차와 절별 병렬 모델 호출은 도입하지 않았다.

### Gemini 예제의 조사 공백 반복

[graph.py](https://github.com/google-gemini/gemini-fullstack-langgraph-quickstart/blob/e34e569de465340e42f36cd3cab4fac0c3ce7036/backend/src/agent/graph.py)의 단계는 질문 생성, 검색, reflection, 추가 검색 또는 최종 답변이다. `reflection`은 충분성·부족한 지식·후속 질문을 구조화한다. `evaluate_research`는 충분하다는 판단 **또는 최대 반복 도달** 시 집필로 이동한다.

우리는 질문별 공백 기록과 제한된 재조사만 채택한다. 횟수 소진은 충분한 근거를 뜻하지 않으므로 필수 공백이 남으면 입력 준비를 보류한다. 검색 결과를 원문 검토 완료로 승격시키지 않는다.

[prompts.py](https://github.com/google-gemini/gemini-fullstack-langgraph-quickstart/blob/e34e569de465340e42f36cd3cab4fac0c3ce7036/backend/src/agent/prompts.py)의 검색어 다양성과 중복 방지, [utils.py](https://github.com/google-gemini/gemini-fullstack-langgraph-quickstart/blob/e34e569de465340e42f36cd3cab4fac0c3ce7036/backend/src/agent/utils.py)의 grounding 정보와 URL 연결도 확인했다. 우리는 기존 근거 ID와 원문 해시를 유지한다. 과거 사례에는 예제의 현재 날짜 프롬프트 대신 고정 기준일을 넣는다. Google API·LangGraph·별도 서버는 추가하지 않는다.

### ReportBench의 문장 단위 대조

[match_text.py](https://github.com/ByteDance-BandAI/ReportBench/blob/ca3d65b9ff3136fd7e6107955eeb711b2a7fd894/statement/match_text.py)는 주장을 지지하는 원문 구절을 찾고, [verify_alignment.py](https://github.com/ByteDance-BandAI/ReportBench/blob/ca3d65b9ff3136fd7e6107955eeb711b2a7fd894/statement/verify_alignment.py)는 주장이 그 구절로 지지되는지 따로 판정한다. [prompts.py](https://github.com/ByteDance-BandAI/ReportBench/blob/ca3d65b9ff3136fd7e6107955eeb711b2a7fd894/statement/prompts.py)는 인용 있는 문장과 없는 사실 주장을 분리한다. 단순히 유효한 링크가 있다는 이유로 사실 검증을 통과시키지 않는 구조를 채택한다.

그대로 가져오지 않을 부분도 있다. 원문 파일이나 검사 실패 시 일부 행을 건너뛰고, 최종 alignment 비율을 남은 행으로 계산한다. 우리는 누락·실패 문장도 전체 분모에 남긴다. `verify_no_citations_web.py`의 다중 웹 모델 투표는 비용이 커지고 다수결이 진실을 보장하지 않아 제외한다. 학술 참고문헌과의 중첩 점수도 영업 리포트의 인사이트 점수로 사용하지 않는다.

## 기존 구현과의 취사선택

| 영역 | 기존 상태 | 결정과 이유 |
| --- | --- | --- |
| 조사 범위 | 칠레 직접 조사 시험은 검색 2회·원문 fetch 2회, 이후 동일 자료 반복 | 질문별 조사 계획으로 대체. 기사 수 대신 답하지 못한 질문을 기록한다. 기존 시험 기록은 보존한다. |
| 근거 정리 | 원문 선택 구절·이웃 문맥·해시·채택 범위 | 유지. 새 카드는 이 위에 질문·사건·귀속·독립성·사용 범위를 연결한다. |
| 집필 입력 | 전체 근거와 공통 지시·합성 예시 | 선택형 경로에서는 질문별 집필 계획과 같은 사건의 조건·관찰을 묶는다. 과거 공급 사례를 연상시키는 합성 집필 예시는 제외한다. |
| 목차 | A안의 고정 절 | 유지. 절을 채우기 위해 내용을 생성하지 않으며 소비 근거 없으면 생략한다. |
| 계산·관측시각·USD 환산 | 코드가 계산·표시·조건 고정 | 유지. 연구 예제의 자유로운 수치 생성으로 교체하지 않는다. |
| 문장별 대응표 | 모델이 본문과 ledger를 함께 생성 | 당장 제거하지 않는다. 형식 누락을 별도 지표로 표시한다. 자동 분할만으로 인과 근거가 승인된 것처럼 만들지 않는다. |
| 내용 검사 | 문장별 세부 주장·원문 인용·원리 조건 대조 | 유지. 인용 없는 문장·대응표 누락·검토 누락을 분리 집계한다. |
| 교정 | 오류와 문체 구분, 최대 한 번 교정 후 재검토 | 유지. 이번에 또 다른 교정 루프나 자동 모델 교체를 만들지 않는다. |
| 품질 점수 | 의미 검토와 독자 관점 평가 | 유지·분리. 인용 연결률을 읽을 가치나 사실 정확도로 포장하지 않는다. |
| 비용과 개인정보 | 예약·미확인 비용 유지·ZDR·공개 자료 투영 | 유지. 외부 프로젝트의 무제한 재시도·웹 모델 다중 투표는 제외한다. |
| 도입 형태 | 기존 Node·React·OpenRouter | 유지. Python·DSPy·LangGraph 패키지를 서비스에 추가하지 않는다. |

## 새 하네스의 동작

### 조사 계획과 원문 채택

`research-harness.js`의 `researchPlan`은 통화·기준일에 맞는 여섯 질문과 검색어를 만든다. BRL·MXN·CLP·COP·ARS·PEN을 지원하며 다른 통화는 명시적으로 거부한다. 기본 재생 한도는 두 라운드, 여덟 검색어, 후보 스물네 개다. **이 수치는 실제 API 호출의 승인이나 비용 상한이 아니다.**

원문 채택 카드는 다음 정보를 갖는다.

- 답하는 질문, 관련 사건, 인용 주체의 독립성 그룹.
- 원문 ID·해시·구절 ID, 같은 날 또는 이전 맥락 여부.
- 사실 또는 출처에 귀속한 해석, 지지·조건·모순 구분.
- 사용할 수 있는 설명과 넘어서는 안 되는 범위.
- 카드 검토자 유형과 검토 이유. 모델의 생성 결과로 자동 승인하지 않는다.

`inspectDossier`는 원문 변경·미검토 출처·기간·통화·구절 누락·귀속 누락을 검사한다. 모순된 근거는 수로 투표하지 않고 공백으로 남긴다. 같은 사건을 다루는 기사 수로 중요도를 매기지 않는다. independentVoices는 검토자가 정한 인용 주체 그룹 수이며 객관적 독립성을 자동 판정한 결과가 아니다.

`runResearch`는 부족한 질문 또는 명시적으로 재검사할 질문을 검색 어댑터에 전달하고, 별도 원문 검토 콜백 뒤 공백을 다시 계산한다. 환율 입력을 중간에 바꾸면 중단한다. 후보 URL은 추적 매개변수와 fragment를 정리해 중복을 제거한다. 원문 검토 전에는 모두 후보 상태다. `replayResearch`는 오프라인 재생으로 한정한 호환 진입점이다. 실제 공개 검색·수집과 새 비교 실행기는 위 10월 8일 연결에 기록했다.

### 근거 중심 집필 입력

`compileBrief`는 같은 사건의 배경·조건·관찰 카드를 연결한 storylines와 절별 자료를 만든다. `harnessRequest`는 기존 writer 계약에 이를 연결한다. 필수 질문이 부족하거나 카드가 유효하지 않으면 `request: null`로 집필 입력 생성을 막는다.

기존 `requestBody`와 `generateCandidate`에도 선택적 `researchDossier` 입력을 연결했다. 이를 명시하면 같은 공백 검사와 엄격한 개인정보 조건을 거쳐 전송 직전의 공통 입력에 반영된다. 누락 질문이 있으면 전송 전에 거부한다. 이 입력을 주지 않은 과거 경로의 요청은 유지된다. 이번에는 해당 전송을 실행하지 않았다.

근거가 있다는 것은 시장 원인 전체를 확정했다는 뜻이 아니다. 칠레 사례는 실제 저장 관측시각이 없으므로 기사 속 이후 장중 맥락이라는 범위를 유지한다. `ready_for_draft`는 검토 초안을 준비할 수 있다는 뜻이며 게시 가능 상태가 아니다.

### 빠뜨리지 않는 원고 검사

`auditHarnessReport`는 제목·요약·소제목·본문의 모든 문장을 원문 해시에 연결한다. 분류는 코드 소유, 출처 연결, 무인용, 대응표 미연결, 잘못된 참조다. 기존 `prepareClaimReview`와 `assessClaimReview`를 재사용하므로 검사 규칙을 새 파일에 복제하지 않는다.

검토 응답이 잘못됐거나 없으면 해당 결과를 성공으로 세지 않는다. 모든 문장은 전체 분모에 남으며, 문체 권고와 필수 교정은 별도 항목이다. 독자 가치 검토는 원문 지지 검토와 별도로 미검증 상태에서 시작한다. 자동 검사와 에이전트 판단 모두 게시 승인을 만들지 않는다.

## 칠레 저장 원고에 적용한 결과

대상은 2026년 10월 5일 사례이며 현재 시장 분석이 아니다. 기존 원문 두 개에서 명시적으로 검토한 카드 여섯 개를 만들었다. 원본 자료·원고·비용 파일은 바꾸지 않았다.

| 확인 항목 | 결과 |
| --- | --- |
| 질문별 자료 | 시장·현지 요인·글로벌 대비·반대 조건·관찰 변수에 카드 있음 |
| 소비 맥락 | 원문 부족. 후속 검색 질문으로 남기고 입력에서 생략 |
| 직접 공식 원문·실제 집행 | 미확보. 보도 귀속 범위를 유지 |
| 원고 문장 | 16개, 그중 코드 소유 3개 |
| 명시적 문장 대응 | 출처 연결 4개, 문장 단위 미연결 9개 |
| 기존 내용 검토 재사용 | 필수 교정 1개, 선택적 문체 개선 4개 |
| 원고와 원래 비용 | 원고 해시 유지, 원래 생성 비용 $0.009462375 유지 |
| 이번 새 API·검색 비용 | $0, 실제 호출 없음 |

미연결 아홉 문장은 아홉 가지 사실 오류라는 뜻이 아니다. 일부 대응표가 문단 단위로 작성돼 문장별 연결을 확인할 수 없는 상태다. 기존 내용 검토의 지지 판정도 사람 승인이나 객관적 정답으로 바꾸지 않았다. 새 입력의 실제 생성 품질 향상과 비용은 아직 측정하지 않았다.

같은 무료 모델 요청 계약으로 비교한 직렬화 크기는 기존 25,571바이트, 새 입력 32,296바이트다. 근거 사용 범위를 명시하면서 입력이 늘었다. 바이트 수는 토큰 수나 실제 비용이 아니며, 비용 절감으로 보고하지 않는다. 다음 실제 실행 전에 선택한 모델의 입력·출력 한도와 합산 예약 예산을 다시 검사해야 한다. 최종 재생 결과는 `.local-reports/private/harness-replays/clp-JEXZ1F/`에 저장했다.

## 실행과 남은 연결

`npm run report:harness:replay`는 `.local-reports/private/harness-replays/` 아래 새 폴더에 카드, 집필 입력, 조사 공백, 문장 검사, 기존 대비 결과를 저장한다. 환경 파일을 읽거나 네트워크 요청을 보내지 않는다. 저장된 칠레 시험 자료가 없는 다른 PC에서는 그 자료를 먼저 복원해야 한다. 단위 테스트는 합성 자료로 독립 실행된다.

검증 책임은 `research-harness.test.ts` 한 파일에 모았다. 질문 편중, 오래된 카드, 미검토 원문, 미래 자료, 상충 자료, 선택 항목 생략, 반복 중단, 입력 보존, 실패 분모와 문장 대응을 검사한다. 기존 수치·API·예산·내용 금지 검사표는 반복하지 않는다.

타입 검사·린트·전체 56개 테스트 파일의 408개 실행 사례·운영 및 리포트 빌드·번들 경계 검사를 통과했다. 이번에 추가한 검사는 신규 하네스 책임 14개이며 실제 AI 품질 평가 건수에 더하지 않는다. 동일 이름·동일 본문·자기 비교 검사 탐지는 0건이지만 의미적으로 모든 테스트가 고유하다는 증명은 아니다. 운영 빌드의 기존 500kB 이상 chunk 경고는 남아 있다. UI 코드는 변경하지 않아 이번에는 브라우저 시각 검사를 반복하지 않았다.

공개 검색·수집 연결은 구현됐으나 실제 검색의 가용성 문제와 신규 근거 채택은 남아 있다. 다음 유료 비교는 위 두 요청의 신규 예산을 승인받아 실행한다. 같은 자료로 기존 입력과 새 입력을 비교하는 시험과, 추가 조사로 자료 자체를 개선하는 시험은 분리한다. 그래야 문체 변화와 근거 확장의 효과를 구별할 수 있다. 권장 개발 모델은 연결 구현에 GPT-6.1 Sol High, 원문과 원고의 독립 내용 검토에 GPT-6 Astra High다.
