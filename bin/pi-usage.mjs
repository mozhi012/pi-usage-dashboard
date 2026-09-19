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
      info(`仪表盘已经在运行中 (PID ${running})`);
      log(`http://localhost:${getPort()}`);
      return;
    }

    // Check if built
    if (!existsSync(join(PROJECT_DIR, ".next"))) {
      info("未检测到构建产物，正在先进行构建...");
      commands.build();
    }

    const port = getPort();
    log("正在启动 Pi 用量仪表盘...");

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
        success(`仪表盘已启动，访问地址: http://localhost:${port} (PID ${child.pid})`);
        info(`日志文件: ${LOG_FILE}`);
      } else {
        error("启动失败，请检查运行日志：");
        log(`  ${LOG_FILE}`);
        removePid();
      }
    }, 2000);
  },

  /** Start in development mode (foreground). */
  dev() {
    const port = getPort();
    log(`正在以开发模式启动服务器: http://localhost:${port}...`);
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
      info("仪表盘当前未在运行。");
      return;
    }

    log(`正在停止仪表盘 (PID ${pid})...`);
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
      success("仪表盘已停止。");
    } catch {
      removePid();
      success("仪表盘已停止。");
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
      success(`仪表盘正在运行 (PID ${pid})`);
      log(`访问地址: http://localhost:${port}`);
      log(`PID 文件: ${PID_FILE}`);
      log(`日志文件: ${LOG_FILE}`);
    } else {
      info("仪表盘未在运行。");
    }
  },

  /** Open dashboard in browser. */
  open() {
    const port = getPort();
    const pid = getRunningPid();
    if (!pid) {
      info("仪表盘未运行，正在启动...");
      commands.start();
      setTimeout(() => openBrowser(`http://localhost:${port}`), 3000);
    } else {
      openBrowser(`http://localhost:${port}`);
    }
  },

  /** Build for production. */
  build() {
    log("正在构建 Pi 用量仪表盘...");
    try {
      execSync("npm run build", { cwd: PROJECT_DIR, stdio: "inherit" });
      success("构建完成。");
    } catch {
      error("构建失败。");
      process.exit(1);
    }
  },

  /** Change the port. */
  port(args) {
    const newPort = parseInt(args[0], 10);
    if (!newPort || newPort < 1 || newPort > 65535) {
      error("用法: pi-usage port <端口号> (1-65535)");
      return;
    }

    const pkgPath = join(PROJECT_DIR, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

    pkg.scripts.dev = `next dev --hostname 127.0.0.1 --port ${newPort}`;
    pkg.scripts.start = `next start --hostname 127.0.0.1 --port ${newPort}`;

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    success(`端口已更改为 ${newPort}`);
    info("请重启仪表盘使更改生效。");
  },

  /** Pull latest changes, reinstall deps, rebuild, and restart. */
  update() {
    log("正在更新 Pi 用量仪表盘...");

    // Check if it's a git repo
    try {
      execSync("git rev-parse --is-inside-work-tree", { cwd: PROJECT_DIR, stdio: "ignore" });
    } catch {
      error("不是有效的 git 仓库，无法自动更新。");
      info("如果是通过 npm 安装的，请运行: npm update -g pi-usage-dashboard");
      return;
    }

    // Pull latest
    log("正在拉取最新代码...");
    try {
      const output = execSync("git pull", { cwd: PROJECT_DIR, encoding: "utf-8" });
      console.log(`  ${output.trim()}`);
    } catch (e) {
      error("git pull 失败，请手动解决冲突。");
      return;
    }

    // Install deps
    log("正在安装依赖...");
    try {
      execSync("npm install", { cwd: PROJECT_DIR, stdio: "inherit" });
    } catch {
      error("npm install 依赖安装失败。");
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
        success("更新完成！");
      }, 1500);
    } else {
      success("更新完成！运行 'pi-usage start' 即可启动。");
    }
  },

  /** Show recent logs. */
  logs() {
    if (!existsSync(LOG_FILE)) {
      info("未找到日志文件。");
      return;
    }

    log(`日志文件: ${LOG_FILE}\n`);
    try {
      const content = readFileSync(LOG_FILE, "utf-8");
      const lines = content.trim().split("\n");
      const tail = lines.slice(-50);
      console.log(tail.join("\n"));
    } catch (e) {
      error(`读取日志失败: ${e.message}`);
    }
  },

  /** Show help. */
  help() {
    console.log(`
  Pi 用量仪表盘 (Pi Usage Dashboard) CLI

  用法:
    pi-usage <命令> [选项]

  命令列表:
    start           在后台启动仪表盘服务
    stop            停止运行中的仪表盘服务
    restart         重启仪表盘服务
    status          检查仪表盘当前运行状态
    open            在默认浏览器中打开仪表盘（未启动则自动启动）
    dev             以开发模式在前台运行（热重载）
    build           打包编译生产环境产物
    update          拉取最新代码 + 安装依赖 + 重新构建 + 重启
    port <端口号>   更改仪表盘运行端口 (默认: ${DEFAULT_PORT})
    logs            查看最近 50 行运行日志
    help            显示此帮助信息

  常用示例:
    pi-usage start          # 启动仪表盘
    pi-usage open           # 在浏览器中打开（需要时自动启动）
    pi-usage update         # 更新至最新版本
    pi-usage port 8080      # 将端口修改为 8080
    pi-usage restart        # 修改配置后重启
    pi-usage stop           # 停止运行

  相关文件:
    PID 文件:  ${PID_FILE}
    日志文件:  ${LOG_FILE}
    数据库:    ${join(PID_DIR, "usage-dashboard.db")}
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
  error(`未知命令: ${command}`);
  console.log("  运行 'pi-usage help' 查看所有可用命令。");
  process.exit(1);
}
