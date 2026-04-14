"""Command-line interface for xcs-gen."""

from __future__ import annotations

import argparse
import math
import sys

from .builder import write_xcs
from .generators import generate_from_image, generate_gradient
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
    gen_p.add_argument("--rows", type=int, default=1, help="Wrap gradient across N rows (default: 1)")
    gen_p.add_argument("--row-gap", type=float, default=1.0, help="Gap between wrapped rows in mm (default: 1)")
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

    # --- image command ---
    img_p = sub.add_parser("image", help="Generate XCS from an image (brightness → laser parameter)")

    # Input
    img_p.add_argument("--input", required=True, help="Path to input image (PNG, JPG)")

    # Parameter mapping
    img_p.add_argument("--param", default="speed", help="Parameter to map brightness to (default: speed)")
    img_p.add_argument("--param-min", type=float, required=True, help="Parameter value for white (min energy)")
    img_p.add_argument("--param-max", type=float, required=True, help="Parameter value for black (max energy)")
    img_p.add_argument("--skip-threshold", type=float, default=1.0,
                       help="Brightness above which cells are skipped (default: 1.0 = white)")

    # Grid resolution
    img_p.add_argument("--cols", type=int, default=None, help="Grid columns (auto from aspect ratio if omitted)")
    img_p.add_argument("--rows", type=int, default=None, dest="img_rows", help="Grid rows (auto from aspect ratio if omitted)")

    # Layout
    img_p.add_argument("--width", type=float, default=50.0, help="Output width in mm (default: 50)")
    img_p.add_argument("--height", type=float, default=30.0, help="Output height in mm (default: 30)")
    img_p.add_argument("--gap", type=float, default=0.0, help="Gap between cells in mm (default: 0)")
    img_p.add_argument("--beam-width", type=float, default=DEFAULT_BEAM_WIDTH,
                       help=f"Laser beam spot size in mm (default: {DEFAULT_BEAM_WIDTH})")

    # Base processing parameters
    img_p.add_argument("--power", type=float, default=50.0, help="Laser power %% (default: 50)")
    img_p.add_argument("--speed", type=int, default=1000, help="Speed mm/s (default: 1000)")
    img_p.add_argument("--frequency", type=int, default=65, help="MOPA frequency Hz (default: 65)")
    img_p.add_argument("--density", type=int, default=100, help="Lines per cm (default: 100)")
    img_p.add_argument("--passes", type=int, default=1, help="Number of passes (default: 1)")
    img_p.add_argument("--pulse-width", type=int, default=200, help="Pulse width ns (default: 200)")
    img_p.add_argument("--laser", default="red", choices=["red", "blue"],
                       help="Laser source: red=MOPA fiber, blue=diode (default: red)")
    img_p.add_argument("--type", default="COLOR_FILL_ENGRAVE", dest="processing_type",
                       help="Processing type (default: COLOR_FILL_ENGRAVE)")

    # Output
    img_p.add_argument("-o", "--output", required=True, help="Output .xcs file path")

    # --- serve command ---
    serve_p = sub.add_parser("serve", help="Launch the web UI locally")
    serve_p.add_argument("--host", default="127.0.0.1", help="Host to bind (default: 127.0.0.1)")
    serve_p.add_argument("--port", type=int, default=8000, help="Port to bind (default: 8000)")
    serve_p.add_argument("--no-browser", action="store_true",
                         help="Don't automatically open the browser")

    # --- svg command ---
    svg_p = sub.add_parser("svg", help="SVG → per-layer laser parameters")
    svg_sub = svg_p.add_subparsers(dest="svg_command", required=True)

    # svg detect
    svg_det_p = svg_sub.add_parser("detect", help="List colours detected in an SVG")
    svg_det_p.add_argument("input", help="Path to input SVG file")

    args = parser.parse_args(argv)

    if args.command == "svg":
        if args.svg_command == "detect":
            _svg_detect(args)
            return
        # svg generate branch added in Task 11

    elif args.command == "image":
        base_params = ProcessingParams(
            power=args.power,
            speed=args.speed,
            mopa_frequency=args.frequency,
            density=args.density,
            repeat=args.passes,
            pulse_width=args.pulse_width,
            processing_light_source=args.laser,
        )

        project = generate_from_image(
            image_path=args.input,
            param=args.param,
            param_min=args.param_min,
            param_max=args.param_max,
            cols=args.cols,
            rows=args.img_rows,
            total_width=args.width,
            total_height=args.height,
            gap=args.gap,
            skip_threshold=args.skip_threshold,
            base_params=base_params,
            processing_type=args.processing_type,
        )

        write_xcs(project, args.output)

        n_elements = len(project.elements)
        n_skipped = (args.cols or 0) * (args.img_rows or 0) - n_elements  # approximate
        beam = args.beam_width
        cell_w = args.width / (args.cols or 1) if args.cols else 0

        print(f"Generated {n_elements} elements from {args.input}")
        if args.cols and args.img_rows:
            print(f"  Grid: {args.cols}x{args.img_rows} ({args.cols * args.img_rows - n_elements} skipped)")
            print(f"  Cell size: {cell_w:.4f}mm x {args.height / args.img_rows:.4f}mm ({cell_w / beam:.1f}x beam)")
        print(f"  Mapping: brightness → {args.param} [{args.param_min} - {args.param_max}]")
        print(f"  Written to: {args.output}")

        if n_elements == 0:
            print("  WARNING: No elements generated. Image may be all white or above skip threshold.")

    elif args.command == "serve":
        import webbrowser
        import uvicorn
        from pathlib import Path

        # Warn if web/dist doesn't exist yet
        web_dist = Path(__file__).parent.parent.parent / "web" / "dist"
        if not web_dist.exists() or not (web_dist / "index.html").exists():
            print("Warning: web/dist/index.html not found.")
            print("  Run 'cd web && npm install && npm run build' to build the frontend.")
            print("  The API will still work at /api/* endpoints.")
            print()

        url = f"http://{args.host}:{args.port}"
        print(f"Starting xcs-gen web UI at {url}")

        if not args.no_browser:
            webbrowser.open(url)

        uvicorn.run(
            "xcs_gen_web.app:app",
            host=args.host,
            port=args.port,
            log_level="info",
        )
        return

    elif args.command == "generate":
        beam = args.beam_width
        x_steps = args.x_steps
        width = args.width

        rows = args.rows
        per_row_max = int(width / beam) if width else None

        # Resolve steps/width: one can be auto-computed from the other
        if x_steps is None and width is None:
            width = 100.0
            per_row_max = int(width / beam)
            x_steps = per_row_max * rows
            print(f"Auto: {x_steps} steps ({per_row_max}/row x {rows} rows) from {width}mm width at {beam}mm beam")
        elif x_steps is None:
            per_row_max = int(width / beam)
            x_steps = per_row_max * rows
            print(f"Auto: {x_steps} steps ({per_row_max}/row x {rows} rows) from {width}mm width at {beam}mm beam")
        elif width is None:
            per_row = math.ceil(x_steps / rows)
            width = per_row * beam
            print(f"Auto: {width:.1f}mm width from {per_row} elements/row at {beam}mm beam")

        base_params = ProcessingParams(
            power=args.power,
            speed=args.speed,
            mopa_frequency=args.frequency,
            density=args.density,
            repeat=args.passes,
            pulse_width=args.pulse_width,
            processing_light_source=args.laser,
        )

        rows = args.rows
        per_row = math.ceil(x_steps / rows) if rows > 1 else x_steps
        elem_w = (width - max(0, per_row - 1) * args.gap) / per_row

        # Beam width validation against per-row element width
        if elem_w < beam:
            print(f"WARNING: Element width ({elem_w:.4f}mm) is smaller than beam spot ({beam}mm)")
            max_per_row = int((width + args.gap) / (beam + args.gap))
            print(f"  Max elements per row at this width: {max_per_row}")
            print()

        project = generate_gradient(
            x_param=args.x_param,
            x_min=args.x_min,
            x_max=args.x_max,
            x_steps=x_steps,
            y_param=args.y_param,
            y_min=args.y_min,
            y_max=args.y_max,
            y_steps=args.y_steps,
            rows=rows,
            row_gap=args.row_gap,
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
        total_area_h = args.height if rows == 1 else rows * args.height + (rows - 1) * args.row_gap
        mode = "single axis" if args.y_param is None else f"{x_steps}x{args.y_steps} grid"
        if rows > 1 and args.y_param is None:
            mode = f"{rows} rows x {per_row}/row"

        print(f"Generated {n_elements} gradient elements ({mode})")
        print(f"  Area: {width:.1f}mm x {total_area_h:.1f}mm")
        print(f"  Element size: {elem_w:.4f}mm x {args.height:.3f}mm ({elem_w/beam:.1f}x beam width)")
        print(f"  Annotations: {n_annotations} (ticks + labels)")
        print(f"  Written to: {args.output}")


def _svg_detect(args) -> None:
    from .svg_source import detect_svg_colors

    colors = detect_svg_colors(args.input)
    if not colors:
        print("No colours detected (SVG may be empty or use only unsupported elements).")
        return

    # Simple table output.
    col_hex = max(len("colour"), max(len(c.hex) for c in colors))
    col_src = max(len("source"), max(len(c.source) for c in colors))
    col_cnt = max(len("shapes"), max(len(str(c.shape_count)) for c in colors))
    fmt = f"  {{:<{col_hex}}}  {{:<{col_src}}}  {{:>{col_cnt}}}"

    print(fmt.format("colour", "source", "shapes"))
    print(fmt.format("-" * col_hex, "-" * col_src, "-" * col_cnt))
    for c in colors:
        print(fmt.format(c.hex, c.source, c.shape_count))


if __name__ == "__main__":
    main()
