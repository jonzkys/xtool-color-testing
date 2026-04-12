"""Command-line interface for xcs-gen."""

from __future__ import annotations

import argparse
import sys

from .builder import write_xcs
from .generators import gradient_grid, single_axis_sweep
from .model import ProcessingParams


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="xcs-gen",
        description="Generate XTool .xcs test files with parameter sweeps.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # --- sweep command ---
    sweep_p = sub.add_parser("sweep", help="Single-axis parameter sweep")
    sweep_p.add_argument("--param", required=True, help="Parameter to vary (speed, power, density, frequency, etc.)")
    sweep_p.add_argument("--min", type=float, required=True, dest="min_val")
    sweep_p.add_argument("--max", type=float, required=True, dest="max_val")
    sweep_p.add_argument("--steps", type=int, default=50)
    sweep_p.add_argument("--width", type=float, default=1.0, help="Element width in mm")
    sweep_p.add_argument("--height", type=float, default=10.0, help="Element height in mm")
    sweep_p.add_argument("--gap", type=float, default=0.5, help="Gap between elements in mm")
    sweep_p.add_argument("--type", default="COLOR_FILL_ENGRAVE", dest="processing_type")
    sweep_p.add_argument("-o", "--output", required=True, help="Output .xcs file path")

    # --- grid command ---
    grid_p = sub.add_parser("grid", help="Two-axis parameter grid")
    grid_p.add_argument("--x-param", required=True, help="Parameter for X axis")
    grid_p.add_argument("--x-min", type=float, required=True)
    grid_p.add_argument("--x-max", type=float, required=True)
    grid_p.add_argument("--x-steps", type=int, default=10)
    grid_p.add_argument("--y-param", required=True, help="Parameter for Y axis")
    grid_p.add_argument("--y-min", type=float, required=True)
    grid_p.add_argument("--y-max", type=float, required=True)
    grid_p.add_argument("--y-steps", type=int, default=10)
    grid_p.add_argument("--width", type=float, default=2.0, help="Element width in mm")
    grid_p.add_argument("--height", type=float, default=5.0, help="Element height in mm")
    grid_p.add_argument("--gap", type=float, default=1.0, help="Gap between elements in mm")
    grid_p.add_argument("--type", default="COLOR_FILL_ENGRAVE", dest="processing_type")
    grid_p.add_argument("-o", "--output", required=True, help="Output .xcs file path")

    args = parser.parse_args(argv)

    if args.command == "sweep":
        project = single_axis_sweep(
            param=args.param,
            min_val=args.min_val,
            max_val=args.max_val,
            steps=args.steps,
            element_width=args.width,
            element_height=args.height,
            gap=args.gap,
            processing_type=args.processing_type,
        )
        write_xcs(project, args.output)
        print(f"Wrote {len(project.elements)} elements to {args.output}")

    elif args.command == "grid":
        project = gradient_grid(
            x_param=args.x_param,
            x_min=args.x_min,
            x_max=args.x_max,
            x_steps=args.x_steps,
            y_param=args.y_param,
            y_min=args.y_min,
            y_max=args.y_max,
            y_steps=args.y_steps,
            element_width=args.width,
            element_height=args.height,
            gap=args.gap,
            processing_type=args.processing_type,
        )
        write_xcs(project, args.output)
        print(f"Wrote {len(project.elements)} elements ({args.x_steps}x{args.y_steps} grid) to {args.output}")


if __name__ == "__main__":
    main()
