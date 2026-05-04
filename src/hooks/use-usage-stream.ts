"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AggregatedData } from "@/lib/parse-sessions";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function useUsageStream() {
  const [data, setData] = useState<AggregatedData | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
    }

    setStatus("connecting");

    const es = new EventSource("/api/usage/stream");
    eventSourceRef.current = es;

    es.onopen = () => {
      setStatus("connected");
    };

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as AggregatedData;
        setData(parsed);
        setLastUpdated(new Date());
        setStatus("connected");
      } catch (err) {
        console.error("Failed to parse SSE data:", err);
      }
    };

    es.onerror = () => {
      es.close();
      setStatus("disconnected");

      // Reconnect after 3 seconds
      reconnectTimerRef.current = setTimeout(() => {
        connectRef.current();
      }, 3000);
    };
  }, []);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Manual refresh failed:", err);
    }
  }, []);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      // Fetch fresh data
      const res = await fetch("/api/usage");
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());

      // Reconnect SSE to pick up any new/changed source paths in the watcher
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      connect();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  }, [connect]);

  useEffect(() => {
    const timer = setTimeout(connect, 0);

    return () => {
      clearTimeout(timer);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return { data, status, lastUpdated, syncing, refresh, sync };
}
