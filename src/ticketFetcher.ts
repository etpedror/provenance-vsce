import * as vscode from 'vscode';
import { PvncConfig } from './pvncConfig';

/**
 * <pvnc>
 *     requirement: UNKNOWN
 *     reason: Fetch live ticket data to enrich hover tooltips; GitHub uses VS Code built-in auth so no credentials need to be stored
 *     source: ai.claude
 * </pvnc>
 */
export interface TicketInfo {
  title: string;
  state: string;
  url: string;
}

let out: vscode.OutputChannel | undefined;

export function initTicketFetcher(outputChannel: vscode.OutputChannel): void {
  out = outputChannel;
}

function log(msg: string): void {
  out?.appendLine(`[provenance] ${msg}`);
}

// null = fetch was attempted and failed; undefined = not yet fetched
const cache = new Map<string, TicketInfo | null>();

export async function fetchTicket(
  id: string,
  system: string | undefined,
  config: PvncConfig,
): Promise<TicketInfo | null> {
  const resolved = system ?? config.defaultSystem;
  log(`fetchTicket id=${id} system=${system ?? '(none)'} resolved=${resolved ?? '(none)'}`);
  if (resolved === 'github') return fetchGitHubIssue(id, config);
  return null;
}

async function fetchGitHubIssue(id: string, config: PvncConfig): Promise<TicketInfo | null> {
  let owner: string | undefined;
  let repo: string | undefined;
  let number: string;

  const crossRepo = id.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (crossRepo) {
    [, owner, repo, number] = crossRepo;
  } else {
    const simple = id.match(/^#?(\d+)$/);
    if (!simple) { log(`id "${id}" did not match simple or cross-repo pattern`); return null; }
    number = simple[1];
    owner = config.github?.owner;
    repo = config.github?.repo;
  }

  log(`resolved → owner=${owner ?? '(none)'} repo=${repo ?? '(none)'} number=${number}`);
  if (!owner || !repo) { log('missing owner or repo — check .pvnc/config.json'); return null; }

  const cacheKey = `github:${owner}/${repo}#${number}`;
  if (cache.has(cacheKey)) { log(`cache hit for ${cacheKey}`); return cache.get(cacheKey)!; }

  let authHeader = '';
  try {
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    if (session) { authHeader = `Bearer ${session.accessToken}`; log('using authenticated request'); }
    else { log('no GitHub session — trying unauthenticated'); }
  } catch (e) {
    log(`getSession error: ${e}`);
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
    log(`GET ${url}`);
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3+json' };
    if (authHeader) headers['Authorization'] = authHeader;

    const res = await fetch(url, { headers });
    log(`response status: ${res.status}`);
    if (!res.ok) {
      const body = await res.text();
      log(`error body: ${body}`);
      // Don't cache errors — let the next hover retry (e.g. after auth or a transient failure)
      return null;
    }

    const data = await res.json() as { title: string; state: string; html_url: string };
    log(`fetched: "${data.title}" [${data.state}]`);
    const info: TicketInfo = { title: data.title, state: data.state, url: data.html_url };
    cache.set(cacheKey, info);
    return info;
  } catch (e) {
    log(`fetch error: ${e}`);
    return null;
  }
}

export function clearTicketCache(): void {
  cache.clear();
}
