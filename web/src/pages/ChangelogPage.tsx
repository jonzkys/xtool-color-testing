/**
 * Changelog — workshop-log style timeline of workbench updates.
 *
 * Two entry shapes:
 *   - major: framed "poster" card with title, summary, images, and a
 *     markdown body. Gets real estate and typographic air.
 *   - minor: single-line entry in a dense rail; date + title only.
 *
 * Entries come from the backend which parses markdown files under
 * ``changelog/``. On mount the page marks the newest entry as seen so
 * the TopBar's NEW badge dismisses.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getHealth } from "../api/users";
import {
  getChangelog,
  markChangelogSeen,
  type ChangelogEntry,
  type ChangelogPayload,
} from "../api/changelog";
import { cn, MetalBar, PageContainer } from "../ui";

export function ChangelogPage() {
  const [data, setData] = useState<ChangelogPayload | null>(null);
  const [error, setError] = useState<string | undefined>();
  const seenRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const h = await getHealth();
      const payload = await getChangelog(h.mode);
      setData(payload);
      // Mark seen once per page-visit. We don't gate on unseen_count>0
      // because even a user who already "saw" things might want to
      // re-visit — a second write is harmless.
      if (!seenRef.current && payload.latest_id) {
        seenRef.current = true;
        try {
          await markChangelogSeen(payload.latest_id, h.mode);
          // Emit a DOM event so the TopBar can clear its NEW badge
          // without a full re-fetch.
          window.dispatchEvent(new CustomEvent("changelog:seen"));
        } catch {
          // Non-fatal — badge will clear on next page load.
        }
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <PageContainer className="py-10">
        <div className="rounded-[8px] border border-[color:var(--color-destructive)]/30 bg-[color:var(--color-destructive-tint)] px-3 py-2 text-[13px] text-[color:var(--color-destructive)]">
          {error}
        </div>
      </PageContainer>
    );
  }

  if (!data) {
    return (
      <PageContainer className="py-10">
        <div className="text-[13px] text-[color:var(--color-ink-muted)]">Loading…</div>
      </PageContainer>
    );
  }

  return (
    <div className="relative">
      <PageContainer className="py-10 max-w-[960px]">
        <Masthead count={data.entries.length} />
        {data.entries.length === 0 ? (
          <div className="mt-6 rounded-[8px] border border-dashed border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-4 py-8 text-center text-[13px] text-[color:var(--color-ink-muted)]">
            No entries yet. First one lands when the next feature ships.
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-6">
            {data.entries.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                unseen={
                  data.last_seen_id == null
                    ? true
                    : e.id > data.last_seen_id
                }
              />
            ))}
          </div>
        )}
      </PageContainer>
    </div>
  );
}

/* ========================================================================
 * Masthead
 * ====================================================================== */

function Masthead({ count }: { count: number }) {
  return (
    <header className="mb-6">
      <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.24em] uppercase text-[color:var(--color-ink-subtle)] mb-2">
        <span className="h-px w-5 bg-[color:var(--color-border-strong)]" aria-hidden />
        Workbench log · {count} {count === 1 ? "entry" : "entries"}
      </div>
      <h1 className="text-[28px] font-semibold leading-[1.1] text-[color:var(--color-ink)]">
        <span>What changed.</span>{" "}
        <em className="not-italic text-[color:var(--color-primary)]">And when.</em>
      </h1>
      <p className="mt-2 text-[13.5px] leading-[1.55] text-[color:var(--color-ink-muted)] max-w-[68ch]">
        Shipped updates, newest first. Larger changes get their own
        write-up with screenshots; smaller fixes sit on a single line.
      </p>
      <div className="mt-4"><MetalBar /></div>
    </header>
  );
}

/* ========================================================================
 * Entry renderers
 * ====================================================================== */

function EntryCard({ entry, unseen }: { entry: ChangelogEntry; unseen: boolean }) {
  if (entry.level === "minor") return <MinorEntry entry={entry} unseen={unseen} />;
  return <MajorEntry entry={entry} unseen={unseen} />;
}

function MinorEntry({ entry, unseen }: { entry: ChangelogEntry; unseen: boolean }) {
  return (
    <article className="relative flex items-baseline gap-3 border-b border-[color:var(--color-border)] pb-3">
      <FormattedDate iso={entry.date} />
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2">
          <h3 className="text-[13.5px] leading-[1.45] text-[color:var(--color-ink)]">
            {entry.title}
          </h3>
          {unseen && <NewDot />}
        </div>
        {entry.summary && (
          <p className="mt-0.5 text-[12.5px] text-[color:var(--color-ink-muted)]">
            {entry.summary}
          </p>
        )}
      </div>
    </article>
  );
}

function MajorEntry({ entry, unseen }: { entry: ChangelogEntry; unseen: boolean }) {
  return (
    <article
      className={cn(
        "relative rounded-[10px] border bg-[color:var(--color-surface-elevated)] p-5",
        "border-[color:var(--color-border)]",
        unseen && "ring-1 ring-[color:var(--color-primary)]/30",
      )}
    >
      {unseen && (
        <div className="absolute -top-2 left-5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-primary)]/50 bg-[color:var(--color-surface)] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.16em] uppercase text-[color:var(--color-primary)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-primary)]" />
            New
          </span>
        </div>
      )}
      <header className="flex items-baseline gap-3">
        <FormattedDate iso={entry.date} />
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.2em] uppercase text-[color:var(--color-primary)]">
            <span className="h-px w-4 bg-[color:var(--color-primary)]/60" aria-hidden />
            Major update
          </div>
          <h2 className="mt-1 text-[20px] font-semibold leading-[1.2] text-[color:var(--color-ink)]">
            {entry.title}
          </h2>
          {entry.summary && (
            <p className="mt-1 text-[13.5px] text-[color:var(--color-ink-muted)] max-w-[72ch]">
              {entry.summary}
            </p>
          )}
        </div>
      </header>

      {entry.images.length > 0 && (
        <div className="mt-4 flex flex-col gap-3">
          {entry.images.map((img, i) => (
            <figure
              key={i}
              className="rounded-[8px] overflow-hidden border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]"
            >
              <img
                src={img.src}
                alt={img.caption || entry.title}
                loading="lazy"
                className="block w-full h-auto"
              />
              {img.caption && (
                <figcaption className="px-3 py-2 text-[12px] leading-[1.5] text-[color:var(--color-ink-muted)] border-t border-[color:var(--color-border)]">
                  {img.caption}
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {entry.body_md && (
        <div className="mt-4 changelog-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body_md}</ReactMarkdown>
        </div>
      )}
    </article>
  );
}

function FormattedDate({ iso }: { iso: string }) {
  // "2026-04-23" → "23 Apr 2026". Parse manually so we don't get
  // caught by JS's Date-string timezone quirks (string without time is
  // UTC midnight which can rollback a day in negative timezones).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  let text = iso;
  if (m) {
    const [_, y, mm, dd] = m;
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const monthIx = Math.max(0, Math.min(11, Number(mm) - 1));
    text = `${Number(dd)} ${months[monthIx]} ${y}`;
  }
  return (
    <time
      dateTime={iso}
      className="font-mono text-[11px] tabular-nums tracking-[0.04em] text-[color:var(--color-ink-subtle)] w-[82px] shrink-0 pt-0.5"
    >
      {text}
    </time>
  );
}

function NewDot() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-[color:var(--color-primary-tint)] px-1.5 py-[1px] font-mono text-[9px] font-semibold tracking-[0.14em] uppercase text-[color:var(--color-primary)]"
      title="New since you last visited"
    >
      <span className="h-1 w-1 rounded-full bg-[color:var(--color-primary)]" aria-hidden />
      New
    </span>
  );
}
