# 중남미 환율 대시보드

중남미 주요 통화 환율을 조회하고 비교하는 React + TypeScript + Vite 기반 대시보드입니다.

운영 URL:
- https://latamforex.netlify.app/

## 로컬 실행

```bash
npm install
npm run dev
```

## 데이터 파이프라인 설계안

현재 운영 경로는 GitHub Actions + Netlify 기준으로 설계되어 있습니다.

1. GitHub Actions가 하루 1회 또는 수동 실행으로 정적 데이터 파일을 생성합니다.
2. 생성 결과는 public/data.json 에 저장됩니다.
3. Actions가 변경된 data.json 을 main 브랜치에 커밋합니다.
4. Netlify가 main 변경을 감지해 자동 배포합니다.
5. 앱은 초기 로딩 시 public/data.json 을 우선 읽고, 실패 시 브라우저 캐시와 실시간 API 경로로 폴백합니다.

이 구조의 목적은 다음과 같습니다.

- 초기 로딩 시간 단축
- 사용자 수 증가 시 외부 API 호출 폭증 방지
- Alpha Vantage 같은 제한형 API 의존도 완화
- 운영 배포마다 같은 데이터 스냅샷 제공

## 수동 데이터 생성

```bash
npm run generate:data
```

생성된 결과는 public/data.json 에 저장됩니다.

## GitHub Actions 설정

워크플로우 파일:
- .github/workflows/generate-data.yml

선택적 시크릿:
- VITE_EXCHANGERATE_API_KEY
- VITE_ALPHA_VANTAGE_API_KEY

시크릿이 없어도 기본 fallback 경로로 동작하지만, 있으면 데이터 품질과 안정성이 더 좋아집니다.

## 현재 로딩 우선순위

1. IndexedDB 캐시를 즉시 표시
2. public/data.json 이 있으면 그 값을 우선 적용하고 캐시 갱신
3. 정적 데이터가 없을 때만 실시간 API 로딩
4. 캐시가 신선하면 자동 재수집 생략

## 배포 흐름

1. 기능 코드 변경 시 main 푸시
2. Netlify가 자동 배포
3. 데이터만 갱신할 때는 GitHub Actions가 public/data.json 커밋
4. 그 커밋도 Netlify 자동 배포를 트리거
