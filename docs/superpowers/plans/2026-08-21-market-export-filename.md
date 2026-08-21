# Market Export Filename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 시장점유율 엑셀 다운로드 파일명을 사용자가 선택한 기준·지역·기간으로 만든다.

**Architecture:** 엑셀 모듈에 순수 파일명 생성 함수를 추가하고 API 경로가 그 값을 UTF-8 Content-Disposition 헤더에 사용한다. 기존 워크북 생성과 조회 데이터에는 영향을 주지 않는다.

**Tech Stack:** TypeScript, Next.js, Vitest

---

### Task 1: 파일명 생성 및 다운로드 헤더 적용

**Files:**
- Modify: `src/lib/building-control-market/excel.ts`
- Modify: `src/app/api/building-control-market/export/route.ts`
- Test: `tests/building-control-market-mvp.test.ts`

- [x] **Step 1: 실패 테스트 작성**

연간은 `나라장터_부산_2026연간.xlsx`, 분기는 `통합_전국_2026년3분기.xlsx`를 기대한다.

- [x] **Step 2: 테스트 실패 확인**

Run: `npx vitest run tests/building-control-market-mvp.test.ts`
Expected: 파일명 함수가 없어 실패한다.

- [x] **Step 3: 최소 구현**

`marketWorkbookFileName()`을 구현하고 API 응답에 ASCII fallback과 UTF-8 `filename*`를 함께 설정한다.

- [x] **Step 4: 검증**

Run: `npx vitest run tests/building-control-market-mvp.test.ts`
Expected: 모든 테스트 통과.

Run: `npm run build`
Expected: production build 성공.

- [x] **Step 5: 배포 및 커밋**

휴대용 EXE 런타임을 교체하고 실제 응답 헤더를 확인한 뒤 변경을 커밋·푸시한다.
