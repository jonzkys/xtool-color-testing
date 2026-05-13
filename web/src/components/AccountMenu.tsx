import { useEffect, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Check,
  Copy,
  KeyRound,
  LogOut,
  Pencil,
  RefreshCw,
  User,
} from "lucide-react";
import { getMe, updateMe, type User as UserRecord } from "../api/users";
import { setCurrentUserId } from "../api/userHeader";
import { cn } from "../ui";

/**
 * Top-bar account chip — shown only in multi_user mode. Shows the
 * user's first name (or a masked hint of the key), opens a dropdown
 * with: copy-key · rename · sign-out · switch-account.
 *
 * Sign-out and switch-account both clear localStorage and reload so
 * the WelcomeDialog comes back up. They differ only in intent — "sign
 * out" means "I'm done", "switch" means "show me the welcome modal
 * again".
 */
export function AccountMenu() {
  const [me, setMe] = useState<UserRecord | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void reload();
  }, []);

  const reload = async () => {
    try {
      const user = await getMe();
      setMe(user);
      setDraft(user.first_name);
    } catch {
      // If the key is stale or missing, signOut will recover.
    }
  };

  const copy = async () => {
    if (!me) return;
    try {
      await navigator.clipboard?.writeText(me.api_key);
    } catch {
      /* ignore */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const commitRename = async () => {
    if (!me) return;
    const next = draft.trim();
    if (next !== me.first_name) {
      try {
        const updated = await updateMe(next);
        setMe(updated);
      } catch (e) {
        alert((e as Error).message);
      }
    }
    setRenaming(false);
  };

  const signOutAndReload = () => {
    setCurrentUserId(null);
    localStorage.removeItem("xcsgen:userId:prev");
    window.location.reload();
  };

  // Display name resolution. Empty first_name falls back to a generic
  // "User" so the trigger is always clickable (the previous loading-
  // state placeholder was a non-interactive <div>, which left the
  // user stranded with no way to sign out when getMe failed silently).
  // We deliberately do NOT show a masked api_key here — it's noisy and
  // reads like an account-name to first-time users.
  const display = (me?.first_name && me.first_name.trim()) || "User";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full",
            "font-mono text-[10.5px] font-semibold tracking-[0.1em] uppercase",
            "border transition-colors",
            "bg-[color:var(--color-primary-tint)] border-[color:var(--color-primary)]/40 text-[color:var(--color-primary)]",
            "hover:bg-[color:var(--color-primary)] hover:text-white hover:border-[color:var(--color-primary)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-primary)]/60",
            "data-[state=open]:bg-[color:var(--color-primary)] data-[state=open]:text-white",
          )}
        >
          <User className="h-3 w-3" strokeWidth={2} />
          <span className="max-w-[16ch] truncate">{display}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 min-w-[280px] rounded-[12px] overflow-hidden",
            "border border-[color:var(--color-border)] bg-[color:var(--color-surface)]",
            "shadow-[var(--shadow-popover)]",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=open]:zoom-in-95",
          )}
        >
          {/* Header with name + key snapshot */}
          <div className="px-3.5 pt-3 pb-3 bg-[color:var(--color-surface-elevated)] border-b border-[color:var(--color-border)]">
            <div className="font-mono text-[9.5px] font-semibold tracking-[0.22em] uppercase text-[color:var(--color-ink-subtle)]">
              Workbench
            </div>
            {renaming && me ? (
              <input
                type="text"
                value={draft}
                autoFocus
                maxLength={40}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") {
                    setDraft(me.first_name);
                    setRenaming(false);
                  }
                }}
                className="mt-0.5 w-full h-7 px-1.5 rounded-[4px] text-[14px] font-semibold border border-[color:var(--color-primary)]/60 bg-[color:var(--color-surface)] focus:outline-none"
              />
            ) : (
              <div className="mt-0.5 text-[14px] font-semibold text-[color:var(--color-ink)] truncate">
                {me?.first_name?.trim() || <em className="font-normal text-[color:var(--color-ink-muted)]">no name</em>}
              </div>
            )}
            <div className="mt-1.5 font-mono text-[10.5px] text-[color:var(--color-ink-muted)] tabular-nums break-all select-all">
              {me?.api_key ?? "—"}
            </div>
          </div>

          {me && (
            <>
              <MenuItem
                icon={copied ? <Check className="h-3.5 w-3.5 text-[color:var(--color-success)]" strokeWidth={2.5} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={copied ? "Copied to clipboard" : "Copy api key"}
                onSelect={(e) => {
                  // Keep the dropdown open while the confirmation flashes.
                  e.preventDefault();
                  void copy();
                }}
              />
              <MenuItem
                icon={<Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label={me.first_name?.trim() ? "Rename" : "Add a name"}
                onSelect={(e) => {
                  e.preventDefault();
                  setRenaming(true);
                }}
              />
            </>
          )}

          <DropdownMenu.Separator className="h-px bg-[color:var(--color-border)]" />

          <MenuItem
            icon={<RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Switch account"
            hint="Load a different key"
            onSelect={signOutAndReload}
          />
          <MenuItem
            icon={<LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Sign out"
            hint="Clears this browser's key"
            tone="destructive"
            onSelect={signOutAndReload}
          />

          {/* Explanatory footer so the user remembers this is an alpha
              bearer-token setup, not a real sign-in. */}
          <div className="px-3.5 py-2.5 bg-[color:var(--color-surface-elevated)] border-t border-[color:var(--color-border)]">
            <div className="flex items-start gap-2 text-[10.5px] text-[color:var(--color-ink-muted)] leading-snug">
              <KeyRound className="h-3 w-3 mt-0.5 shrink-0" strokeWidth={1.75} />
              <span>
                Alpha mode · the key is the identity. Keep it safe — there's
                no recovery.
              </span>
            </div>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  tone = "neutral",
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  tone?: "neutral" | "destructive";
  onSelect: (e: Event) => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        "flex items-center gap-2.5 px-3.5 py-2 text-[13px] cursor-pointer outline-none",
        "data-[highlighted]:bg-[color:var(--color-surface-elevated)]",
        tone === "destructive"
          ? "text-[color:var(--color-destructive)]"
          : "text-[color:var(--color-ink)]",
      )}
    >
      <span className="text-[color:var(--color-ink-muted)]">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block leading-tight">{label}</span>
        {hint && (
          <span className="block font-mono text-[10px] tracking-[0.04em] text-[color:var(--color-ink-subtle)] leading-tight">
            {hint}
          </span>
        )}
      </span>
    </DropdownMenu.Item>
  );
}

