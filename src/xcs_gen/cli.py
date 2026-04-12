"""Command-line interface for xcs-gen."""

from __future__ import annotations

import argparse
import sys

from .builder import write_xcs
from .generators import generate_gradient
from .model import ProcessingParams


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
    gen_p.add_argument("--x-steps", type=int, default=100, help="Number of elements along X axis (default: 100)")

    # Y axis (optional - omit for single axis)
    gen_p.add_argument("--y-param", default=None, help="Parameter to vary on Y axis (omit for single axis)")
    gen_p.add_argument("--y-min", type=float, default=0, help="Minimum Y parameter value")
    gen_p.add_argument("--y-max", type=float, default=0, help="Maximum Y parameter value")
    gen_p.add_argument("--y-steps", type=int, default=10, help="Number of rows along Y axis (default: 10)")

    # Layout
    gen_p.add_argument("--width", type=float, default=100.0, help="Total gradient area width in mm (default: 100)")
    gen_p.add_argument("--height", type=float, default=50.0, help="Total gradient area height in mm (default: 50)")
    gen_p.add_argument("--gap", type=float, default=0.0, help="Gap between elements in mm (default: 0)")

    # Processing
    gen_p.add_argument("--type", default="COLOR_FILL_ENGRAVE", dest="processing_type",
                       help="Processing type (default: COLOR_FILL_ENGRAVE)")
    gen_p.add_argument("--font-size", type=float, default=3.0, help="Axis label font size in points (default: 3)")

    # Output
    gen_p.add_argument("-o", "--output", required=True, help="Output .xcs file path")

    args = parser.parse_args(argv)

    if args.command == "generate":
        project = generate_gradient(
            x_param=args.x_param,
            x_min=args.x_min,
            x_max=args.x_max,
            x_steps=args.x_steps,
            y_param=args.y_param,
            y_min=args.y_min,
            y_max=args.y_max,
            y_steps=args.y_steps,
            total_width=args.width,
            total_height=args.height,
            gap=args.gap,
            processing_type=args.processing_type,
            label_font_size=args.font_size,
        )

        write_xcs(project, args.output)

        n_elements = len(project.elements)
        n_annotations = len(project.extra_displays)
        elem_w = args.width / args.x_steps
        mode = "single axis" if args.y_param is None else f"{args.x_steps}x{args.y_steps} grid"

        print(f"Generated {n_elements} gradient elements ({mode})")
        print(f"  Element size: {elem_w:.3f}mm x {args.height if args.y_param is None else args.height / args.y_steps:.3f}mm")
        print(f"  Annotations: {n_annotations} (ticks + labels)")
        print(f"  Written to: {args.output}")


if __name__ == "__main__":
    main()
