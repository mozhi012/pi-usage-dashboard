/**
 * Database module for pi-usage-dashboard.
 *
 * Stores model pricing and session source configurations in a local SQLite database.
 * Database location: ~/.pi/agent/usage-dashboard.db
 */
import Database from "better-sqlite3";
import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

const DB_DIR = join(homedir(), ".pi", "agent");
const DB_PATH = join(DB_DIR, "usage-dashboard.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS model_pricing (
      model TEXT PRIMARY KEY,
      input_price REAL NOT NULL DEFAULT 0,
      output_price REAL NOT NULL DEFAULT 0,
      cache_read_price REAL NOT NULL DEFAULT 0,
      cache_write_price REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS session_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return _db;
}

export interface ModelPricing {
  model: string;
  inputPrice: number;   // per 1M tokens
  outputPrice: number;  // per 1M tokens
  cacheReadPrice: number;  // per 1M tokens
  cacheWritePrice: number; // per 1M tokens
  updatedAt: string;
}

export function getAllPricing(): ModelPricing[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM model_pricing ORDER BY model")
    .all() as {
    model: string;
    input_price: number;
    output_price: number;
    cache_read_price: number;
    cache_write_price: number;
    updated_at: string;
  }[];

  return rows.map((r) => ({
    model: r.model,
    inputPrice: r.input_price,
    outputPrice: r.output_price,
    cacheReadPrice: r.cache_read_price,
    cacheWritePrice: r.cache_write_price,
    updatedAt: r.updated_at,
  }));
}

export function getPricing(model: string): ModelPricing | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM model_pricing WHERE model = ?").get(model) as {
    model: string;
    input_price: number;
    output_price: number;
    cache_read_price: number;
    cache_write_price: number;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  return {
    model: row.model,
    inputPrice: row.input_price,
    outputPrice: row.output_price,
    cacheReadPrice: row.cache_read_price,
    cacheWritePrice: row.cache_write_price,
    updatedAt: row.updated_at,
  };
}

export function upsertPricing(pricing: Omit<ModelPricing, "updatedAt">): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO model_pricing (model, input_price, output_price, cache_read_price, cache_write_price, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(model) DO UPDATE SET
       input_price = excluded.input_price,
       output_price = excluded.output_price,
       cache_read_price = excluded.cache_read_price,
       cache_write_price = excluded.cache_write_price,
       updated_at = datetime('now')`
  ).run(
    pricing.model,
    pricing.inputPrice,
    pricing.outputPrice,
    pricing.cacheReadPrice,
    pricing.cacheWritePrice
  );
}

export function deletePricing(model: string): void {
  const db = getDb();
  db.prepare("DELETE FROM model_pricing WHERE model = ?").run(model);
}

export function getPricingMap(): Map<string, ModelPricing> {
  const all = getAllPricing();
  const map = new Map<string, ModelPricing>();
  for (const p of all) {
    map.set(p.model, p);
  }
  return map;
}

// ============ Session Sources ============

export interface SessionSource {
  id: number;
  path: string;
  label: string;
  enabled: boolean;
  createdAt: string;
}

export function getAllSessionSources(): SessionSource[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM session_sources ORDER BY created_at")
    .all() as {
    id: number;
    path: string;
    label: string;
    enabled: number;
    created_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    label: r.label,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
  }));
}

export function addSessionSource(path: string, label: string): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO session_sources (path, label) VALUES (?, ?)`
  ).run(path, label);
}

export function updateSessionSource(
  id: number,
  updates: { path?: string; label?: string; enabled?: boolean }
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (updates.path !== undefined) {
    sets.push("path = ?");
    values.push(updates.path);
  }
  if (updates.label !== undefined) {
    sets.push("label = ?");
    values.push(updates.label);
  }
  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(updates.enabled ? 1 : 0);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE session_sources SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values
  );
}

export function deleteSessionSource(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM session_sources WHERE id = ?").run(id);
}

/** Calculate cost for a given usage based on pricing (prices are per 1M tokens) */
export function calculateCost(
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
  pricing: ModelPricing
): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } {
  const input = (usage.input / 1_000_000) * pricing.inputPrice;
  const output = (usage.output / 1_000_000) * pricing.outputPrice;
  const cacheRead = (usage.cacheRead / 1_000_000) * pricing.cacheReadPrice;
  const cacheWrite = (usage.cacheWrite / 1_000_000) * pricing.cacheWritePrice;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
  };
}
