# 빌딩자동제어장치 조달우수업체 조회 설계

## 목표와 범위

기존 `g2b-contracts`에 물품분류번호 `39121801` 계열의 조달우수제품과 지정업체를 한 번에 조회하는 전용 기능을 추가한다. 다른 물품분류번호를 입력하거나 조회하는 범용 검색 기능은 만들지 않는다. 기존 사업자번호 기반 계약조회와 경쟁사 매출 기능은 유지한다.

조달청 공식 물품분류 체계에서 물품분류번호는 8자리이고 세부물품분류번호는 그 뒤에 2자리를 붙인 10자리이다. 입력값에서 숫자가 아닌 문자를 제거한 뒤 `39121801`로 시작하면 대상이다.

## 사용자 흐름

기존 메인 화면에 전용 화면으로 이동하는 버튼을 추가한다. `/excellent-products` 화면에는 `빌딩자동제어장치`, `물품분류번호 39121801`, `조달우수업체 전체 조회` 버튼을 고정 표시한다. 조회 버튼은 외부 API를 호출하지 않고 로컬 DB 결과를 즉시 읽는다.

조회 후 업체 수와 지정 건수를 표시하고 정확히 16개 컬럼의 표를 제공한다. 업체명 결과 내 검색과 업체명·지정번호·발급일자·인정기간 정렬을 지원한다. CSV 다운로드는 화면 필터와 무관하게 DB에 저장된 전체 대상 결과를 UTF-8 BOM 및 RFC 4180 방식 quoting으로 내려준다.

별도 `최신 정보 갱신` 버튼은 현재 DB의 대상 사업자만 enrichment한다. 같은 사업자의 우수제품이 여러 건이어도 업체 기본정보, 업종정보, 쇼핑몰 품목정보는 사업자당 한 번씩만 조회한다.

## 기준 데이터와 import

기준 source는 조달청 `우수제품 지정 내역` CSV다. 공식 보고서의 실제 컬럼은 다음과 같다.

- 물품규격내용
- 물품분류
- 업체대표자명
- 업체명
- 업체사업자번호
- 업체전화번호
- 업체주소
- 우수조달지정요청분야
- 우수조달지정증서번호
- 인증내역
- 제제유형
- 지정시작일자
- 지정연장일자

Parser는 이 헤더와 명확한 변형 alias를 인식한다. quoted comma, quote, CR/LF가 들어 있는 필드를 지원한다. `물품분류`에서 분류번호와 분류명을 분리하고, 숫자 정규화 결과가 `39121801`로 시작하는 행만 유효 대상으로 반환한다. 사업자번호도 숫자 10자리로 정규화한다.

CLI는 `npm run excellent-products:import -- <csv-path>`다. 한 번의 import는 대상 데이터셋의 완전한 snapshot으로 취급한다. 파싱에 치명적 오류가 있으면 기존 데이터를 보존하고 실패한다. 정상 파싱 후에는 트랜잭션 안에서 기존 우수제품 행을 새 snapshot으로 교체해 중복과 삭제된 지정 건을 함께 처리한다. 업체 enrichment 테이블은 교체하지 않는다.

중복 키는 `사업자등록번호 + 지정번호 + 제품분류번호 + 제품규격`의 안정된 source hash를 사용한다. 동일 사업자라도 지정번호가 다르면 별도 결과 행이다. 원본 인증내역과 raw row JSON은 항상 보존한다.

## 데이터 모델

기존 `businesses`를 업체 profile로 재사용하고 `phone`, `profile_source`, `last_synced_at`을 추가한다. 기존 계약 import가 API에서 동기화된 업체 profile을 빈 값으로 덮어쓰지 않도록 non-null 우선 갱신을 적용한다.

`excellent_products`는 지정번호, 사업자번호, CSV 업체명·대표자·전화·주소, 품명, 지정시작/연장일자, 원본/정규화 분류번호, 분류명, 규격, 인증 원문, 제재유형, source hash/dataset/imported time, raw JSON을 저장한다.

`factory_locations`는 사업자번호, 공장소재지, source를 저장한다. 본사소재지는 공장 테이블에 넣지 않는다. `company_industries`는 사업자번호, 업종코드, 업종명, 상태, source를 저장한다. 각 테이블은 사업자번호와 값 기준 unique constraint를 둔다.

## enrichment와 source 우선순위

업체 기본정보는 공식 `UsrInfoService02/getPrcrmntCorpBasicInfo02`, 업종은 `getPrcrmntCorpIndstrytyInfo02`, 공장과 쇼핑몰 규격은 `ShoppingMallPrdctInfoService/getThptyUcntrctPrdctInfoList`를 사용한다. 공통 인증키와 HTTP 유틸은 기존 `src/lib/g2b/http.ts`를 재사용한다.

업체 표시값 우선순위는 API, 우수제품 CSV, 기존 계약정보다. CSV 값은 표시 우선순위와 별개로 우수제품 행에 보존한다. 쇼핑몰 응답은 `prdctClsfcNo` 또는 `dtilPrdctClsfcNo`가 대상 prefix인 행만 사용한다. `hdoffceLocplc`와 `fctryLocplc`를 별도로 parse하고 최종 생산지는 중복 제거한 `fctryLocplc`만 사용한다.

공식 데이터가 없는 값은 추측하거나 다른 주소로 대체하지 않는다. UI에는 `전화번호 정보 없음`, `공장소재지 정보 없음`, `면허정보 없음`처럼 표시한다.

## 내부 API

- `GET /api/excellent-products/building-control`: DB의 대상 결과, `classification`, `companyCount`, `designationCount`, `items` 반환
- `GET /api/excellent-products/building-control/export`: 16컬럼 전체 CSV 반환
- `POST /api/excellent-products/building-control/sync`: 대상 고유 사업자 목록만 enrichment하고 요약 반환

조회 결과는 지정번호 오름차순을 기본으로 한다. UI의 정렬과 업체명 필터는 client-side로 수행한다.

## 오류 처리

CSV 필수 헤더 누락, 잘못된 사업자번호, 분류번호 없는 행은 행 번호가 포함된 오류로 보고한다. 대상 행이 0건인 snapshot은 실수로 기존 데이터를 지우지 않도록 실패 처리한다. API 한 업체의 실패가 전체 동기화를 중단하지 않으며 업체별 실패를 집계한다. API key와 URL의 service key는 로그와 응답에서 노출하지 않는다.

## 테스트와 검증

정규화 및 prefix 판정, 실제 헤더 alias와 대상행 filtering, quoted multiline CSV, snapshot 중복 제거, 사업자당 1회 enrichment, 본사/공장 분리, 다중 업종 연결, 결과 집계, 정확한 16컬럼 BOM CSV와 특수문자 quoting, API route, UI 고정 분류 및 버튼 동작을 테스트한다. 마지막에 전체 `npm test`와 `npm run build`를 실행한다.

## 비목표

다른 분류번호 검색, 전체 조달품목 sync, 자연어·AI 검색, 웹 크롤링, 추천, 대규모 schema 재설계는 구현하지 않는다.
