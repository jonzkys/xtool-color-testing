import { useState, type ReactNode } from "react";
import { Camera, Copy, Download, Save, Trash2 } from "lucide-react";
import { Button, DemoLock } from "xcs-gen-web";

/**
 * DemoLock derives "am I in the demo account?" from localStorage
 * (`xcsgen:userId === "DEMO"`), so a story has to put the app in that
 * account before the lock can be shown. `Account` writes the flag from a
 * `useState` initialiser: React renders a parent before its children, so
 * the value is in place by the time the DemoLock inside it first reads it.
 * That also makes the two halves of `SignedInVsDemo` independent — siblings
 * mount in order, each re-writing the flag for its own subtree.
 */
function Account({ demo, children }: { demo: boolean; children: ReactNode }) {
  useState(() => {
    try {
      if (demo) window.localStorage.setItem("xcsgen:userId", "DEMO");
      else window.localStorage.removeItem("xcsgen:userId");
    } catch {
      /* storage disabled */
    }
    return null;
  });
  return <>{children}</>;
}

function TestActionBar() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DemoLock label="Saving test edits is disabled in the demo.">
        <Button variant="secondary">
          <Save className="h-4 w-4" />
          Save
        </Button>
      </DemoLock>
      <DemoLock label="Generating the project file is disabled in the demo.">
        <Button variant="primary">
          <Download className="h-4 w-4" />
          Generate .xcs
        </Button>
      </DemoLock>
      <DemoLock label="Duplicating tests is disabled in the demo.">
        <Button variant="ghost" size="sm">
          <Copy className="h-3.5 w-3.5" />
          Duplicate
        </Button>
      </DemoLock>
      <DemoLock label="Deleting tests is disabled in the demo.">
        <Button
          variant="ghost"
          size="sm"
          className="text-[color:var(--color-destructive)] hover:bg-[color:var(--color-destructive-tint)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </DemoLock>
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)]">
      {children}
    </div>
  );
}

export function SignedIn() {
  return (
    <Account demo={false}>
      <Caption>Signed-in account — pass-through</Caption>
      <TestActionBar />
      <p className="mt-3 text-[13px] text-[color:var(--color-ink-muted)] max-w-[420px]">
        Outside demo mode DemoLock renders its child verbatim — no wrapper
        span, no extra DOM.
      </p>
    </Account>
  );
}

export function DemoAccount() {
  return (
    <Account demo>
      <Caption>Demo account — locked</Caption>
      <TestActionBar />
      <p className="mt-3 text-[13px] text-[color:var(--color-ink-muted)] max-w-[420px]">
        Every write action is disabled and carries its own tooltip naming the
        blocked action.
      </p>
    </Account>
  );
}

export function SignedInVsDemo() {
  return (
    <div className="grid grid-cols-2 gap-6 max-w-[640px]">
      <Account demo={false}>
        <div>
          <Caption>Signed in</Caption>
          <DemoLock label="Uploading photos is disabled in the demo.">
            <Button variant="primary">
              <Camera className="h-4 w-4" />
              Upload photo
            </Button>
          </DemoLock>
        </div>
      </Account>
      <Account demo>
        <div>
          <Caption>Demo</Caption>
          <DemoLock label="Uploading photos is disabled in the demo.">
            <Button variant="primary">
              <Camera className="h-4 w-4" />
              Upload photo
            </Button>
          </DemoLock>
        </div>
      </Account>
    </div>
  );
}
