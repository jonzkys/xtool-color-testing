"""Command-line interface for xcs-gen."""

from __future__ import annotations

import argparse
import sys

from .builder import write_xcs
from .generators import generate_gradient
from .model import ProcessingParams

# F2 Ultra MOPA spot size: 0.03mm (30 microns)
DEFAULT_BEAM_WIDTH = 0.03


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="xcs-gen",
        description="Generate XTool .xcs test files with parameter sweeps.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # --- generate command ---
    gen_p = sub.add_parser("generate", help="Generate a gradient test pattern")

    # X axis (required)
    gen_p.add_argument("--x-param", required=True, help="Parameter to vary on X axis (speed, power, density, frequency, etc.)")
    gen_p.add_argument("--x-min", type=float, required=True, help="Minimum X parameter value")
    gen_p.add_argument("--x-max", type=float, required=True, help="Maximum X parameter value")
    gen_p.add_argument("--x-steps", type=int, default=None, help="Number of elements along X axis (auto-computed from width/beam if omitted)")

    # Y axis (optional - omit for single axis)
    gen_p.add_argument("--y-param", default=None, help="Parameter to vary on Y axis (omit for single axis)")
    gen_p.add_argument("--y-min", type=float, default=0, help="Minimum Y parameter value")
    gen_p.add_argument("--y-max", type=float, default=0, help="Maximum Y parameter value")
    gen_p.add_argument("--y-steps", type=int, default=10, help="Number of rows along Y axis (default: 10)")

    # Layout
    gen_p.add_argument("--width", type=float, default=None, help="Total gradient area width in mm (auto-computed from steps*beam if omitted)")
    gen_p.add_argument("--height", type=float, default=50.0, help="Total gradient area height in mm (default: 50)")
    gen_p.add_argument("--gap", type=float, default=0.0, help="Gap between elements in mm (default: 0)")
    gen_p.add_argument("--beam-width", type=float, default=DEFAULT_BEAM_WIDTH,
                       help=f"Laser beam spot size in mm (default: {DEFAULT_BEAM_WIDTH})")

    # Base processing parameters
    gen_p.add_argument("--power", type=float, default=50.0, help="Laser power %% (default: 50)")
    gen_p.add_argument("--speed", type=int, default=1000, help="Speed mm/s (default: 1000)")
    gen_p.add_argument("--frequency", type=int, default=65, help="MOPA frequency Hz (default: 65)")
    gen_p.add_argument("--density", type=int, default=100, help="Lines per cm (default: 100)")
    gen_p.add_argument("--passes", type=int, default=1, help="Number of passes (default: 1)")
    gen_p.add_argument("--pulse-width", type=int, default=200, help="Pulse width ns (default: 200)")
    gen_p.add_argument("--laser", default="red", choices=["red", "blue"],
                       help="Laser source: red=MOPA fiber, blue=diode (default: red)")
    gen_p.add_argument("--type", default="COLOR_FILL_ENGRAVE", dest="processing_type",
                       help="Processing type (default: COLOR_FILL_ENGRAVE)")
    gen_p.add_argument("--font-size", type=float, default=3.0, help="Axis label font size in points (default: 3)")

    # Output
    gen_p.add_argument("-o", "--output", required=True, help="Output .xcs file path")

    args = parser.parse_args(argv)

    if args.command == "generate":
        beam = args.beam_width
        x_steps = args.x_steps
        width = args.width

        # Resolve steps/width: one can be auto-computed from the other
        if x_steps is None and width is None:
            # Neither provided: default to 100mm width, compute steps
            width = 100.0
            x_steps = int(width / beam)
            print(f"Auto: {x_steps} steps from {width}mm width at {beam}mm beam")
        elif x_steps is None:
            # Width provided, compute steps
            x_steps = int(width / beam)
            print(f"Auto: {x_steps} steps from {width}mm width at {beam}mm beam")
        elif width is None:
            # Steps provided, compute width
            width = x_steps * beam
            print(f"Auto: {width:.1f}mm width from {x_steps} steps at {beam}mm beam")
        else:
            # Both provided: validate
            elem_w = (width - max(0, x_steps - 1) * args.gap) / x_steps
            if elem_w < beam:
                print(f"WARNING: Element width ({elem_w:.4f}mm) is smaller than beam spot ({beam}mm)")
                print(f"  Elements will overlap. Max steps for this width: {int((width + args.gap) / (beam + args.gap))}")
                print(f"  Or minimum width for this many steps: {x_steps * beam:.1f}mm")
                print()

        base_params = ProcessingParams(
            power=args.power,
            speed=args.speed,
            mopa_frequency=args.frequency,
            density=args.density,
            repeat=args.passes,
            pulse_width=args.pulse_width,
            processing_light_source=args.laser,
        )

        project = generate_gradient(
            x_param=args.x_param,
            x_min=args.x_min,
            x_max=args.x_max,
            x_steps=x_steps,
            y_param=args.y_param,
            y_min=args.y_min,
            y_max=args.y_max,
            y_steps=args.y_steps,
            total_width=width,
            total_height=args.height,
            gap=args.gap,
            base_params=base_params,
            processing_type=args.processing_type,
            label_font_size=args.font_size,
        )

        write_xcs(project, args.output)

        n_elements = len(project.elements)
        n_annotations = len(project.extra_displays)
        elem_w = (width - max(0, x_steps - 1) * args.gap) / x_steps
        mode = "single axis" if args.y_param is None else f"{x_steps}x{args.y_steps} grid"
        eh = args.height if args.y_param is None else args.height / args.y_steps

        print(f"Generated {n_elements} gradient elements ({mode})")
        print(f"  Area: {width:.1f}mm x {args.height:.1f}mm")
        print(f"  Element size: {elem_w:.4f}mm x {eh:.3f}mm ({elem_w/beam:.1f}x beam width)")
        print(f"  Annotations: {n_annotations} (ticks + labels)")
        print(f"  Written to: {args.output}")


if __name__ == "__main__":
    main()
