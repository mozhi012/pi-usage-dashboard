# Pi Usage Dashboard

A web-based dashboard for tracking token usage, costs, sessions, and resources across all your [pi coding agent](https://github.com/badlogic/pi-mono) projects.

![Dashboard](https://img.shields.io/badge/port-33123-blue) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![License](https://img.shields.io/badge/license-MIT-green)

<p align="center">
  <img src="docs/preview.png" alt="Pi Usage Dashboard Preview" width="800" />
</p>

## Features

- **Usage Tracking** — Total tokens, input/output breakdown, cache usage, and costs across all sessions
- **Live Updates** — Real-time dashboard updates via Server-Sent Events when sessions change
- **Multi-Source** — Merge sessions from multiple harnesses (pi default, Superconductor, custom paths)
- **Model Pricing** — Configure per-model token prices to calculate costs from subscription providers
- **Time Filters** — Daily, weekly, and monthly views with synchronized charts and summary cards
- **Project Details** — Per-project usage breakdown with session list and terminal launch
- **Session Actions** — Resume, fork, export to HTML, share via Gist, or duplicate sessions
- **Models & Providers** — View all authenticated models, providers, and auth status
- **Extensions & Skills** — Browse and manage installed extensions, skills, prompts, and themes
- **Hotkeys Reference** — Complete keyboard shortcut reference with custom override display
- **Cross-Platform** — Works on macOS, Linux, and Windows
- **CLI** — `pi-usage start`, `pi-usage stop`, `pi-usage open` — manage from any terminal

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pi coding agent](https://github.com/badlogic/pi-mono) installed globally

### Install

```bash
git clone https://github.com/mralifakbar/pi-usage-dashboard.git
cd pi-usage-dashboard
npm install
npm run build
npm link
```

### Usage

After `npm link`, the `pi-usage` command is available globally:

```bash
pi-usage start          # Start dashboard in background
pi-usage stop           # Stop the dashboard
pi-usage restart        # Restart the dashboard
pi-usage status         # Check if running (shows PID and URL)
pi-usage open           # Open in browser (auto-starts if needed)
pi-usage update         # Pull latest + install + build + restart
pi-usage dev            # Start in development mode (foreground, hot reload)
pi-usage build          # Rebuild for production
pi-usage port <number>  # Change the port (default: 33123)
pi-usage logs           # Show last 50 lines of logs
pi-usage help           # Show all commands
```

### Without CLI

You can also run directly with npm:

```bash
npm run start           # Start on port 33123
npm run dev             # Development mode
```

Then open [http://localhost:33123](http://localhost:33123).

## Configuration

### Session Sources

The dashboard always reads from the default pi sessions directory (`~/.pi/agent/sessions/`).

Add additional sources via the **Sources** page (`/settings`) in the dashboard UI:

- **Superconductor**: `~/.superconductor/sessions/pi/`
- **Custom harnesses**: any directory containing `.jsonl` session files
- **Team shared directories**: mounted network paths

Sessions are deduplicated by session ID — the same session appearing in multiple sources is only counted once.

### Model Pricing

Configure per-model token prices via the **Pricing** page (`/pricing`).

Prices are per 1 million tokens:

| Field | Description |
|-------|-------------|
| Input Price | Cost per 1M input tokens |
| Output Price | Cost per 1M output tokens |
| Cache Read Price | Cost per 1M cache read tokens |
| Cache Write Price | Cost per 1M cache write tokens |

If no pricing is configured for a model, the provider-reported cost is used (usually $0 for subscription-based providers).

### Port

Default port is `33123`. Change it with the CLI:

```bash
pi-usage port 8080
pi-usage restart
```

Or edit `package.json` scripts manually.

## Pages

| Route | Description |
|-------|-------------|
| `/` | Main dashboard — summary cards, time charts, model breakdown, projects, sessions |
| `/models` | All authenticated models, providers, and auth status from `auth.json` |
| `/hotkeys` | Pi keyboard shortcuts with default and custom bindings |
| `/extensions` | Installed extensions, skills, prompts, and themes (with delete) |
| `/settings` | Configure additional session source directories |
| `/pricing` | Configure per-model token pricing |
| `/project?path=...` | Project detail — stats, session list, resume/fork/terminal launch |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/usage` | GET | Aggregated usage data from all sources |
| `/api/usage/stream` | GET | Server-Sent Events stream for real-time updates |
| `/api/pricing` | GET/POST/DELETE | Model pricing CRUD |
| `/api/sources` | GET/POST/PUT/DELETE | Session source directory management |
| `/api/models` | GET | Available models and providers (authenticated only) |
| `/api/extensions` | GET/DELETE | Extensions, skills, prompts, themes |
| `/api/hotkeys` | GET | Keyboard shortcuts with custom overrides |
| `/api/terminal` | POST | Launch pi in a new terminal window (cross-platform) |
| `/api/session-actions` | POST | Export, share, import, or duplicate sessions |

## Data Storage

| File | Purpose |
|------|---------|
| `~/.pi/agent/usage-dashboard.db` | SQLite — pricing config and session sources |
| `~/.pi/agent/usage-dashboard.pid` | PID file for background process |
| `~/.pi/agent/usage-dashboard.log` | Dashboard server logs |
| `~/.pi/agent/sessions/` | Default pi session files (read-only) |
| `~/.pi/agent/auth.json` | OAuth/API credentials (read-only) |
| `~/.pi/agent/models.json` | Custom provider configs (read-only) |
| `~/.pi/agent/keybindings.json` | Custom keybindings (read-only) |

## How It Works

### Session Parsing

Pi stores sessions as JSONL files with a tree structure. Each assistant message contains a `usage` field with token counts. The dashboard:

1. Recursively scans all configured session directories for `.jsonl` files
2. Parses each file, extracting assistant messages with usage data
3. Applies custom pricing (if configured) to calculate costs
4. Deduplicates by session ID across all sources
5. Aggregates by model, project, day, week, and month

### Live Updates

Uses Server-Sent Events (SSE) with [chokidar](https://github.com/paulmillr/chokidar) file watching:

- Watches all enabled source directories for `.jsonl` file changes
- Debounces updates (1s) to avoid flooding during active sessions
- Auto-reconnects on connection loss (3s retry)
- Heartbeat every 30s to keep connections alive
- Click **Sync** to reconnect and pick up newly added sources

### Compaction Safety

Pi's compaction feature summarizes older messages but **never deletes** them from the JSONL file. All token usage is preserved and counted regardless of compaction state.

### Cross-Platform Terminal

The terminal launch API detects the OS and uses the appropriate method:

| OS | Method |
|----|--------|
| macOS | `osascript` → Terminal.app |
| Linux | `gnome-terminal`, `konsole`, `xterm`, or `x-terminal-emulator` |
| Windows | `start cmd /k` |

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Install dependencies: `npm install`
4. Start dev server: `pi-usage dev` or `npm run dev`
5. Make your changes
6. Run lint: `npm run lint`
7. Build: `npm run build`
8. Commit: `git commit -m "feat: description"`
9. Push: `git push origin feature/my-feature`
10. Open a Pull Request

### Project Structure

```
pi-usage-dashboard/
├── bin/
│   └── pi-usage.mjs          # CLI entry point
├── docs/
│   └── preview.png            # README screenshot
├── public/
│   └── preview.png            # Served preview image
├── src/
│   ├── app/
│   │   ├── api/               # API route handlers
│   │   │   ├── extensions/    # Extensions/skills/prompts/themes CRUD
│   │   │   ├── hotkeys/       # Keyboard shortcuts
│   │   │   ├── models/        # Models and providers
│   │   │   ├── pricing/       # Model pricing CRUD
│   │   │   ├── session-actions/ # Export, share, duplicate
│   │   │   ├── sources/       # Session source management
│   │   │   ├── terminal/      # Terminal launch (cross-platform)
│   │   │   └── usage/         # Usage data + SSE stream
│   │   ├── extensions/        # Extensions page
│   │   ├── hotkeys/           # Hotkeys page
│   │   ├── models/            # Models page
│   │   ├── pricing/           # Pricing page
│   │   ├── project/           # Project detail page
│   │   ├── settings/          # Session sources page
│   │   ├── icon.svg           # Favicon
│   │   ├── layout.tsx         # Root layout
│   │   └── page.tsx           # Main dashboard
│   ├── components/
│   │   ├── ui/                # shadcn/ui base components
│   │   ├── projects-table.tsx
│   │   ├── sessions-table.tsx
│   │   ├── summary-cards.tsx
│   │   ├── tokens-by-day-chart.tsx
│   │   └── tokens-by-model-chart.tsx
│   ├── hooks/
│   │   └── use-usage-stream.ts   # SSE hook for real-time data
│   └── lib/
│       ├── db.ts              # SQLite database (pricing + sources)
│       ├── parse-sessions.ts  # Session JSONL parser + aggregator
│       └── utils.ts           # Tailwind utilities
├── package.json
├── next.config.ts
└── README.md
```

### Development Guidelines

- All API routes must have JSDoc headers explaining the endpoint
- Use `homedir()` for user paths — never hardcode directories
- Terminal commands must be cross-platform (macOS/Linux/Windows)
- Session sources are resolved dynamically — no hardcoded paths
- Built-in model discovery uses `which pi` — works with any install method
- The CLI (`bin/pi-usage.mjs`) must work as ESM with no build step

## Tech Stack

- [Next.js 16](https://nextjs.org/) — React framework with App Router
- [shadcn/ui](https://ui.shadcn.com/) — UI components
- [Recharts](https://recharts.org/) — Charts
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Local SQLite database
- [chokidar](https://github.com/paulmillr/chokidar) — File watching for live updates
- [Tailwind CSS 4](https://tailwindcss.com/) — Styling
- [Lucide](https://lucide.dev/) — Icons

## License

MIT
