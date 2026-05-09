import type {
  ExposureChannelHelp,
  ExposureIndexHelp,
  ExposureRawParamHelp,
} from "./exposureHelpCopy";
import { ExposureHelpSchematic } from "./ExposureHelpSchematic";
import { StabilityHelpSchematic } from "../StabilityHelpSchematic";

const CARD_WIDTH = 340;

function HeaderStrip({
  heading,
  unit,
}: {
  heading: string;
  unit?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
        {heading}
      </div>
      {unit ? (
        <span
          className="font-mono text-[8.5px] tracking-[0.18em] uppercase px-1.5 py-0.5 rounded-sm border border-[color:var(--color-border)] text-[color:var(--color-ink-muted)]"
        >
          {unit}
        </span>
      ) : null}
    </div>
  );
}

function DefinitionGuide({
  definition,
  guide,
}: {
  definition: string;
  guide: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 min-w-0 flex-1">
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          Definition
        </div>
        <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
          {definition}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          How to read it
        </div>
        <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink-muted)] m-0">
          {guide}
        </p>
      </div>
    </div>
  );
}

export function IndexCardBody({ help }: { help: ExposureIndexHelp }) {
  return (
    <div
      className="px-3.5 py-3 flex flex-col gap-3"
      style={{ width: CARD_WIDTH }}
    >
      <HeaderStrip heading={help.heading} unit={help.unit} />

      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <ExposureHelpSchematic schematic={help.schematic} />
        </div>
        <DefinitionGuide definition={help.definition} guide={help.guide} />
      </div>

      <div className="flex flex-col gap-1.5 pt-1 border-t border-[color:var(--color-border)]">
        <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)]">
          Formula
        </div>
        <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
          {help.formula}
        </p>
        <div className="font-mono text-[8.5px] tracking-[0.22em] uppercase font-semibold text-[color:var(--color-ink-subtle)] mt-1">
          Inputs
        </div>
        <ul className="m-0 p-0 list-none flex flex-col gap-0.5">
          {help.inputs.map((i) => (
            <li
              key={i.name}
              className="font-mono text-[10.5px] leading-relaxed text-[color:var(--color-ink-muted)]"
            >
              {i.name} · {i.unit}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ChannelCardBody({ help }: { help: ExposureChannelHelp }) {
  return (
    <div
      className="px-3.5 py-3 flex flex-col gap-3"
      style={{ width: CARD_WIDTH }}
    >
      <HeaderStrip heading={help.heading} />
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <StabilityHelpSchematic schematic={help.schematic} />
        </div>
        <DefinitionGuide definition={help.definition} guide={help.guide} />
      </div>
    </div>
  );
}

export function RawParamCardBody({ help }: { help: ExposureRawParamHelp }) {
  return (
    <div
      className="px-3.5 py-3 flex flex-col gap-2"
      style={{ width: CARD_WIDTH }}
    >
      <HeaderStrip heading={help.heading} unit={help.unit} />
      <p className="font-mono text-[11.5px] leading-relaxed text-[color:var(--color-ink)] m-0">
        {help.definition}
      </p>
    </div>
  );
}
