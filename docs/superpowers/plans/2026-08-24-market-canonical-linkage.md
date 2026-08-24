# Market Canonical Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 통합 대표건 연계정보, 도시 지역 매핑, API 할당량 전용 상태를 빠르게 반영한다.

**Architecture:** 기존 SQLite 원본 테이블은 유지한다. 보고서 계층에서 동일 사업 연결을 계산하고 Excel이 그 연결정보를 출력한다. 지역과 오류 분류는 각각 작은 순수 함수로 구현한다.

**Tech Stack:** TypeScript, Next.js, SQLite, ExcelJS, Vitest, Tauri portable build

---

### Task 1: 회귀 테스트

**Files:**
- Modify: `tests/building-control-market-mvp.test.ts`

- [ ] 창원 기관명이 경남으로 분류되는 실패 테스트를 추가한다.
- [ ] 통합 Excel 대표행에 연계 쇼핑몰 계약번호/계약일이 표시되는 실패 테스트를 추가한다.
- [ ] 할당량 오류 판별 실패 테스트를 추가한다.
- [ ] 집중 테스트를 실행하고 새 테스트가 기대한 이유로 실패하는지 확인한다.

### Task 2: 최소 구현

**Files:**
- Modify: `src/lib/building-control-market/regions.ts`
- Modify: `src/lib/building-control-market/report.ts`
- Modify: `src/lib/building-control-market/excel.ts`
- Modify: `src/lib/building-control-market/sync.ts`
- Modify: `src/app/api/building-control-market/sync/route.ts`

- [ ] 주요 도시명 매핑을 추가한다.
- [ ] 동일 사업 연결 함수를 내보내고 통합 Excel 대표행에 연계정보를 기록한다.
- [ ] 할당량 오류 판별 및 `quota_exhausted` 상태를 추가한다.
- [ ] 기존 동기화 중 깨진 상태 문구를 정상 한글로 교정한다.

### Task 3: 검증·배포

**Files:**
- Modify: portable output only

- [ ] 집중 테스트와 production build를 실행한다.
- [ ] 바탕화면 DB를 보존하고 portable runtime/EXE만 교체한다.
- [ ] DB 지역을 재계산하고 동기화를 실행한다.
- [ ] 커밋 본문에 완료 여부를 기록하고 private 원격 브랜치로 푸시한다.

