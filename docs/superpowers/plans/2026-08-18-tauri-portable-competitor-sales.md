# Tauri Portable Competitor Sales Implementation Plan

> **For agentic workers:** Implement task-by-task with tests first. The worker for this plan must be MiniMax-M3.

**Goal:** Produce a small Windows portable Tauri application for competitor sales with a manual recent-data refresh.

**Architecture:** Keep the proven Next.js/Node aggregation as a pruned standalone sidecar and use Tauri v2 only for lifecycle and desktop presentation. Store all mutable state beside the executable and refresh only the trailing 14 days.

**Tech Stack:** Tauri v2, Rust, Next.js 15 standalone, Node.js sidecar, SQLite/better-sqlite3, Vitest.

---

### Task 1: Recent-data refresh contract

**Files:**
- Modify: `src/components/CompetitorSalesApp.tsx`
- Modify: `src/app/api/competitors/overview/route.ts`
- Modify: `src/lib/competitors/service.ts`
- Modify: `src/lib/competitors/cache.ts`
- Modify: `src/lib/competitors/third-party-deliveries.ts`
- Modify: `src/lib/competitors/overview.ts`
- Test: `tests/competitors-client.test.ts`
- Test: `tests/competitors-cache.test.ts`
- Test: `tests/competitors-overview-route.test.ts`

- [ ] Add failing tests for `refresh=1`, trailing-14-day cache invalidation, `lastCheckedAt`, and preserving visible data on refresh failure.
- [ ] Run the focused tests and confirm they fail for the expected missing behavior.
- [ ] Implement a refresh option that invalidates only intersecting recent cache rows before rebuilding the overview.
- [ ] Add an icon refresh button, busy/disabled state, and last API check timestamp without changing period-selection behavior.
- [ ] Run focused tests, the full Vitest suite, and `npx tsc --noEmit`.
- [ ] Commit as `feat: add recent competitor data refresh`.

### Task 2: Production standalone server

**Files:**
- Modify: `next.config.mjs`
- Create: `scripts/build-portable-server.ps1`
- Create: `scripts/portable-server-health.cjs`
- Modify: `.gitignore`
- Test: `tests/portable-server.Tests.ps1`

- [ ] Add a failing packaging test asserting the standalone server, static assets, native SQLite module, empty data directory, and ignored runtime config are assembled.
- [ ] Enable Next standalone output and implement deterministic pruning/copying into a staging directory.
- [ ] Add loopback binding, health endpoint verification, per-launch token propagation, and portable `DATABASE_URL`/log paths.
- [ ] Verify the staged server starts with the bundled Node executable and serves `/competitors` without global npm.
- [ ] Commit as `build: add portable standalone server`.

### Task 3: Tauri shell and portable paths

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/frontend/index.html`
- Test: Rust unit tests in `src-tauri/src/main.rs`

- [ ] Scaffold a minimal Tauri v2 shell with release-size optimization (`opt-level = "z"`, LTO, one codegen unit, strip, panic abort).
- [ ] Implement executable-relative `runtime`, `data`, `config`, and `logs` paths with tests.
- [ ] Spawn bundled Node on an available loopback port, wait by condition for health, navigate to `/competitors`, and terminate the exact child on exit.
- [ ] Render a compact Korean startup/error page while the sidecar is unavailable.
- [ ] Build and run Rust tests, then commit as `feat: add tauri portable shell`.

### Task 4: Portable package assembly

**Files:**
- Create: `scripts/build-tauri-portable.ps1`
- Modify: `package.json`
- Modify: `README.md`
- Test: `tests/tauri-portable.Tests.ps1`

- [ ] Add a failing end-to-end packaging test for the documented portable layout and absence of source/development dependencies.
- [ ] Build the Next standalone server and Tauri release executable, copy the current Node executable, create empty mutable directories, and write `config/app.env` from local environment variables without logging secrets.
- [ ] Add `npm run build:portable` and concise build/run/delete documentation.
- [ ] Launch the produced EXE, verify HTTP/UI health and SQLite creation, execute a refresh, verify Excel export, exit, and confirm no child process remains.
- [ ] Record final EXE and total runtime sizes, run all tests/type checks/builds, and commit as `build: package tauri portable app`.

### Task 5: Desktop delivery and review

- [ ] Replace the old desktop folder only after stopping its server and preserving its SQLite database as a timestamped backup outside staging.
- [ ] Install the new portable folder at `C:\Users\user\Desktop\나라장터 경쟁사 영업성과`.
- [ ] Smoke-test launch, duplicate launch, refresh, Excel export, shutdown, and relaunch.
- [ ] Review the final diff for secret leakage and unrelated changes.
- [ ] Push `feature/g2b-contract-lookup` after all verification succeeds.
