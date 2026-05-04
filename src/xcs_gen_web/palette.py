"""CIE Lab conversion and CIEDE2000 color-distance helpers.

Lab conversion uses D65 sRGB (the webby default); if we ever need device-ICC
accuracy that's a per-capture concern, not a per-query one.
"""

from __future__ import annotations

import math


def _hex_to_srgb(hex_: str) -> tuple[float, float, float]:
    h = hex_.lstrip("#")
    return (int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255)


def _srgb_to_linear(c: float) -> float:
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def _linear_srgb_to_xyz(r: float, g: float, b: float) -> tuple[float, float, float]:
    # sRGB → XYZ (D65)
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    return x, y, z


def _xyz_to_lab(x: float, y: float, z: float) -> tuple[float, float, float]:
    xn, yn, zn = 0.95047, 1.00000, 1.08883  # D65 reference white
    x /= xn
    y /= yn
    z /= zn

    def f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116

    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def hex_to_lab(hex_: str) -> tuple[float, float, float]:
    """Convert ``#rrggbb`` to CIE Lab (D65)."""
    r, g, b = _hex_to_srgb(hex_)
    lr, lg, lb = _srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b)
    return _xyz_to_lab(*_linear_srgb_to_xyz(lr, lg, lb))


def lab_to_hex(L: float, a: float, b: float) -> str:
    """Convert CIE Lab (D65) back to ``#rrggbb``. Inverse of
    ``hex_to_lab``; round-trips through XYZ → linear sRGB → sRGB
    with channels clamped to [0,1] so out-of-gamut Labs (typical of
    burn-mean averages) still produce a valid hex.
    """
    def f_inv(t: float) -> float:
        return t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787

    fy = (L + 16) / 116
    fx = fy + a / 500
    fz = fy - b / 200
    xn, yn, zn = 0.95047, 1.00000, 1.08883
    X, Y, Z = f_inv(fx) * xn, f_inv(fy) * yn, f_inv(fz) * zn
    r =  3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z
    g = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z
    b_ = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z

    def to_srgb(u: float) -> int:
        if u <= 0:
            return 0
        if u >= 1:
            return 255
        v = 12.92 * u if u <= 0.0031308 else 1.055 * (u ** (1 / 2.4)) - 0.055
        return max(0, min(255, round(v * 255)))

    return f"#{to_srgb(r):02x}{to_srgb(g):02x}{to_srgb(b_):02x}"


def delta_e_2000(
    lab1: tuple[float, float, float] | list[float],
    lab2: tuple[float, float, float] | list[float],
) -> float:
    """CIEDE2000 color difference (Sharma et al. 2005)."""
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2

    avg_L = (L1 + L2) / 2
    C1 = math.sqrt(a1 * a1 + b1 * b1)
    C2 = math.sqrt(a2 * a2 + b2 * b2)
    avg_C = (C1 + C2) / 2

    G = 0.5 * (1 - math.sqrt(avg_C ** 7 / (avg_C ** 7 + 25 ** 7)))
    a1p = (1 + G) * a1
    a2p = (1 + G) * a2

    C1p = math.sqrt(a1p * a1p + b1 * b1)
    C2p = math.sqrt(a2p * a2p + b2 * b2)
    avg_Cp = (C1p + C2p) / 2

    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360

    if abs(h1p - h2p) > 180:
        avg_Hp = (h1p + h2p + 360) / 2
    else:
        avg_Hp = (h1p + h2p) / 2

    T = (1 - 0.17 * math.cos(math.radians(avg_Hp - 30))
         + 0.24 * math.cos(math.radians(2 * avg_Hp))
         + 0.32 * math.cos(math.radians(3 * avg_Hp + 6))
         - 0.20 * math.cos(math.radians(4 * avg_Hp - 63)))

    dhp = h2p - h1p
    if abs(dhp) > 180:
        dhp -= 360 if dhp > 0 else -360

    dLp = L2 - L1
    dCp = C2p - C1p
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))

    SL = 1 + (0.015 * (avg_L - 50) ** 2) / math.sqrt(20 + (avg_L - 50) ** 2)
    SC = 1 + 0.045 * avg_Cp
    SH = 1 + 0.015 * avg_Cp * T

    dTheta = 30 * math.exp(-(((avg_Hp - 275) / 25) ** 2))
    RC = 2 * math.sqrt(avg_Cp ** 7 / (avg_Cp ** 7 + 25 ** 7))
    RT = -RC * math.sin(math.radians(2 * dTheta))

    return math.sqrt(
        (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2
        + RT * (dCp / SC) * (dHp / SH)
    )
