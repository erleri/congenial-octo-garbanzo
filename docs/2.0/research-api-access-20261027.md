# 리포트 설명자료 API 연결과 사용자 준비 사항

2026-10-27 · 공식 안내 재확인 · 운영 연결·키 발급·인증 호출 없음

후속 실제 확인: 사용자 저장 토큰으로 [Banxico·INEGI 인증·자료 조회와 로컬 상태판](mexico-api-verification-20261027.md)을 확인했다. 아래 토큰 준비 안내는 보존한다. 두 인증 성공을 리포트용 지표 선정 완료로 확대하지 않는다.

## 지금 준비할 것

우선 준비할 인증은 **멕시코 Banxico와 INEGI의 별도 토큰**이다. 필요한 지표 번호와 정의도 함께 정해야 한다. 토큰만 등록했다고 소비자금리·소매·물가 연결이 모두 완성되는 것은 아니다. 이번 로컬 수집 명령은 환경 파일이나 키를 읽지 않으며, 인증 경로는 `configuration_required`로 반환한다.

1. **Banxico:** [공식 토큰 발급 화면](https://www.banxico.org.mx/SieAPIRest/service/v1/token)의 보안문자를 입력하고 `Generar token`을 누른다. 공식 설명은 요청마다 토큰이 필요하며 `Bmx-Token` 헤더와 쿼리 중 헤더를 우선한다고 안내한다. 연결할 때는 헤더를 사용해 URL·로그에 남기지 않는다. [공식 시작 안내](https://www.banxico.org.mx/SieAPIRest/service/v1/)에서 SF61745 정책금리를 확인했다. 실제 소비자대출 금리와 정책금리는 별도로 선택한다.
2. **INEGI:** [공식 API 안내](https://www.inegi.org.mx/servicios/api_indicadores.html)의 `Token` 항목에서 `registrarse aquí`를 이용한다. 안내 페이지에서 연결되는 [쿼리 구성기](https://www.inegi.org.mx/app/querybuilder2/default.html)로 지표·지역·자료원·버전을 정한다. 공개 안내의 예제 토큰을 재사용하지 않는다. 소매 EMEC와 물가 INPC의 대상·조정 여부·비교 기준을 확인해야 한다.

키는 채팅에 보내지 않는다. 후속 로컬 준비로 `.env.research.local`과 빈 예제 `.env.research.example`을 마련했다. 기존 OpenRouter·BCCh 설정은 유지한다. 브라우저용 `VITE_` 변수에 넣지 않는다.

### INEGI 발급과 로컬 저장

공식 안내 HTML의 `AbrePupupToken()`이 여는 [공식 토큰 신청 화면](https://www.inegi.org.mx/app/desarrolladores/generatoken/Usuarios/token_Verify)을 확인했다. `Dirección de correo electrónico`에 수신 가능한 이메일을 입력하고 `Obtener token`을 누른다. 화면은 토큰을 입력한 이메일로 보낸다고 안내한다. 팝업 차단 시 직접 링크를 이용한다. 신청·메일 수신은 사용자가 진행하며 에이전트가 개인정보를 제출하지 않았다.

저장 파일은 프로젝트 루트의 `.env.research.local`이다. 두 줄의 `=` 뒤에 각 값을 입력하고 저장한다.

```dotenv
BANXICO_SIE_TOKEN=
INEGI_INDICATORS_TOKEN=
```

이 파일은 기존 `*.local` 제외 규칙으로 Git에서 제외된다. 기존 파일이 있으면 덮어쓰지 않는다. 새 상태 확인 명령은 아래와 같으며 값·길이·해시·일부 문자열도 출력하지 않는다.

```powershell
npm.cmd run report:research:credentials
```

`missing`은 누락, `configured`는 값이 있고 기본 형식에 맞음, `format_check_required`는 형식 확인 필요다. 기관 인증은 모두 `not_tested`로 별도 표시한다. 상태 확인 자체는 네트워크·모델 호출 0회다. 전용 Node 도구만 해당 파일을 명시적으로 읽으며 다른 환경 변수·AI 설정과 섞지 않는다. 실제 인증 요청과 지표 수집 연결은 토큰 저장 후 진행한다. 이번에는 기관 인증 성공이나 6개국 수집 완성을 선언하지 않는다.

로컬 준비 검증: 설정·출력 비노출·중복/예상 밖 필드 거부 3사례, 타입·린트 확인. 기존 환율·원고·운영 설정은 변경하지 않았다.

## 국가별 구분

| 통화 | 설명자료 연결 방식 | 새 API 키 | 남은 준비 |
| --- | --- | --- | --- |
| BRL | BCB SGS 정책금리·IBGE 소매 공개 API, 정책 원문·일정 | 현재 선택 경로는 키 없이 요청 | 이번 BCB·IBGE 새 조회는 연결 실패. 기관 장애로 단정하지 않고 다른 시점·환경에서 응답을 확인. 품목·소비자금리 범위는 별도 선정 |
| MXN | Banxico SIE·INEGI 지표 API와 공개 기사·발표 문서 | 두 기관의 별도 토큰 필요 | 토큰·지표·단위 선택 후 인증 수집기 연결. 이번은 미설정 상태 반환 |
| COP | SFC가 연결한 datos.gov.co 공개 금융 자료, DANE·BanRep 원문 | 확인한 SFC 제한 조회는 인증 없이 성공한 저장 응답 재사용 | 소비자대출 종류·집계·최신 기간·단위 검증. 빈 응답을 최신 자료 없음으로 확대하지 않음 |
| PEN | BCRPData 금리 API, INEI 공개 문서 | BCRPData 조회에 새 키 불필요 | 은행권 MN·상품·만기·실효 연율 보존. 정확한 발표시각과 새 자료 여부 검토 |
| CLP | 기존 BCCh와 INE 월간 PDF·정책 원문 | BCCh 환율용 인증은 기존 보존. INE 공개 PDF에 새 키를 쓰지 않음 | BCCh 통계 인증을 모든 기사·정책 원문·다른 기관으로 확대하지 않음 |
| ARS | BCRA 통계 v4·INDEC 문서·공개 기사 | BCRA v4 문서는 인증 불필요 명시 | 필요한 실제 금리 변수를 선정하고 이용 목적·재배포 조건 확인. INDEC 가전은 분기 자료 |

BCRP 공식 [API 안내](https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/api)는 사전 로그인 없이 시리즈 매개변수로 조회할 수 있다고 설명한다. [사용 조건](https://estadisticas.bcrp.gob.pe/estadisticas/series/ayuda/condiciones-de-uso)은 출처 표시를 요구하며 외부 원천 통계의 책임을 구분한다. 이 조건을 기사 원문에 적용하지 않는다.

IBGE의 [공식 API 문서](https://servicodados.ibge.gov.br/api/docs/agregados?versao=3)는 집계·기간·변수·지역·분류를 조합하는 경로를 안내한다. 인증 준비보다 올바른 지표 선택과 응답 확인이 먼저다.

BCRA [공식 API 목록](https://www.bcra.gob.ar/apis-banco-central/)과 [v4 개발 문서](https://www.bcra.gob.ar/archivos/Catalogo/Content/files/pdf/principales-variables-v4.pdf)는 통계 v4의 인증 불필요·IP별 트래픽 제어를 명시한다. 공식 목록에서 v3는 폐기 일정이 지난 버전이므로 새 연결은 v4로 검토한다. 기존 이용 범위 미확정 기록은 유지한다.

## 뉴스와 비용

이번 뉴스 경로는 등록된 무료 공개 목록과 기사만 읽는다. 새로운 유료 뉴스 API·구독·검색 모델 계약은 없다. 로그인·유료 벽·접근 실패가 나오면 우회하지 않고 상태를 반환한다. 무료 열람·출처 표시만으로 기사 전체를 모델에 보내거나 재현할 권리가 생긴다고 처리하지 않는다. 별도 검토한 사실·귀속 견해 요지만 기존 카드 경로로 넘긴다.

이번 새 유료 호출·비용은 $0이다. 토큰 발급과 제공자 이용 한도·서비스 조건은 해당 기관의 최신 안내를 연결 시 다시 확인한다. OpenRouter 크레딧은 이 공개 자료 수집에 사용하지 않았다.
