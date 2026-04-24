import { useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  LogIn,
  Sparkles,
} from "lucide-react";
import {
  generateApiKey,
  registerUser,
  verifyKey,
} from "../api/users";
import { setCurrentUserId } from "../api/userHeader";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogTitle,
  MetalBar,
} from "../ui";

type Phase =
  | { kind: "choose" }
  | { kind: "generate-confirm"; firstName: string }
  | { kind: "generate-show"; apiKey: string; firstName: string }
  | { kind: "load"; value: string; error?: string; busy?: boolean }
  | { kind: "done" };

/**
 * Shown at app boot when the server is in multi_user mode and no api
 * key is stored locally. Non-dismissable by design — the user must
 * either claim a fresh key or paste an existing one before the rest of
 * the app becomes usable.
 */
export function WelcomeDialog({
  open,
  onResolved,
}: {
  open: boolean;
  onResolved: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });

  // Radix treats onOpenChange(false) as a dismiss attempt. We ignore it
  // here — the only way out is through one of the action buttons.
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        width="md"
        className="p-0 overflow-hidden"
        // Prevent Escape / backdrop-click dismissals.
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Welcome to xcs-gen</DialogTitle>

        {/* Masthead with alpha-access framing */}
        <div className="relative px-6 pt-5 pb-4 bg-[color:var(--color-surface-elevated)]">
          <div className="inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.24em] uppercase text-[color:var(--color-ink-subtle)] mb-1.5">
            <span
              className="h-px w-4 bg-[color:var(--color-border-strong)]"
              aria-hidden
            />
            Alpha access · claim a workbench
          </div>
          <h2 className="text-[18px] font-semibold text-[color:var(--color-ink)] leading-tight">
            Welcome to xcs-gen
          </h2>
          <p className="mt-1 text-[12.5px] text-[color:var(--color-ink-muted)] leading-relaxed max-w-[44ch]">
            This instance is shared, so each workbench (materials, tests,
            palettes) is keyed to a random token. Claim a fresh one, or
            paste an existing one to return to your bench.
          </p>
        </div>

        <MetalBar />

        <div className="p-5">
          {phase.kind === "choose" && (
            <Choose
              onNew={() => setPhase({ kind: "generate-confirm", firstName: "" })}
              onLoad={() => setPhase({ kind: "load", value: "" })}
            />
          )}

          {phase.kind === "generate-confirm" && (
            <GenerateConfirm
              firstName={phase.firstName}
              onChangeName={(n) =>
                setPhase({ kind: "generate-confirm", firstName: n })
              }
              onConfirm={async () => {
                const key = generateApiKey();
                try {
                  await registerUser(key, phase.firstName.trim());
                  setPhase({
                    kind: "generate-show",
                    apiKey: key,
                    firstName: phase.firstName.trim(),
                  });
                } catch (e) {
                  // Key collision is essentially impossible for 12 bytes
                  // of entropy, but if it ever fires we try once more.
                  const key2 = generateApiKey();
                  try {
                    await registerUser(key2, phase.firstName.trim());
                    setPhase({
                      kind: "generate-show",
                      apiKey: key2,
                      firstName: phase.firstName.trim(),
                    });
                  } catch (e2) {
                    alert((e2 as Error).message || (e as Error).message);
                  }
                }
              }}
              onCancel={() => setPhase({ kind: "choose" })}
            />
          )}

          {phase.kind === "generate-show" && (
            <GenerateShow
              apiKey={phase.apiKey}
              firstName={phase.firstName}
              onDone={() => {
                setCurrentUserId(phase.apiKey);
                onResolved();
              }}
            />
          )}

          {phase.kind === "load" && (
            <Load
              value={phase.value}
              error={phase.error}
              busy={phase.busy}
              onChange={(v) =>
                setPhase({ kind: "load", value: v })
              }
              onCancel={() => setPhase({ kind: "choose" })}
              onSubmit={async () => {
                const key = phase.value.trim();
                setPhase({ kind: "load", value: key, busy: true });
                try {
                  await verifyKey(key);
                  setCurrentUserId(key);
                  onResolved();
                } catch (e) {
                  const raw = (e as Error).message;
                  const msg = raw.replace(/^\d{3}\s+/, "").trim() ||
                    "Couldn’t verify that key";
                  setPhase({ kind: "load", value: key, error: msg });
                }
              }}
            />
          )}
        </div>

        <div className="mt-5 flex items-center gap-3 px-6">
          <div className="flex-1 h-px bg-[color:var(--metal-bar-soft)]" />
          <span className="font-mono text-[9.5px] tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            or
          </span>
          <div className="flex-1 h-px bg-[color:var(--metal-bar-soft)]" />
        </div>
        <div className="px-6 pb-6 mt-3">
          <a
            href="#/demo"
            className={cn(
              "flex items-center justify-between gap-3 w-full",
              "rounded-[8px] border border-[color:var(--color-border)]",
              "bg-[color:var(--color-surface-elevated)]",
              "px-3 py-2.5",
              "text-left transition-colors",
              "hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface)]",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/40",
            )}
          >
            <div>
              <div className="text-[13px] font-semibold text-[color:var(--color-ink)]">
                Just browsing? Try the demo account →
              </div>
              <div className="mt-0.5 text-[11px] text-[color:var(--color-ink-subtle)]">
                Read-only access to a pre-filled workbench.
              </div>
            </div>
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---- Choose step ------------------------------------------------------ */

function Choose({
  onNew,
  onLoad,
}: {
  onNew: () => void;
  onLoad: () => void;
}) {
  return (
    <div className="space-y-3">
      <BigOption
        icon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}
        title="Claim a fresh key"
        kicker="Start new"
        body="Creates a new workbench. You'll see the key once — copy it somewhere safe (password manager, notes app). You'll need it to come back."
        onClick={onNew}
        emphasis="primary"
      />
      <div className="flex items-center gap-3 py-0.5">
        <span className="h-px flex-1 bg-[color:var(--color-border)]" />
        <span className="font-mono text-[9.5px] tracking-[0.2em] uppercase text-[color:var(--color-ink-subtle)]">
          or
        </span>
        <span className="h-px flex-1 bg-[color:var(--color-border)]" />
      </div>
      <BigOption
        icon={<LogIn className="h-4 w-4" strokeWidth={1.75} />}
        title="Load an existing key"
        kicker="Returning"
        body="Paste a key you saved earlier to pick up where you left off."
        onClick={onLoad}
        emphasis="neutral"
      />
    </div>
  );
}

function BigOption({
  icon,
  title,
  kicker,
  body,
  onClick,
  emphasis,
}: {
  icon: React.ReactNode;
  title: string;
  kicker: string;
  body: string;
  onClick: () => void;
  emphasis: "primary" | "neutral";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full rounded-[12px] border px-4 py-3 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/50",
        emphasis === "primary"
          ? "border-[color:var(--color-primary)]/45 bg-[color:var(--color-primary-tint)] hover:border-[color:var(--color-primary)] hover:shadow-[0_2px_8px_rgba(184,65,14,0.12)]"
          : "border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-primary)]/50 hover:bg-[color:var(--color-surface-elevated)]",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-full border",
            emphasis === "primary"
              ? "bg-[color:var(--color-surface)] border-[color:var(--color-primary)]/35 text-[color:var(--color-primary)]"
              : "bg-[color:var(--color-surface-elevated)] border-[color:var(--color-border-strong)] text-[color:var(--color-ink-muted)] group-hover:text-[color:var(--color-primary)]",
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
            {kicker}
          </div>
          <div className="text-[13.5px] font-semibold text-[color:var(--color-ink)]">
            {title}
          </div>
          <p className="mt-1 text-[11.5px] text-[color:var(--color-ink-muted)] leading-snug">
            {body}
          </p>
        </div>
      </div>
    </button>
  );
}

/* ---- Generate flow ---------------------------------------------------- */

function GenerateConfirm({
  firstName,
  onChangeName,
  onConfirm,
  onCancel,
}: {
  firstName: string;
  onChangeName: (n: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
          First name · optional
        </label>
        <input
          type="text"
          value={firstName}
          maxLength={40}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="e.g. Jon"
          className={cn(
            "mt-1.5 w-full h-9 px-3 rounded-[6px] text-[14px]",
            "border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)]",
            "focus:outline-none focus:border-[color:var(--color-primary)]/60 focus:ring-2 focus:ring-[color:var(--color-primary)]/20",
          )}
          autoFocus
        />
        <p className="mt-1 font-mono text-[10.5px] text-[color:var(--color-ink-muted)] leading-snug">
          Shown in the top bar so you can tell accounts apart at a
          glance. Leave empty if you prefer.
        </p>
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Back
        </Button>
        <Button variant="primary" onClick={onConfirm}>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
          Generate key
        </Button>
      </div>
    </div>
  );
}

function GenerateShow({
  apiKey,
  firstName,
  onDone,
}: {
  apiKey: string;
  firstName: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(apiKey);
    } catch {
      /* ignore */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      {/* The key, displayed very prominently. */}
      <div>
        <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
          {firstName ? `${firstName}'s key` : "Your key"}
        </div>
        <div className="mt-1.5 rounded-[10px] border-[1.5px] border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary-tint)] p-4">
          <div className="font-mono text-[22px] font-semibold tracking-[0.06em] text-[color:var(--color-ink)] break-all select-all leading-snug">
            {apiKey}
          </div>
          <button
            type="button"
            onClick={copy}
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px]",
              "font-mono text-[10.5px] font-semibold tracking-[0.12em] uppercase",
              "border transition-colors",
              copied
                ? "bg-[color:var(--color-success)] border-[color:var(--color-success)] text-white"
                : "bg-[color:var(--color-surface)] border-[color:var(--color-primary)]/40 text-[color:var(--color-primary)] hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)]",
            )}
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" strokeWidth={2.5} />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" strokeWidth={2} />
                Copy key
              </>
            )}
          </button>
        </div>
      </div>

      <div className="rounded-[8px] border border-[color:var(--color-warning)]/35 bg-[color:var(--color-warning-tint)] px-3.5 py-3">
        <div className="flex items-start gap-2">
          <AlertCircle
            className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[color:var(--color-warning)]"
            strokeWidth={2}
          />
          <div className="text-[11.5px] text-[color:var(--color-ink)] leading-relaxed">
            <strong className="font-semibold">Save this now.</strong> This
            key is shown once — anyone with it can access the same
            workbench. If you lose it there's no recovery in alpha.
          </div>
        </div>
      </div>

      <label className="flex items-start gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 accent-[color:var(--color-primary)] h-4 w-4"
        />
        <span className="text-[12.5px] text-[color:var(--color-ink)] leading-relaxed">
          I've copied the key somewhere safe.
        </span>
      </label>

      <div className="flex justify-end pt-1">
        <Button
          variant="primary"
          onClick={onDone}
          disabled={!confirmed}
        >
          <KeyRound className="h-3.5 w-3.5" strokeWidth={1.75} />
          Enter workbench
        </Button>
      </div>
    </div>
  );
}

/* ---- Load flow -------------------------------------------------------- */

function Load({
  value,
  error,
  busy,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  error?: string;
  busy?: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
          Paste your key
        </label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim().length === 16) onSubmit();
          }}
          placeholder="16 characters"
          className={cn(
            "mt-1.5 w-full h-10 px-3 rounded-[6px] font-mono text-[14px] tabular-nums",
            "border bg-[color:var(--color-surface)]",
            error
              ? "border-[color:var(--color-destructive)] ring-2 ring-[color:var(--color-destructive)]/20"
              : "border-[color:var(--color-border-strong)] focus:border-[color:var(--color-primary)]/60 focus:ring-2 focus:ring-[color:var(--color-primary)]/20",
            "focus:outline-none",
          )}
          autoFocus
          disabled={busy}
        />
        {error && (
          <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-[color:var(--color-destructive)]">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" strokeWidth={2} />
            <span>{error}</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Back
        </Button>
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={busy || value.trim().length !== 16}
        >
          <LogIn className="h-3.5 w-3.5" strokeWidth={1.75} />
          {busy ? "Verifying…" : "Load workbench"}
        </Button>
      </div>
    </div>
  );
}
