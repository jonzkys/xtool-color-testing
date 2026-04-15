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
    serve_p.add_argument("--port", type=int, default=4000, help="Port to bind (default: 4000)")
    serve_p.add_argument("--no-browser", action="store_true",
                         help="Don't automatically open the browser")

    # --- svg command ---
    svg_p = sub.add_parser("svg", help="SVG → per-layer laser parameters")
    svg_sub = svg_p.add_subparsers(dest="svg_command", required=True)

    # svg detect
    svg_det_p = svg_sub.add_parser("detect", help="List colours detected in an SVG")
    svg_det_p.add_argument("input", help="Path to input SVG file")

    # svg generate
    svg_gen_p = svg_sub.add_parser("generate", help="Convert an SVG to an .xcs file")
    svg_gen_p.add_argument("input", help="Path to input SVG file")
    svg_gen_p.add_argument("-o", "--output", required=True, help="Output .xcs file path")
    svg_gen_p.add_argument("--width", type=float, default=100.0,
                           help="Output width in mm (default: 100)")
    svg_gen_p.add_argument("--height", type=float, default=None,
                           help="Output height in mm (default: preserve aspect ratio)")
    svg_gen_p.add_argument("--start-x", type=float, default=10.0,
                           help="X origin on the bed in mm (default: 10)")
    svg_gen_p.add_argument("--start-y", type=float, default=10.0,
                           help="Y origin on the bed in mm (default: 10)")

    # Auto-ramp flags
    svg_gen_p.add_argument("--ramp-param", default=None,
                           help="Parameter to auto-ramp across detected colours")
    svg_gen_p.add_argument("--ramp-min", type=float, default=None,
                           help="Ramp min (assigned to first colour in sort)")
    svg_gen_p.add_argument("--ramp-max", type=float, default=None,
                           help="Ramp max (assigned to last colour in sort)")
    svg_gen_p.add_argument("--ramp-sort", default="luminance",
                           choices=["luminance", "hue", "order_of_appearance"],
                           help="Sort mode for auto-ramp (default: luminance)")
    svg_gen_p.add_argument("--ramp-mode", default="fill_engrave",
                           choices=["fill_engrave", "vector_engrave", "vector_cut"],
                           help="Render mode for auto-ramp (default: fill_engrave)")

    # Explicit per-colour overrides (repeatable)
    svg_gen_p.add_argument("--color", action="append", default=[], dest="color_overrides",
                           help="Per-colour override: '<hex>:<mode>:<speed>,<power>,<freq>,<density>,<passes>,<pulse_width>'. Blank fields inherit from --base-* flags.")

    svg_gen_p.add_argument(
        "--hatch", action="append", default=[], dest="hatch_overrides",
        help=(
            "Per-colour hatched pass: '<hex>:<key=val,key=val,...>:<ramp>:<ramp>...'. "
            "Pass-level keys: angle, spacing, power, speed, frequency, density, "
            "passes, pulse_width. Each ramp is '<param>=<axis>:<min>:<max>'. "
            "Repeat the flag with the same colour for multi-pass cross-hatching."
        ),
    )

    svg_gen_p.add_argument("--config", default=None,
                           help="Path to a YAML config file describing layers.")
    svg_gen_p.add_argument("--max-segments", type=int, default=50000,
                           help="Hard cap on hatched segments (default: 50000)")
    svg_gen_p.add_argument("--min-spacing", type=float, default=0.01,
                           help="Minimum hatch line spacing in mm (default: 0.01)")

    # Shared base-params flags (same as image/generate)
    svg_gen_p.add_argument("--power", type=float, default=50.0, help="Laser power %% (default: 50)")
    svg_gen_p.add_argument("--speed", type=int, default=1000, help="Speed mm/s (default: 1000)")
    svg_gen_p.add_argument("--frequency", type=int, default=65, help="MOPA frequency Hz (default: 65)")
    svg_gen_p.add_argument("--density", type=int, default=100, help="Lines per cm (default: 100)")
    svg_gen_p.add_argument("--passes", type=int, default=1, help="Number of passes (default: 1)")
    svg_gen_p.add_argument("--pulse-width", type=int, default=200, help="Pulse width ns (default: 200)")
    svg_gen_p.add_argument("--laser", default="red", choices=["red", "blue"],
                           help="Laser source (default: red)")

    args = parser.parse_args(argv)

    if args.command == "svg":
        try:
            if args.svg_command == "detect":
                _svg_detect(args)
                return
            if args.svg_command == "generate":
                _svg_generate(args)
                return
        except (FileNotFoundError, ValueError, OSError) as exc:
            raise SystemExit(f"error: {exc}")

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


def _svg_generate(args) -> None:
    from .builder import write_xcs
    from .generators import generate_from_svg
    from .model import ProcessingParams
    from .svg_source import AutoRamp, LayerConfig

    base_params = ProcessingParams(
        power=args.power, speed=args.speed,
        mopa_frequency=args.frequency, density=args.density,
        repeat=args.passes, pulse_width=args.pulse_width,
        processing_light_source=args.laser,
    )

    # Load YAML config if provided. CLI overrides win later.
    yaml_layer_config: dict = {}
    yaml_auto_ramp = None
    if args.config:
        from .svg_config import load_svg_config
        loaded = load_svg_config(args.config)
        # Note: YAML's defaults could merge with base_params, but we keep CLI
        # flags as authoritative — YAML defaults are lower precedence.
        yaml_layer_config = loaded.layer_config
        yaml_auto_ramp = loaded.auto_ramp
    # Seed layer_config with YAML; will be overridden by --color/--hatch below.

    # Parse --color overrides (CLI > YAML)
    layer_config: dict[str, LayerConfig] = dict(yaml_layer_config)
    for override in args.color_overrides:
        color, cfg = _parse_color_override(override, base_params)
        layer_config[color] = cfg

    # Fold in --hatch passes (may share a color across multiple flags → multi-pass).
    hatch_layers: dict[str, list] = {}
    for override in getattr(args, "hatch_overrides", []):
        color, hp = _parse_hatch_override(override, base_params)
        hatch_layers.setdefault(color, []).append(hp)
    for color, passes in hatch_layers.items():
        from .svg_source import LayerConfig
        existing = layer_config.get(color)
        params = existing.params if existing else ProcessingParams(
            power=base_params.power, speed=base_params.speed,
            mopa_frequency=base_params.mopa_frequency,
            density=base_params.density, repeat=base_params.repeat,
            pulse_width=base_params.pulse_width,
            processing_light_source=base_params.processing_light_source,
        )
        layer_config[color] = LayerConfig(
            params=params,
            render_mode="hatched",
            hatch_passes=passes,
        )

    # Build AutoRamp if any ramp flags were given
    auto_ramp = None
    if args.ramp_param is not None:
        if args.ramp_min is None or args.ramp_max is None:
            raise SystemExit("--ramp-param requires --ramp-min and --ramp-max.")
        auto_ramp = AutoRamp(
            param=args.ramp_param,
            min_value=args.ramp_min,
            max_value=args.ramp_max,
            sort_by=args.ramp_sort,
            default_render_mode=args.ramp_mode,
        )
    elif yaml_auto_ramp is not None:
        auto_ramp = yaml_auto_ramp

    # Surface --min-spacing to hatch.py via module-level constant override.
    from . import hatch as _hatch
    _hatch.MIN_SPACING_DEFAULT = args.min_spacing

    project = generate_from_svg(
        svg_path=args.input,
        layer_config=layer_config or None,
        auto_ramp=auto_ramp,
        total_width=args.width,
        total_height=args.height,
        start_x=args.start_x,
        start_y=args.start_y,
        base_params=base_params,
        max_segments=args.max_segments,
    )

    write_xcs(project, args.output)

    print(f"Generated {len(project.paths)} path displays from {args.input}")
    print(f"  Written to: {args.output}")


def _parse_color_override(override: str, base: "ProcessingParams"):
    """Parse '<hex>:<mode>:<speed>,<power>,<freq>,<density>,<passes>,<pulse_width>'.

    Blank fields inherit from base. Mode defaults to 'fill_engrave' if blank.
    """
    from .model import ProcessingParams
    from .svg_source import LayerConfig

    try:
        hex_part, mode_part, rest = override.split(":", 2)
    except ValueError:
        raise SystemExit(
            f"Invalid --color value {override!r}. "
            "Expected '<hex>:<mode>:<speed>,<power>,<freq>,<density>,<passes>,<pulse_width>'."
        )

    color = hex_part.strip().lower()
    if not (color.startswith("#") and len(color) == 7):
        raise SystemExit(f"Invalid hex colour in --color: {hex_part!r}")

    mode = mode_part.strip() or "fill_engrave"
    if mode not in ("fill_engrave", "vector_engrave", "vector_cut"):
        raise SystemExit(
            f"Invalid mode in --color: {mode!r}. "
            "Must be fill_engrave | vector_engrave | vector_cut."
        )

    fields = rest.split(",")
    if len(fields) != 6:
        raise SystemExit(
            f"Invalid --color fields {rest!r}. Expected 6 comma-separated numbers."
        )

    def _num(value: str, default, cast):
        value = value.strip()
        return default if value == "" else cast(value)

    speed = _num(fields[0], base.speed, lambda s: int(round(float(s))))
    power = _num(fields[1], base.power, float)
    frequency = _num(fields[2], base.mopa_frequency, int)
    density = _num(fields[3], base.density, int)
    passes = _num(fields[4], base.repeat, int)
    pulse_width = _num(fields[5], base.pulse_width, int)

    params = ProcessingParams(
        speed=speed, power=power, mopa_frequency=frequency,
        density=density, repeat=passes, pulse_width=pulse_width,
        processing_light_source=base.processing_light_source,
    )
    return color, LayerConfig(params=params, render_mode=mode)


def _parse_hatch_override(override: str, base):
    """Parse a --hatch flag value into (color, HatchPass).

    Format: '<hex>:<key=val,key=val,...>:<ramp>:<ramp>...'
    Each ramp is '<param>=<axis>:<min>:<max>'.

    Because we split on ':' and each ramp itself contains 2 colons, ramp_parts
    arrives as flat triples — we re-group below.
    """
    from .svg_source import HatchPass, HatchRamp

    try:
        hex_part, pass_kv_part, *ramp_parts = override.split(":")
    except ValueError:
        raise SystemExit(
            f"Invalid --hatch value {override!r}. "
            "Expected '<hex>:<key=val,...>:<ramp1>:<ramp2>...'"
        )

    color = hex_part.strip().lower()
    if not (color.startswith("#") and len(color) == 7):
        raise SystemExit(f"Invalid hex colour in --hatch: {hex_part!r}")

    angle = 0.0
    spacing = 0.5
    param_overrides: dict[str, object] = {}
    for kv in pass_kv_part.split(","):
        kv = kv.strip()
        if not kv:
            continue
        if "=" not in kv:
            raise SystemExit(f"Invalid --hatch pass key '{kv}' in {override!r}")
        k, v = kv.split("=", 1)
        if k == "angle":
            angle = float(v)
        elif k == "spacing":
            spacing = float(v)
        else:
            param_overrides[k] = v

    # Re-group ramps from ramp_parts into triples.
    if len(ramp_parts) % 3 != 0:
        raise SystemExit(
            f"Invalid --hatch {override!r}: ramp sections must be "
            "'<param>=<axis>:<min>:<max>' (three colons per ramp)."
        )
    ramps: list[HatchRamp] = []
    for i in range(0, len(ramp_parts), 3):
        head = ramp_parts[i]
        if "=" not in head:
            raise SystemExit(f"Invalid ramp head {head!r} in --hatch {override!r}")
        param, axis = head.split("=", 1)
        try:
            min_v = float(ramp_parts[i + 1])
            max_v = float(ramp_parts[i + 2])
        except ValueError:
            raise SystemExit(f"Invalid ramp min/max in --hatch {override!r}")
        if axis not in ("perp", "parallel", "x", "y"):
            raise SystemExit(
                f"Invalid ramp axis {axis!r} in --hatch {override!r}. "
                "Must be perp | parallel | x | y."
            )
        ramps.append(HatchRamp(
            param=param.strip(), axis=axis,  # type: ignore[arg-type]
            min_value=min_v, max_value=max_v,
        ))

    base_params = None
    if param_overrides:
        from .svg_config import _params_from_flat
        base_params = _params_from_flat(param_overrides, base=base)

    return color, HatchPass(angle=angle, spacing=spacing, base_params=base_params, ramps=ramps)


if __name__ == "__main__":
    main()
