import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LogRecord, LogSeverity } from "@xoom/shared-types";

interface FileCursor {
  size: number;
}

/**
 * Tails one or more log directories/files (e.g. SwarmClaw/OpenClaw log folders)
 * and converts new lines into structured LogRecords. Tracks per-file byte
 * offsets in memory so each poll ships only new content. JSON lines are parsed
 * into attributes; plain lines keep severity heuristics.
 */
export class LogShipper {
  private cursors = new Map<string, FileCursor>();

  constructor(private readonly dirs: string[]) {}

  /** Returns new log records since the last call across all configured paths. */
  collect(maxBytesPerFile = 256 * 1024): LogRecord[] {
    const records: LogRecord[] = [];
    for (const path of this.expandFiles()) {
      try {
        const st = statSync(path);
        const prev = this.cursors.get(path)?.size ?? st.size; // first sight: start at EOF
        if (st.size < prev) {
          // file rotated/truncated — restart from 0
          this.cursors.set(path, { size: 0 });
        }
        const from = Math.max(0, Math.min(this.cursors.get(path)?.size ?? prev, st.size));
        const len = Math.min(st.size - from, maxBytesPerFile);
        if (len > 0) {
          const fd = openSync(path, "r");
          const buf = Buffer.alloc(len);
          readSync(fd, buf, 0, len, from);
          closeSync(fd);
          for (const line of buf.toString("utf8").split("\n")) {
            const rec = this.parseLine(line.trim(), path);
            if (rec) records.push(rec);
          }
        }
        this.cursors.set(path, { size: st.size });
      } catch {
        /* file disappeared / unreadable — skip this round */
      }
    }
    return records;
  }

  private expandFiles(): string[] {
    const files: string[] = [];
    for (const entry of this.dirs) {
      if (!existsSync(entry)) continue;
      try {
        const st = statSync(entry);
        if (st.isFile()) files.push(entry);
        else if (st.isDirectory()) {
          for (const f of readdirSync(entry)) {
            if (f.endsWith(".log") || f.endsWith(".jsonl") || f.endsWith(".ndjson")) files.push(join(entry, f));
          }
        }
      } catch {
        /* skip */
      }
    }
    return files;
  }

  private parseLine(line: string, path: string): LogRecord | null {
    if (!line) return null;
    const collector = `logfile:${path}`;
    // Structured JSON line?
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        const msg = String(obj.message ?? obj.msg ?? line);
        return {
          ts: toTs(obj.ts ?? obj.time ?? obj.timestamp),
          severity: normalizeSeverity(obj.level ?? obj.severity),
          message: msg,
          attributes: obj,
          trace_id: typeof obj.trace_id === "string" ? obj.trace_id : undefined,
          collector,
        };
      } catch {
        /* fall through to plain */
      }
    }
    return { ts: Date.now(), severity: heuristicSeverity(line), message: line, collector };
  }
}

function toTs(v: unknown): number {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return Date.now();
}

function normalizeSeverity(v: unknown): LogSeverity {
  const s = String(v ?? "info").toLowerCase();
  if (["trace", "debug", "info", "warn", "error", "fatal"].includes(s)) return s as LogSeverity;
  if (s === "warning") return "warn";
  if (s === "critical" || s === "crit") return "fatal";
  return "info";
}

function heuristicSeverity(line: string): LogSeverity {
  const l = line.toLowerCase();
  if (l.includes("fatal") || l.includes("panic")) return "fatal";
  if (l.includes("error") || l.includes("exception")) return "error";
  if (l.includes("warn")) return "warn";
  if (l.includes("debug")) return "debug";
  return "info";
}
