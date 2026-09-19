#!/usr/bin/env node

/**
 * pi-usage CLI
 *
 * Command-line interface for managing the Pi Usage Dashboard.
 * Supports start, stop, restart, status, open, build, dev, port, logs, and help.
 *
 * Usage:
 *   pi-usage <command> [options]
 *
 * Install globally:
 *   npm link        (from project root)
 *   pi-usage start
 *
 * Or run directly:
 *   npx pi-usage start
 *   node bin/pi-usage.mjs start
 */

import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, openSync } from "fs";
import { join, dirname } from "path";
import { homedir, platform } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = join(__dirname, "..");

const PID_DIR = join(homedir(), ".pi", "agent");
const PID_FILE = join(PID_DIR, "usage-dashboard.pid");
const LOG_FILE = join(PID_DIR, "usage-dashboard.log");
const DEFAULT_PORT = 33123;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Read the configured port from package.json or return default. */
function getPort() {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_DIR, "package.json"), "utf-8"));
    const startScript = pkg.scripts?.start || "";
    const match = startScript.match(/--port\s+(\d+)/);
    return match ? parseInt(match[1], 10) : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

/** Read the stored PID, or null if not running. */
function readPid() {
  try {
    if (!existsSync(PID_FILE)) return null;
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (isNaN(pid)) return null;
    return pid;
  } catch {
    return null;
  }
}

/** Write PID to file. */
function writePid(pid) {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(pid));
}

/** Remove PID file. */
function removePid() {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch { /* ignore */ }
}

/** Check if a process is alive. */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Check if the dashboard is currently running. Returns PID or null. */
function getRunningPid() {
  const pid = readPid();
  if (pid && isProcessAlive(pid)) return pid;
  if (pid) removePid(); // Stale PID file
  return null;
}

/** Open a URL in the default browser (cross-platform). */
function openBrowser(url) {
  const os = platform();
  try {
    if (os === "darwin") {
      execSync(`open "${url}"`);
    } else if (os === "win32") {
      execSync(`start "" "${url}"`);
    } else {
      execSync(`xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null || echo "Open ${url} in your browser"`);
    }
  } catch {
    console.log(`  Open in your browser: ${url}`);
  }
}

/** Print styled output. */
function log(msg) { console.log(`  ${msg}`); }
function success(msg) { console.log(`  ✓ ${msg}`); }
function error(msg) { console.error(`  ✗ ${msg}`); }
function info(msg) { console.log(`  ℹ ${msg}`); }

// ─── Commands ───────────────────────────────────────────────────────────────

const commands = {
  /** Start the dashboard in the background. */
  start() {
    const running = getRunningPid();
    if (running) {
      info(`Dashboard already running (PID ${running})`);
      log(`http://localhost:${getPort()}`);
      return;
    }

    // Check if built
    if (!existsSync(join(PROJECT_DIR, ".next"))) {
      info("No build found. Building first...");
      commands.build();
    }

    const port = getPort();
    log("Starting Pi Usage Dashboard...");

    mkdirSync(PID_DIR, { recursive: true });

    const logStream = openSync(LOG_FILE, "a");
    const nextBin = join(PROJECT_DIR, "node_modules", "next", "dist", "bin", "next");

    const child = spawn(process.execPath, [nextBin, "start", "--port", String(port)], {
      cwd: PROJECT_DIR,
      detached: true,
      stdio: ["ignore", logStream, logStream],
      env: { ...process.env, NODE_ENV: "production" },
    });

    child.unref();
    writePid(child.pid);

    // Wait a moment and verify it started
    setTimeout(() => {
      if (isProcessAlive(child.pid)) {
        success(`Dashboard running on http://localhost:${port} (PID ${child.pid})`);
        info(`Logs: ${LOG_FILE}`);
      } else {
        error("Failed to start. Check logs:");
        log(`  ${LOG_FILE}`);
        removePid();
      }
    }, 2000);
  },

  /** Start in development mode (foreground). */
  dev() {
    const port = getPort();
    log(`Starting dev server on http://localhost:${port}...`);
    try {
      execSync(`npm run dev`, { cwd: PROJECT_DIR, stdio: "inherit" });
    } catch {
      // Ctrl+C exits with error, that's fine
    }
  },

  /** Stop the running dashboard. */
  stop() {
    const pid = getRunningPid();
    if (!pid) {
      info("Dashboard is not running.");
      return;
    }

    log(`Stopping dashboard (PID ${pid})...`);
    try {
      if (platform() === "win32") {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      } else {
        // Kill the process group (negative PID)
        try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); }
        setTimeout(() => {
          if (isProcessAlive(pid)) {
            try { process.kill(-pid, "SIGKILL"); } catch {
              try { process.kill(pid, "SIGKILL"); } catch { /* ignore */ }
            }
          }
        }, 3000);
      }
      removePid();
      success("Dashboard stopped.");
    } catch {
      removePid();
      success("Dashboard stopped.");
    }
  },

  /** Restart the dashboard. */
  restart() {
    const wasRunning = getRunningPid();
    if (wasRunning) {
      commands.stop();
      // Wait for stop to complete
      setTimeout(() => commands.start(), 1500);
    } else {
      commands.start();
    }
  },

  /** Check dashboard status. */
  status() {
    const pid = getRunningPid();
    const port = getPort();
    if (pid) {
      success(`Dashboard is running (PID ${pid})`);
      log(`URL: http://localhost:${port}`);
      log(`PID file: ${PID_FILE}`);
      log(`Log file: ${LOG_FILE}`);
    } else {
      info("Dashboard is not running.");
    }
  },

  /** Open dashboard in browser. */
  open() {
    const port = getPort();
    const pid = getRunningPid();
    if (!pid) {
      info("Dashboard is not running. Starting...");
      commands.start();
      setTimeout(() => openBrowser(`http://localhost:${port}`), 3000);
    } else {
      openBrowser(`http://localhost:${port}`);
    }
  },

  /** Build for production. */
  build() {
    log("Building Pi Usage Dashboard...");
    try {
      execSync("npm run build", { cwd: PROJECT_DIR, stdio: "inherit" });
      success("Build complete.");
    } catch {
      error("Build failed.");
      process.exit(1);
    }
  },

  /** Change the port. */
  port(args) {
    const newPort = parseInt(args[0], 10);
    if (!newPort || newPort < 1 || newPort > 65535) {
      error("Usage: pi-usage port <number> (1-65535)");
      return;
    }

    const pkgPath = join(PROJECT_DIR, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

    pkg.scripts.dev = `next dev --port ${newPort}`;
    pkg.scripts.start = `next start --port ${newPort}`;

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    success(`Port changed to ${newPort}`);
    info("Restart the dashboard for changes to take effect.");
  },

  /** Pull latest changes, reinstall deps, rebuild, and restart. */
  update() {
    log("Updating Pi Usage Dashboard...");

    // Check if it's a git repo
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd: PROJECT_DIR, stdio: "ignore" });
    } catch {
      error("Not a git repository. Cannot auto-update.");
      info("If you installed via npm, run: npm update -g pi-usage-dashboard");
      return;
    }

    // Pull latest
    log("Pulling latest changes...");
    try {
      const output = execSync("git pull", { cwd: PROJECT_DIR, encoding: "utf-8" });
      console.log(`  ${output.trim()}`);
    } catch (e) {
      error("git pull failed. Resolve conflicts manually.");
      return;
    }

    // Install deps
    log("Installing dependencies...");
    try {
      execSync("npm install", { cwd: PROJECT_DIR, stdio: "inherit" });
    } catch {
      error("npm install failed.");
      return;
    }

    // Build
    commands.build();

    // Restart if was running
    const pid = getRunningPid();
    if (pid) {
      commands.stop();
      setTimeout(() => {
        commands.start();
        success("Update complete!");
      }, 1500);
    } else {
      success("Update complete! Run 'pi-usage start' to launch.");
    }
  },

  /** Show recent logs. */
  logs() {
    if (!existsSync(LOG_FILE)) {
      info("No logs found.");
      return;
    }

    log(`Log file: ${LOG_FILE}\n`);
    try {
      const content = readFileSync(LOG_FILE, "utf-8");
      const lines = content.trim().split("\n");
      const tail = lines.slice(-50);
      console.log(tail.join("\n"));
    } catch (e) {
      error(`Failed to read logs: ${e.message}`);
    }
  },

  /** Show help. */
  help() {
    console.log(`
  Pi Usage Dashboard CLI

  Usage:
    pi-usage <command> [options]

  Commands:
    start           Start the dashboard in the background
    stop            Stop the running dashboard
    restart         Restart the dashboard
    status          Check if the dashboard is running
    open            Open the dashboard in your browser
    dev             Start in development mode (foreground)
    build           Build for production
    update          Pull latest + install + build + restart
    port <number>   Change the dashboard port (default: ${DEFAULT_PORT})
    logs            Show recent dashboard logs
    help            Show this help message

  Examples:
    pi-usage start          # Start dashboard
    pi-usage open           # Open in browser (starts if needed)
    pi-usage update         # Update to latest version
    pi-usage port 8080      # Change port to 8080
    pi-usage restart        # Restart after config changes
    pi-usage stop           # Stop the dashboard

  Files:
    PID:  ${PID_FILE}
    Logs: ${LOG_FILE}
    DB:   ${join(PID_DIR, "usage-dashboard.db")}
`);
  },
};

// ─── Main ───────────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  commands.help();
} else if (commands[command]) {
  commands[command](args);
} else {
  error(`Unknown command: ${command}`);
  console.log("  Run 'pi-usage help' for available commands.");
  process.exit(1);
}
