/**
 * <pvnc>
 *     reason: Two-tier contribution store — contributions_commit.jsonl travels with each commit, contributions_all.jsonl accumulates the full project history for new cloners
 *     source: ai.claude
 * </pvnc>
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { ContributionEvent, makeId } from './types';

// ── Paths ─────────────────────────────────────────────────────────────────────

function pvncDir(root: string): string {
  return path.join(root, '.pvnc');
}

function commitPath(root: string): string {
  return path.join(pvncDir(root), 'contributions_commit.jsonl');
}

function allPath(root: string): string {
  return path.join(pvncDir(root), 'contributions_all.jsonl');
}

function ensureDir(root: string): void {
  const dir = pvncDir(root);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── JSONL helpers ─────────────────────────────────────────────────────────────

function readJsonl(filePath: string): ContributionEvent[] {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => {
      try { return JSON.parse(l) as ContributionEvent; }
      catch { return null; }
    })
    .filter((e): e is ContributionEvent => e !== null);
}

function appendJsonl(filePath: string, event: ContributionEvent): void {
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf8');
}

// ── Public API ────────────────────────────────────────────────────────────────

export class ContributionStore extends EventEmitter {
  private readonly root: string;
  /** In-memory view: all + commit entries, deduped by id. */
  private cache: Map<string, ContributionEvent> = new Map();
  private watcher: fs.FSWatcher | null = null;
  /** Debounce timer for external file change events. */
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: string) {
    super();
    this.root = root;
    ensureDir(root);
    // Ensure contributions_commit.jsonl exists so the pre-commit hook can stage it.
    const commitFile = commitPath(root);
    if (!fs.existsSync(commitFile)) fs.writeFileSync(commitFile, '', 'utf8');
    this.reload();
    this.watchAllFile();
  }

  /** Re-read both JSONL files into the in-memory cache. */
  reload(): void {
    this.cache.clear();
    for (const e of readJsonl(allPath(this.root)))    this.cache.set(e.id, e);
    for (const e of readJsonl(commitPath(this.root))) this.cache.set(e.id, e);
  }

  /**
   * Watch contributions_all.jsonl for external changes (git pull, clone).
   * Debounced to avoid thrashing on rapid successive writes.
   */
  private watchAllFile(): void {
    const file = allPath(this.root);
    // Ensure the file exists before watching.
    if (!fs.existsSync(file)) fs.writeFileSync(file, '', 'utf8');
    try {
      this.watcher = fs.watch(file, () => {
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.reload();
          this.emit('updated');
        }, 500);
      });
    } catch {
      // Non-fatal: some environments (e.g. network FS) don't support fs.watch.
    }
  }

  dispose(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.watcher?.close();
  }

  /**
   * Append an event to both JSONL files and update the cache.
   * Callers should supply all fields except `id` and `ts` (auto-filled).
   */
  append(partial: Omit<ContributionEvent, 'id' | 'ts'>): ContributionEvent {
    const event: ContributionEvent = {
      id: makeId(),
      ts: new Date().toISOString(),
      ...partial,
    };
    appendJsonl(commitPath(this.root), event);
    appendJsonl(allPath(this.root), event);
    this.cache.set(event.id, event);
    return event;
  }

  // ── Query API ───────────────────────────────────────────────────────────────

  getAll(): ContributionEvent[] {
    return [...this.cache.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  }

  getByFile(relFile: string): ContributionEvent[] {
    const norm = relFile.replace(/\\/g, '/');
    return this.getAll().filter(e => e.file === norm);
  }

  getBySource(source: string): ContributionEvent[] {
    return this.getAll().filter(e => e.source === source);
  }

  getSince(isoDate: string): ContributionEvent[] {
    return this.getAll().filter(e => e.ts >= isoDate);
  }

  /**
   * Aggregated summary suitable for reporting.
   * Returns totals grouped by source and by file.
   */
  getSummary(): {
    bySource: Record<string, { events: number; lines: number }>;
    byFile:   Record<string, { events: number; lines: number }>;
  } {
    const bySource: Record<string, { events: number; lines: number }> = {};
    const byFile:   Record<string, { events: number; lines: number }> = {};

    for (const e of this.cache.values()) {
      const delta = e.lines_delta ?? 0;

      if (!bySource[e.source]) bySource[e.source] = { events: 0, lines: 0 };
      bySource[e.source].events++;
      bySource[e.source].lines += delta;

      if (!byFile[e.file]) byFile[e.file] = { events: 0, lines: 0 };
      byFile[e.file].events++;
      byFile[e.file].lines += delta;
    }

    return { bySource, byFile };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _store: ContributionStore | null = null;

export function initStore(root: string): ContributionStore {
  _store = new ContributionStore(root);
  return _store;
}

export function getStore(): ContributionStore | null {
  return _store;
}
