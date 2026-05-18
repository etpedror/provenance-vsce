export type EventType = 'edit' | 'guard_removed' | 'guard_added';

export interface ContributionEvent {
  /** Unique ID: timestamp-base36 + random suffix. Sortable and collision-resistant. */
  id: string;
  /** ISO 8601 UTC timestamp. */
  ts: string;
  /** Who made the change — 'ai.claude', 'ai.copilot', 'unattributed', etc. */
  source: string;
  /** Repo-relative file path, forward-slash separated. */
  file: string;
  /** Net lines added/removed. null when not applicable (e.g. guard events with no delta). */
  lines_delta: number | null;
  /** Total lines in the file at time of event. null if undetectable. */
  file_lines: number | null;
  /** What happened. */
  event: EventType;
  /** Populated for guard_removed / guard_added events. */
  guard_id?: string;
  /** Optional ticket reference, e.g. 'github:42', 'jira:PROJ-1'. */
  ticket?: string;
}

export function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
