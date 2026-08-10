# G2B Contract Lookup

G2B Contract Lookup은 사업자등록번호로 나라장터 계약 이력을 조회하는 local-first 웹 앱입니다.

## Setup

```powershell
npm install
copy .env.local.example .env.local
npm run db:init
npm run contracts:import -- data/sample-contracts.csv
npm run dev
```

`http://localhost:3000`을 열고 `123-45-67890`을 검색합니다.

## 계약 조회 및 동기화

계약 검색은 로컬 전용입니다. 기본적으로 `data/g2b-contracts.sqlite`의 저장된 계약 행만 읽으며, 조회 버튼을 누를 때 G2B 외부 API를 호출하지 않습니다.

**Sync G2B**는 API 데이터를 SQLite에 먼저 저장하는 작업입니다. 동기화가 끝나 저장된 행이 생긴 뒤 계약 검색에서 확인할 수 있습니다. G2B 동기화에는 `.env.local`의 `DATA_GO_KR_SERVICE_KEY`와 Public Data Portal 사용 승인이 필요합니다.

## 빌딩자동제어장치 조달우수업체

이 기능은 범용 물품분류 검색이 아니라 물품분류번호 `39121801`(빌딩자동제어장치) 전용입니다. 다른 물품분류번호를 입력하거나 조회하는 기능은 제공하지 않습니다.

기준 데이터는 조달청 공식 **「우수제품 지정 내역」** CSV입니다. 공공데이터포털의 보고서 ID는 `UI-ADOSAA-005R`이며, 공식 다운로드 페이지는 [data.go.kr 우수제품 지정 내역](https://www.data.go.kr/data/15006843/fileData.do?recommendDataYn=Y)입니다. CSV의 물품분류번호를 숫자로 정규화한 뒤 `39121801`로 시작하는 행만 저장합니다. CSV 행의 지정번호·원본 분류번호·분류명·규격·인증내역 등 원문 값도 저장하므로, 인증내역에 포함된 쉼표·따옴표·줄바꿈을 임의로 축약하지 않습니다.

### 운영 순서

1. 공식 CSV를 내려받습니다.
2. 다음 명령으로 snapshot을 import합니다.

   ```powershell
   npm run excellent-products:import -- <path>
   ```

   한 번의 import는 대상 데이터셋 전체 snapshot입니다. 반복 import는 같은 source row hash를 기준으로 멱등적으로 처리하고, 새 snapshot에 없는 기존 지정 행은 제거합니다. 파싱 오류나 대상 행이 0건이면 기존 snapshot을 보존한 채 실패합니다. `39121801` prefix 대상만 저장됩니다.

3. 필요할 때만 저장된 대상 사업자에 대해 최신 API 정보를 보강합니다.

   ```powershell
   npm run excellent-products:sync
   ```

   sync는 현재 snapshot의 서로 다른 사업자등록번호마다 한 번씩만 업체 기본정보·업종정보·쇼핑몰 품목정보를 요청합니다. CSV import와 sync를 동시에 실행하지 마십시오. 먼저 한 작업이 완전히 끝난 뒤 다른 작업을 시작해야 합니다.

### 정보 출처와 결측값

- 업체 기본정보와 업종정보는 공공데이터포털 조달청 API([`UsrInfoService02`](https://apis.data.go.kr/1230000/ao/UsrInfoService02))를 사용합니다. 업체 기본정보는 `getPrcrmntCorpBasicInfo02`, 업종정보는 `getPrcrmntCorpIndstrytyInfo02`입니다.
- 생산지와 쇼핑몰 품목정보는 조달청 쇼핑몰 API([`ShoppingMallPrdctInfoService`](https://apis.data.go.kr/1230000/ao/ShoppingMallPrdctInfoService))의 `getThptyUcntrctPrdctInfoList`를 사용합니다. 품목분류번호(`prdctClsfcNo` 또는 `dtilPrdctClsfcNo`)가 `39121801` prefix인 행만 사용합니다.
- 쇼핑몰 응답의 본사 소재지 `hdoffceLocplc`와 공장 소재지 `fctryLocplc`는 별도 필드입니다. 생산지에는 `fctryLocplc`만 사용하며 본사 주소를 공장 주소로 대체하지 않습니다.
- 업종명은 화면의 면허 현황 열에 표시하고, 업종 코드와 상태는 `company_industries`에 보존합니다.
- 업체 표시값의 우선순위는 **공식 API > 조달우수제품 CSV > 기존 계약 CSV**입니다. 더 높은 우선순위의 값이 없을 때만 다음 출처를 사용하며, 기존에 없는 값을 추측해 채우지 않습니다.
- 공식 API/CSV가 전화번호·공장 소재지·면허 정보를 제공하지 않으면 다른 주소나 임의의 값을 대신 쓰지 않고 `전화번호 정보 없음`, `공장소재지 정보 없음`, `면허정보 없음`으로 표시합니다. 현재 연동된 업종 API는 업종명·업종 코드·상태를 제공하지만 별도의 면허 상세 원장을 제공하지 않습니다.

### 화면, API, 저장 구조

`/excellent-products`에서 `빌딩자동제어장치 조달우수업체 현황`을 엽니다. 화면에 `39121801`, 업체 수, 지정 건수, 업체명 필터, 정렬, `조달우수업체 전체 조회`, `최신 정보 갱신`, `CSV 다운로드`가 표시됩니다. 전체 조회는 DB만 읽어 즉시 반환하며 외부 API를 호출하지 않습니다. 최신 정보 갱신만 API를 호출하고, CSV 다운로드는 현재 DB 결과를 그대로 내려받습니다.

전용 내부 API는 다음 세 개입니다.

- `GET /api/excellent-products/building-control`: DB의 `classification`, `companyCount`, `designationCount`, `items`를 반환합니다.
- `GET /api/excellent-products/building-control/export`: 현재 결과를 `g2b-excellent-products-39121801.csv`로 반환합니다.
- `POST /api/excellent-products/building-control/sync`: 대상 사업자의 API 보강 결과와 업체별 오류 요약을 반환합니다.

CSV export는 Excel 호환 UTF-8 BOM과 RFC 4180 quoting을 사용하며, 다음 16개 열을 이 순서로 항상 내보냅니다.

`No.`, `지정번호`, `품명`, `발급일자`, `인정(연장)기간`, `상호명`, `사업자등록번호`, `대표자명`, `전화번호`, `주소`, `물품분류번호`, `물품분류명`, `규격모델`, `인증내역`, `생산지 (공장소재지)`, `면허 현황`

관련 저장 구조는 기존 `businesses` 프로필에 전화번호·출처·최종 동기화 시각을 추가하고, `excellent_products`에 CSV snapshot의 지정·제품·분류·인증 원문·source hash·raw JSON을 저장합니다. `factory_locations`는 사업자별 공장 소재지와 출처를, `company_industries`는 사업자별 업종 코드·업종명·상태와 출처를 저장합니다. `import_runs`에는 import 실행 결과를 기록합니다. 모든 테이블은 사업자번호와 출처 기준 중복 방지 제약을 적용합니다.

## Commands

- `npm run db:init`: 로컬 SQLite 스키마를 초기화합니다.
- `npm run contracts:import -- data/sample-contracts.csv`: 계약 색인 CSV를 import합니다.
- `npm run contracts:enrich -- <record-id>`: 식별자가 있는 기존 계약 한 건을 공공데이터포털 정보로 보강합니다.
- `npm run excellent-products:import -- <path>`: `39121801` 조달우수제품 CSV snapshot을 교체 import합니다.
- `npm run excellent-products:sync`: 현재 snapshot의 대상 사업자만 공식 API로 갱신합니다. `DATA_GO_KR_SERVICE_KEY`가 필요합니다.
- `npm test`: Vitest 테스트를 실행합니다.
- `npm run build`: Next.js 운영 빌드를 생성합니다.
