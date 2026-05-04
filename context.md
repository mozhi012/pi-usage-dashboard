# Code Context

## Files Retrieved
1. `package.json` (lines 1-40) - stack, scripts, CLI bin, dependencies.
2. `README.md` (lines 1-200, 201-289) - documented features, routes, data storage, project structure, guidelines.
3. `bin/pi-usage.mjs` (lines 1-220) - CLI entry point and process/port/log management.
4. `src/app/layout.tsx` (lines 1-34) - Next App Router root layout and metadata.
5. `src/app/page.tsx` (lines 1-180) - main dashboard client entry and usage data consumption.
6. `src/hooks/use-usage-stream.ts` (lines 1-94) - client SSE/fetch data flow.
7. `src/lib/db.ts` (lines 1-215) - SQLite schema and pricing/source persistence.
8. `src/lib/parse-sessions.ts` (lines 1-520) - session JSONL parsing, source discovery, aggregation.
9. `src/app/api/usage/route.ts` (lines 1-24) - usage API endpoint.
10. `src/app/api/usage/stream/route.ts` (lines 1-104) - SSE API and chokidar watcher.
11. `src/app/api/pricing/route.ts` (lines 1-67) - model pricing CRUD.
12. `src/app/api/sources/route.ts` (lines 1-105) - session source CRUD.
13. `src/app/api/models/route.ts` (lines 1-160) - model/provider/auth discovery start.
14. `src/app/api/extensions/route.ts` (lines 1-360) - extensions/skills/prompts/themes scan/delete.
15. `src/app/api/hotkeys/route.ts` (lines 1-170) - built-in hotkey table and custom override loading.
16. `src/app/api/session-actions/route.ts` (lines 1-174) - session export/share/import/duplicate actions.
17. `src/app/api/terminal/route.ts` (lines 1-93) - cross-platform terminal launch API.
18. `src/app/project/page.tsx` (lines 1-170) - project detail page, API usage and terminal launch.

## Key Code

- Stack/entry points: Next.js 16.2.4, React 19.2.4, TypeScript, Tailwind 4, Recharts, better-sqlite3, chokidar; scripts `dev`, `build`, `start`, `lint`; CLI bin `pi-usage` points at `./bin/pi-usage.mjs` (`package.json` lines 1-39).
- App routes under `src/app`: `/`, `/models`, `/hotkeys`, `/extensions`, `/settings`, `/pricing`, `/project`; API routes under `src/app/api/*/route.ts` (README structure lines 201-245).
- Root layout sets global fonts, dark class, metadata title/description (`src/app/layout.tsx` lines 1-34).
- Main dashboard is client-rendered and uses `useUsageStream()` for live data, then computes filtered summary/model data on the client (`src/app/page.tsx` lines 1-125).
- Client data hook opens `EventSource('/api/usage/stream')`, parses messages into `AggregatedData`, reconnects after 3s, and has manual `/api/usage` refresh/sync paths (`src/hooks/use-usage-stream.ts` lines 12-94).
- SQLite is local-only at `~/.pi/agent/usage-dashboard.db`; schema has `model_pricing` and `session_sources`; helpers expose pricing CRUD, source CRUD, `getPricingMap()`, and `calculateCost()` (`src/lib/db.ts` lines 1-215).
- Session parser types: `UsageData`, `MessageData`, `SessionData`, `AggregatedData` define the API payload shape (`src/lib/parse-sessions.ts` lines 15-114).
- Default session dir resolution uses `PI_CODING_AGENT_SESSION_DIR`, then `PI_CODING_AGENT_DIR/sessions`, then `~/.pi/agent/sessions` (`src/lib/parse-sessions.ts` lines 124-130; same logic in SSE route lines 17-23).
- Parsing reads `.jsonl`, extracts `session` header (`id`, `timestamp`, `cwd`) and assistant `message.usage`; user/assistant turns are counted; custom pricing overrides provider-reported `usage.cost` when configured (`src/lib/parse-sessions.ts` lines 140-259).
- Aggregation recursively collects `.jsonl`, includes default dir plus enabled DB sources, deduplicates by `sessionId`, aggregates by model/project/day/week/month, and returns sorted sessions (`src/lib/parse-sessions.ts` lines 266-520).
- `/api/usage` simply returns `getAllUsageData()` JSON (`src/app/api/usage/route.ts` lines 1-24).
- `/api/usage/stream` watches configured `**/*.jsonl` paths with chokidar, sends initial data, debounces updates by 1s, heartbeats every 30s (`src/app/api/usage/stream/route.ts` lines 25-104).
- `/api/pricing` GET/POST/DELETE maps directly to DB helpers; no auth or CSRF (`src/app/api/pricing/route.ts` lines 14-67).
- `/api/sources` lists sources and sets `X-Home-Dir`; POST validates path exists; PUT does not validate updated paths; DELETE by id (`src/app/api/sources/route.ts` lines 23-105).
- Models/auth handling: `/api/models` reads `~/.pi/agent/auth.json`, `models.json`, `settings.json`, and dynamically locates pi built-in `models.generated.js` via `which pi`; provider `hasAuth` is inferred from API key or OAuth entry (`src/app/api/models/route.ts` lines 1-160).
- Hotkeys handling: default keybindings are hardcoded and custom overrides are read from `~/.pi/agent/keybindings.json` (`src/app/api/hotkeys/route.ts` lines 1-170).
- Session actions shell out to `pi --export` and `gh gist create`, import into `~/.pi/agent/sessions`, and duplicate files (`src/app/api/session-actions/route.ts` lines 1-174).
- Terminal API builds shell commands from user-provided `cwd`, `sessionFile`, and `sessionId`; uses `osascript`, Windows `start cmd`, or Linux terminal fallbacks (`src/app/api/terminal/route.ts` lines 1-93).
- CLI manages background server with PID/log files in `~/.pi/agent`, reads port from `package.json`, starts Next in production using `.next`, and exposes start/dev/stop/restart/status/open/build/port/logs/help (`bin/pi-usage.mjs` lines 1-220; README lines 35-59).

## Architecture

This is a local desktop-style Next.js App Router app. Most pages are client components that fetch internal API routes. The primary data flow is:

1. Browser `/` calls `useUsageStream()`.
2. Hook connects to `/api/usage/stream`; fallback/manual refresh calls `/api/usage`.
3. API calls `getAllUsageData()` in `src/lib/parse-sessions.ts`.
4. Parser gets configured source directories from SQLite (`src/lib/db.ts`) plus default pi session dir, recursively reads `.jsonl`, applies pricing from SQLite, deduplicates by session id, aggregates usage.
5. UI renders summary cards, charts, project/session tables; project detail refetches `/api/usage` and filters client-side.

Persistent app-owned state is only pricing and additional source paths in SQLite. Pi-owned files are read from the user home directory (`~/.pi/agent/*`) except endpoints that mutate resources/session copies or launch commands. There is no app authentication/session middleware; “auth” means discovery of pi provider credentials from `auth.json`/`models.json`, not dashboard login.

## Tests

No test files were found (`find '**/*test*'` returned no matches). `package.json` has no test script, only `dev`, `build`, `start`, and `lint`.

## Environment Usage

- `PI_CODING_AGENT_SESSION_DIR` and `PI_CODING_AGENT_DIR` alter session scan/watch locations (`src/lib/parse-sessions.ts` lines 124-130; `src/app/api/usage/stream/route.ts` lines 17-23).
- `HOME`/`USERPROFILE` used only in terminal route to expand `~` (`src/app/api/terminal/route.ts` lines 67-70).
- CLI sets `NODE_ENV=production` when spawning Next (`bin/pi-usage.mjs` around lines 120-132).
- No `.env*` files found.

## Likely Missing Functionality / Risks

- No dashboard auth, authorization, CSRF, or origin checks. Local APIs can read pi auth metadata, mutate SQLite, delete pi resources, copy/import sessions, launch terminals, and run shell commands.
- Shell command construction is risky: `session-actions` interpolates `sessionFile`/`outFile` into `exec`; terminal route interpolates `cwd`/session refs into platform shell commands. Some escaping exists, but no whitelist that session files are under configured session dirs.
- `session-actions` verifies only file existence, not that a target is a real pi session file or inside allowed directories.
- `extensions` DELETE protects only known pi directories, but uses simple `startsWith(prefix)` without path normalization/realpath, which can be bypass-prone with symlinks or prefix tricks.
- SSE cleanup appears incomplete: a `_cleanup` function is assigned to the controller but never called in `cancel()`; `cancel()` only flips `watcherClosed`, so the chokidar watcher/heartbeat may leak (`src/app/api/usage/stream/route.ts` lines 84-101).
- `sources` PUT does not validate updated path existence/accessibility, unlike POST (`src/app/api/sources/route.ts` lines 69-84).
- `duplicate` uses `join(sessionFile, '..')`, which treats the file path as a directory segment; likely intended `dirname(sessionFile)` (`src/app/api/session-actions/route.ts` lines 148-154).
- README documents share via Gist/import/duplicate, but UI evidence only shows calls from sessions table to `/api/session-actions`; verify UI exposes all actions and handles errors.
- Hotkeys are hardcoded defaults and may drift from pi upstream.
- No automated tests for parser aggregation, pricing math, path safety, SSE cleanup, CLI, or API routes.

## Start Here

Start with `src/lib/parse-sessions.ts` for core domain/data shape and aggregation. Then open `src/app/api/usage/stream/route.ts` for live-update behavior and `src/lib/db.ts` for persistence. For security or mutation work, inspect `src/app/api/session-actions/route.ts`, `src/app/api/terminal/route.ts`, and `src/app/api/extensions/route.ts` first.