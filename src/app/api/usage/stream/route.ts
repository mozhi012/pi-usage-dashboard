/**
 * Usage Stream API (Server-Sent Events)
 *
 * Provides real-time updates when session files change.
 * Watches all configured session source directories using chokidar.
 * Reconnect the SSE after adding new sources to pick up new watch paths.
 *
 * GET /api/usage/stream
 */
import { NextResponse } from "next/server";
import { watch } from "chokidar";
import { join } from "path";
import { getAllUsageData } from "@/lib/parse-sessions";
import { getSessionDirs } from "@/lib/session-paths";

function getAllWatchPaths(): string[] {
  return getSessionDirs().map((dir) => join(dir, "**/*.jsonl"));
}

export async function GET() {
  const watchPaths = getAllWatchPaths();

  const encoder = new TextEncoder();
  let watcherClosed = false;
  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial data
      getAllUsageData()
        .then((data) => {
          if (!watcherClosed) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          }
        })
        .catch((err) => {
          console.error("Error reading initial sessions:", err);
        });

      // Watch for changes in all session directories
      const watcher = watch(watchPaths, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100,
        },
      });

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const sendUpdate = () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          if (watcherClosed) return;
          try {
            const data = await getAllUsageData();
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
            );
          } catch (err) {
            console.error("Error reading sessions:", err);
          }
        }, 1000);
      };

      watcher.on("add", sendUpdate);
      watcher.on("change", sendUpdate);
      watcher.on("unlink", sendUpdate);

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        if (!watcherClosed) {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        }
      }, 30000);

      // Cleanup on close
      cleanup = () => {
        watcherClosed = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        clearInterval(heartbeat);
        void watcher.close();
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
