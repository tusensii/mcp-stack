import { GitHubApiError } from "../github/client.js";

/**
 * Minimal shape of `GitHubClient` this module depends on — kept narrow so
 * tests can pass a stub instead of a real client.
 */
export interface LabelLookupClient {
  get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

interface RepoLabel {
  name: string;
}

/**
 * Pick a color for an auto-created label based on naming convention.
 * `app:*` labels get the established purple used across the monorepo's
 * queue-scannability convention (see CLAUDE.md); any other `prefix:*` label
 * (e.g. `area:*`, `priority:*`) gets a neutral blue; unprefixed labels get
 * neutral grey.
 */
export function labelColorFor(name: string): string {
  if (/^app:/i.test(name)) return "5319e7";
  if (/^[^:\s]+:/.test(name)) return "1d76db";
  return "ededed";
}

/**
 * Ensure every label in `names` exists on the repo, creating any that are
 * missing using a color heuristic (see `labelColorFor`). Returns the list
 * of label names that were actually created (empty if all already existed).
 *
 * Only the first page (100) of repo labels is consulted — repos with more
 * distinct labels than that are not expected in this workflow. A label
 * creation that races another caller and 422s as "already exists" is
 * treated as success, not an error.
 */
export async function ensureLabelsExist(
  client: LabelLookupClient,
  owner: string,
  repo: string,
  names: string[],
): Promise<string[]> {
  if (names.length === 0) return [];

  const existing = await client.get<RepoLabel[]>(`/repos/${owner}/${repo}/labels`, {
    per_page: 100,
  });
  const existingNames = new Set(existing.map((l) => l.name.toLowerCase()));
  const missing = names.filter((n) => !existingNames.has(n.toLowerCase()));

  const created: string[] = [];
  for (const name of missing) {
    try {
      await client.post(`/repos/${owner}/${repo}/labels`, {
        name,
        color: labelColorFor(name),
        description: "Auto-created by github-mcp.",
      });
      created.push(name);
    } catch (e) {
      // A concurrent caller may have created the same label first (422
      // "already_exists"); that's fine, the label exists either way. Any
      // other failure (permissions, rate limit, etc.) should surface.
      if (!(e instanceof GitHubApiError && e.statusCode === 422)) throw e;
    }
  }
  return created;
}
