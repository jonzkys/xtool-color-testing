/**
 * Changelog API client.
 *
 * Unseen-count handling differs by mode:
 *  - multi_user: `last_seen_id` is tracked server-side on the users
 *    table; the backend returns `unseen_count` computed against it.
 *  - standalone: no user row to attach to, so the "seen" value lives
 *    in localStorage. This client overlays that locally on top of the
 *    server payload.
 */

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export type ChangelogLevel = "major" | "minor";

export interface ChangelogImage {
  src: string;
  caption: string;
}

export interface ChangelogEntry {
  id: string;
  date: string;         // YYYY-MM-DD
  level: ChangelogLevel;
  title: string;
  summary: string;
  body_md: string;      // empty for minors
  images: ChangelogImage[];
}

export interface ChangelogPayload {
  entries: ChangelogEntry[];
  latest_id: string | null;
  last_seen_id: string | null;   // null = never dismissed
  unseen_count: number;
}

const STANDALONE_SEEN_KEY = "xcs-gen.changelog.last_seen_id";

function readLocalSeenId(): string | null {
  try {
    return window.localStorage.getItem(STANDALONE_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeLocalSeenId(id: string) {
  try {
    window.localStorage.setItem(STANDALONE_SEEN_KEY, id);
  } catch {
    // Storage unavailable (private-mode Safari etc.) — the badge just
    // won't dismiss across sessions. Not worth surfacing.
  }
}

/**
 * Fetch the changelog list. When `mode === "standalone"` the backend's
 * `last_seen_id` / `unseen_count` are ignored; we overlay the
 * localStorage value instead so the NEW badge works without a users
 * table.
 */
export async function getChangelog(
  mode: "standalone" | "multi_user",
): Promise<ChangelogPayload> {
  const payload = await j<ChangelogPayload>(await fetch("/api/changelog"));
  if (mode !== "standalone") return payload;

  const localSeen = readLocalSeenId();
  const unseen =
    payload.latest_id == null
      ? 0
      : localSeen == null
        ? payload.entries.length
        : payload.entries.filter((e) => e.id > localSeen).length;
  return { ...payload, last_seen_id: localSeen, unseen_count: unseen };
}

/**
 * Record that the user has viewed entries up to `id`. Multi-user
 * persists server-side; standalone writes localStorage.
 */
export async function markChangelogSeen(
  id: string,
  mode: "standalone" | "multi_user",
): Promise<void> {
  if (mode === "standalone") {
    writeLocalSeenId(id);
    return;
  }
  await j(
    await fetch("/api/users/me/seen-changelog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }),
  );
}
