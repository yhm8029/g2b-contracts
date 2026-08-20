# 나라장터 경쟁사 영업성과

나라장터 입찰 공고와 계약 데이터를 수집·정제해 빌딩자동제어장치 조달우수업체의 영업 실적을 분석하는 도구다. Next.js 15 기반 웹 앱과 로컬 SQLite 데이터베이스, 그리고 Tauri 기반 포터블 Windows 실행 파일 빌드 경로를 함께 제공한다.

## 핵심 기능

- **계약 조회**: 나라장터 일반·공개 표준 계약 데이터의 인덱스 조회 및 후속 상세 보강
- **경쟁사 영업 실적**: 월·분기·년 단위로 빌딩자동제어장치 카테고리 계약만 추려 집계
- **조달우수업체 현황**: 세부품명번호 `39121801`(세부 `3912180101`) 기준으로 등록된 조달우수업체 목록과 지정 기간 제공
- **데이터 내보내기**: 경량 Excel 워크북(xlsx) 생성 지원

## 집계 기준

경쟁사 영업 실적은 다음 조건을 모두 충족하는 계약만 집계한다.

- 세부품명번호 `3912180101` (빌딩자동제어장치) 품목이 포함된 계약
- 등록된 조달우수업체 22개사 사업자등록번호와 일치하는 계약
- `각수요기관` 단가상한 공고로 파생된 데이터셋의 `제3자 단가계약` 케이스는 제외
- 변경계약은 동일 계약의 최신 변경 이력으로 합치고, 원계약 일자 기준으로 기간 귀속 판정

## 데이터 처리 흐름

1. `npm run db:init` 으로 Drizzle 스키마와 필수 인덱스 생성
2. (선택) `npm run contracts:import -- <path-to-csv>` 로 나라장터 계약 인덱스를 SQLite에 적재
3. (선택) `ENRICHMENT_ENABLED=true` 환경에서 `npm run contracts:enrich -- <record-id>` 로 특정 레코드의 상세 항목을 보강
4. Next.js 페이지에서 집계 결과를 조회: `/`(일반 계약 조회), `/competitors`(경쟁사 영업 실적)

## 빠른 시작

```powershell
git clone https://github.com/yhm8029/g2b-contracts
cd g2b-contracts
npm install
Copy-Item .env.local.example .env.local
npm run db:init
npm run dev
```

계약 인덱스를 함께 적재하려면 `Copy-Item .env.local.example .env.local` 단계에서 내려받은 CSV로 다음을 실행한다.

```powershell
npm run contracts:import -- <계약 인덱스 CSV 경로>
```

상세 보강까지 수행하려면 `.env.local` 의 `ENRICHMENT_ENABLED` 를 `true` 로 바꾼 뒤 `DATA_GO_KR_SERVICE_KEY` 를 채우고 보강할 레코드 ID를 지정해 실행한다.

```powershell
npm run contracts:enrich -- <record-id>
```

`<record-id>` 는 `enrich-g2b-details.ts` 가 검증하는 양의 정수 레코드 ID여야 한다.

## 환경변수

| 변수 | 설명 |
| --- | --- |
| `DATABASE_PROVIDER` | 데이터 저장소 종류. 기본값 `sqlite` |
| `DATABASE_URL` | SQLite 파일 경로. 예: `./data/g2b-contracts.sqlite` |
| `DATA_GO_KR_SERVICE_KEY` | 공공데이터포털 서비스 키. 상세 보강과 포터블 번들에서 사용 |
| `ENRICHMENT_ENABLED` | 상세 보강 단계 활성화 여부. 기본값 `false` |

## 주요 명령어

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | Next.js 개발 서버 실행 |
| `npm run build` | Next.js 프로덕션 빌드 |
| `npm test` | Vitest 단위 테스트 실행 |
| `npm run db:init` | Drizzle 기반 데이터베이스 초기화 |
| `npm run contracts:import -- <path-to-csv>` | 나라장터 계약 인덱스 CSV를 SQLite에 적재 |
| `npm run contracts:enrich -- <record-id>` | 공공데이터 상세 보강 (양의 정수 레코드 ID 필수) |
| `npm run build:portable` | Tauri 기반 Windows 포터블 실행 파일 생성 |
| `npm run test:portable` | 포터블 빌드 산출물 검증 스크립트 실행 |

## 포터블 앱 빌드

Tauri 기반 Windows 포터블 실행 파일은 다음 명령으로 생성한다. PowerShell 스크립트가 프런트엔드 빌드와 Tauri 번들링을 순차로 처리한다. 포터블 앱은 Windows 전용이다.

```powershell
npm run build:portable
npm run test:portable
```

생성된 산출물은 기본적으로 `<repo>/dist/<한글 애플리케이션 이름>` 폴더로 조립되며 저장소에는 커밋하지 않는다. 폴더 이름은 `scripts/build-tauri-portable.ps1` 의 `FolderName` 인자로 덮어쓸 수 있다.

## 데이터 출처와 한계

- 원본 데이터는 조달청 나라장터와 공공데이터포털의 계약 정보에 한정한다.
- 집계는 등록된 조달우수업체의 사업자등록번호와 세부품명번호 `3912180101` 일치 여부만을 기준으로 하므로, 용역 세분류 명칭이 다른 실제 공사나 자재 거래는 누락될 수 있다.
- 변경계약은 동일 계약 버전으로 묶어 합산하며, 원계약 일자가 집계 기간 밖이면 해당 기간 실적에서 제외한다.
- `ENRICHMENT_ENABLED=false` 상태에서는 보강된 상세 정보가 비어 있을 수 있다.

## 보안 주의사항

- `DATA_GO_KR_SERVICE_KEY` 등 비밀 값은 `.env.local` 에서만 관리하고 저장소에 커밋하지 않는다.
- `<repo>/dist/` 등 로컬 빌드 산출물과 데이터 파일은 `.gitignore` 로 차단되며 커밋 대상에 포함하지 않는다.
- 포터블 빌드 스크립트(`scripts/build-tauri-portable.ps1`)는 `.env.local` 전체를 번들하지 않는다. 단, 허용된 키인 `DATA_GO_KR_SERVICE_KEY` 값은 비어 있지 않을 때 `config/app.env` 로 복사될 수 있으므로, 배포 전에 조직의 키 관리 정책(예: 키 회전, 접근 통제, 배포 채널별 키 분리)을 반드시 확인한다. 키 자체는 절대 코드나 README 같은 평문 저장소에 적지 않는다.
- 포터블 빌드는 `src-tauri/tauri.conf.json` 의 기본 식별자(`kr.co.nara.competitor-sales`)와 제품명을 그대로 사용한다.

## 저장소

- 코드: https://github.com/yhm8029/g2b-contracts
