"""Small helper that writes DevForge lesson figures (SVG + YAML sidecar) in the house style.

Rebuilt to reproduce the existing figures exactly (checked against files in content/media).
"""
import math
import os
from xml.sax.saxutils import escape


def _fmt(v):
    return str(int(v)) if float(v) == int(v) else f"{v:.1f}"


class Fig:
    def __init__(self, w, h, note):
        self.w, self.h, self.note = w, h, note
        self.parts = []
        self.warnings = []

    def box(self, x, y, w, h, cls):
        self.parts.append(f'  <rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="8"/>')

    def text(self, x, y, s, cls, fit=None):
        if fit is not None:
            width = round(len(s) * (7.9 if "f-mono" in cls else 6.4))
            if width > fit:
                self.warnings.append(f"text may not fit ({width} > {fit}): {s}")
        self.parts.append(f'  <text class="{cls}" x="{x}" y="{y}" text-anchor="middle">{escape(s)}</text>')

    def arrow(self, points):
        *body, (tx, ty) = points
        px, py = body[-1]
        dx, dy = tx - px, ty - py
        length = math.hypot(dx, dy)
        ux, uy = dx / length, dy / length
        bx, by = tx - 8 * ux, ty - 8 * uy
        nx, ny = -uy * 4.5, ux * 4.5
        d = f"M{_fmt(body[0][0])} {_fmt(body[0][1])}"
        for x, y in body[1:]:
            d += f" L{_fmt(x)} {_fmt(y)}"
        d += f" L{_fmt(bx)} {_fmt(by)}"
        head = f"{_fmt(tx)},{_fmt(ty)} {_fmt(bx + nx)},{_fmt(by + ny)} {_fmt(bx - nx)},{_fmt(by - ny)}"
        self.parts.append(f'  <g>\n    <path class="f-arrow" d="{d}"/>\n    <polygon class="f-head" points="{head}"/>\n  </g>')

    def svg(self):
        lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}">', f"  <!-- {escape(self.note)} -->"]
        return "\n".join(lines + self.parts + ["</svg>"]) + "\n"


def _yaml_str(s):
    return "'" + s.replace("'", "''") + "'"


def write(root, track, name, fig, alt, caption):
    folder = os.path.join(root, "content", "media", track)
    os.makedirs(folder, exist_ok=True)
    # Never overwrite another figure: refuse if a step-through uses this name, or if the existing SVG's
    # note (its first comment) belongs to a different figure. Regenerating the same figure is fine.
    svg_path = os.path.join(folder, f"{name}.svg")
    if os.path.exists(os.path.join(folder, f"{name}.steps.yaml")):
        raise SystemExit(f"{track}/{name}: a step-through figure already uses this name; choose another")
    if os.path.exists(svg_path):
        with open(svg_path) as existing:
            head = existing.read(600)
        if f"<!-- {escape(fig.note)} -->" not in head:
            raise SystemExit(f"{track}/{name}.svg already exists for a different figure; choose another name")
    with open(os.path.join(folder, f"{name}.svg"), "w") as f:
        f.write(fig.svg())
    with open(os.path.join(folder, f"{name}.yaml"), "w") as f:
        f.write(f"alt: {_yaml_str(alt)}\ncaption: {_yaml_str(caption)}\ncredit: DevForge 18 content team\nlicence: project-content\n")
    for w in fig.warnings:
        print(f"{track}/{name}: {w}")
