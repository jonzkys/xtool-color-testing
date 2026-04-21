import { useState } from "react";
import { AlertTriangle, Check, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  HelpTooltip,
  IconButton,
  Input,
  MetalBar,
  NumberField,
  PageContainer,
  Section,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Textarea,
  Toolbar,
} from "../ui";

/**
 * Dev-only route showing every primitive in every state.
 * Useful as a visual regression spot-check while migrating pages.
 */
export function StyleguidePage() {
  const [num, setNum] = useState(1250);
  const [num2, setNum2] = useState(42);

  return (
    <PageContainer className="py-8">
      <header className="mb-8">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--color-ink-subtle)] mb-1">
          Internal
        </div>
        <h1 className="text-[22px] font-semibold text-[color:var(--color-ink)]">
          Styleguide
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--color-ink-muted)]">
          Every primitive, every state. Not linked from navigation — reach it
          via <code className="font-mono text-[12px]">#/styleguide</code>.
        </p>
      </header>

      <div className="grid gap-8">
        <Section title="Typography">
          <div className="grid gap-2">
            <div className="text-[22px] font-semibold">Inter 22 / 600 — page title</div>
            <div className="text-[18px] font-semibold">Inter 18 / 600 — section head</div>
            <div className="text-[14px]">Inter 14 / 400 — body</div>
            <div className="text-[12.5px] text-[color:var(--color-ink-muted)]">
              Inter 12.5 — form label
            </div>
            <div className="font-mono text-[13px] tabular-nums">
              JetBrains Mono 13 — 1024.5 mm · #B8410E · 120.0 °
            </div>
          </div>
        </Section>

        <Section title="Color tokens">
          <div className="grid grid-cols-6 gap-3 max-w-[720px]">
            {[
              ["bg", "#F7F5F2"],
              ["surface", "#FFFFFF"],
              ["surface-el.", "#FDFBF7"],
              ["ink", "#1A1613"],
              ["ink-muted", "#6B6560"],
              ["ink-subtle", "#8A847E"],
              ["border", "#E8E3DC"],
              ["primary", "#B8410E"],
              ["primary-tint", "#FBE9DF"],
              ["secondary", "#1F3A5F"],
              ["success", "#2F6F4E"],
              ["warning", "#C98A1E"],
              ["destructive", "#9B2430"],
            ].map(([name, hex]) => (
              <div key={name} className="flex flex-col gap-1">
                <div
                  className="h-12 rounded-[6px] border border-[color:var(--color-border)]"
                  style={{ background: hex }}
                />
                <div className="text-[11px] font-medium">{name}</div>
                <div className="font-mono text-[10px] text-[color:var(--color-ink-subtle)]">
                  {hex}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Metal bars (the signature motif)">
          <div className="space-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-ink-subtle)] mb-2">
                default
              </div>
              <MetalBar />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[color:var(--color-ink-subtle)] mb-2">
                soft
              </div>
              <MetalBar variant="soft" />
            </div>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap gap-3">
            <Button variant="primary">Generate .xcs</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
            <Button variant="link">View test</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
          <div className="flex flex-wrap gap-3 mt-3">
            <IconButton icon={<Eye className="h-4 w-4" />} aria-label="Preview" />
            <IconButton variant="active" icon={<Eye className="h-4 w-4" />} aria-label="Active preview" />
            <IconButton variant="ghost" icon={<EyeOff className="h-4 w-4" />} aria-label="Hide" />
            <IconButton icon={<Plus className="h-4 w-4" />} aria-label="Add" size="sm" />
          </div>
        </Section>

        <Section title="Fields">
          <div className="grid grid-cols-2 gap-4 max-w-[720px]">
            <Field label="Name" help="Max 64 characters, alphanumeric.">
              <Input defaultValue="Stainless swatches" />
            </Field>
            <Field label="Material">
              <Select defaultValue="1">
                <option value="1">Stainless</option>
                <option value="2">SS Xtool Tag</option>
              </Select>
            </Field>
            <NumberField label="Speed (mm/s)" value={num} onChange={setNum} integer min={100} max={5000} />
            <NumberField label="Power %" value={num2} onChange={setNum2} min={0} max={100} issue="Must be ≤ 50 for this preset" />
            <Field label="Notes">
              <Textarea placeholder="Free-form notes about this burn…" />
            </Field>
            <Field label="Disabled">
              <Input disabled defaultValue="Read-only" />
            </Field>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap gap-2">
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="accent">Applied</Badge>
            <Badge variant="info">Modified</Badge>
            <Badge variant="success">
              <Check className="h-3 w-3" />
              Saved
            </Badge>
            <Badge variant="warning">
              <AlertTriangle className="h-3 w-3" />
              Needs review
            </Badge>
            <Badge variant="destructive">Deleted</Badge>
          </div>
        </Section>

        <Section title="Cards">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Default card</CardTitle>
                <Badge variant="accent">Applied</Badge>
              </CardHeader>
              <p className="text-[13px] text-[color:var(--color-ink-muted)]">
                Hairline border, subtle shadow. The default surface for
                grouped content.
              </p>
              <CardFooter>
                <Button variant="ghost" size="sm">Cancel</Button>
                <Button variant="primary" size="sm">Apply</Button>
              </CardFooter>
            </Card>
            <Card variant="inset" padded={false}>
              <div className="p-6 font-mono text-[12px] text-[color:var(--color-ink-muted)] tabular-nums">
                <div>speed 600–1500 / P10.0% F125Hz L5000 PW250</div>
                <div className="mt-2 grid grid-cols-6 gap-px">
                  {Array.from({ length: 30 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-5 rounded-sm"
                      style={{ background: `hsl(${10 + i * 6} 60% ${35 + (i % 5) * 6}%)` }}
                    />
                  ))}
                </div>
                <div className="mt-2">Inset card — for SVG/preview panels</div>
              </div>
            </Card>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="query">
            <TabList>
              <Tab value="query">Query</Tab>
              <Tab value="browse">Browse</Tab>
              <Tab value="import" disabled>Import</Tab>
            </TabList>
            <TabPanel value="query">
              <p className="text-[13px] text-[color:var(--color-ink-muted)]">
                Query content. Active underline is ember orange on the TabList border.
              </p>
            </TabPanel>
            <TabPanel value="browse">
              <p className="text-[13px] text-[color:var(--color-ink-muted)]">Browse content.</p>
            </TabPanel>
          </Tabs>
        </Section>

        <Section title="Toolbar">
          <Toolbar
            trailing={
              <>
                <Button variant="ghost" size="sm">Reset</Button>
                <Button variant="primary" size="sm">Apply</Button>
              </>
            }
          >
            <Badge variant="info">17 layers</Badge>
            <Badge variant="neutral">1 hidden</Badge>
            <HelpTooltip>
              Layers flagged as near-white are hidden by default. Tick the
              checkbox to include them.
            </HelpTooltip>
          </Toolbar>
        </Section>

        <Section title="Empty state">
          <Card padded={false}>
            <EmptyState
              icon={<Eye className="h-6 w-6" />}
              title="Pick a test from the list"
              description="Choose a test on the left to view its parameters, preview, and results."
              action={<Button variant="primary">+ New test</Button>}
            />
          </Card>
        </Section>
      </div>
    </PageContainer>
  );
}
