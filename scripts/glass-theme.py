#!/usr/bin/env python3
"""CareOS Glas-Design: stellt die hellen Farben der Stylesheets auf dunkles Glas um.

Die Oberfläche liegt auf einem nächtlichen Himmel (public/backgrounds/night-sky.webp). Weisse Flächen werden zu
durchscheinendem Glas, dunkle Schrift wird hell, farbige Schrift heller (Ton bleibt), helle Linien zu feinen
Glaskanten. Statusfarben, App-Farben und Knöpfe behalten ihren Ton. Druckregeln (@media print) bleiben unverändert.

Einmalig angewendet: Die Farbumstellung ist nicht wiederholbar (ein zweiter Lauf würde helle Schrift wieder
abdunkeln). Neue Regeln gleich in den Glasfarben schreiben (Variablen aus app/styles/71-glass.css).
Aufruf: python3 scripts/glass-theme.py app/styles/*.css app/components/*.css app/<modul>/*.css
"""
import colorsys
import re
import sys

# Papier bleibt Papier: Dokumente im Editor und Druckansichten.
SKIP_FILES = ("62-office-document.css", "62-office-print.css", "71-glass.css", "72-os.css")

HEX = r"#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b"
FUNC = r"rgba?\([^()]*\)|hsla?\([^()]*\)"
WORD = r"(?<![\w-])(?:white|black)(?![\w-])"
COLOR = re.compile(f"{HEX}|{FUNC}|{WORD}")


def parse(token):
    t = token.lower()
    if t == "white":
        return 255, 255, 255, 1.0
    if t == "black":
        return 0, 0, 0, 1.0
    if t.startswith("#"):
        h = t[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    if "var(" in t or "calc(" in t or "from " in t:
        return None
    inner = t[t.index("(") + 1 : -1].replace("/", " ").replace(",", " ").split()
    try:
        if t.startswith("rgb"):
            vals = [float(v[:-1]) * 2.55 if v.endswith("%") else float(v) for v in inner[:3]]
            a = inner[3] if len(inner) > 3 else "1"
            a = float(a[:-1]) / 100 if a.endswith("%") else float(a)
            return vals[0], vals[1], vals[2], a
        h = float(inner[0].replace("deg", ""))
        s = float(inner[1].rstrip("%")) / 100
        l = float(inner[2].rstrip("%")) / 100
        a = inner[3] if len(inner) > 3 else "1"
        a = float(a[:-1]) / 100 if a.endswith("%") else float(a)
        r, g, b = colorsys.hls_to_rgb((h % 360) / 360, l, s)
        return r * 255, g * 255, b * 255, a
    except (ValueError, IndexError):
        return None


def fmt(r, g, b, a):
    r, g, b = (max(0, min(255, round(v))) for v in (r, g, b))
    a = max(0.0, min(1.0, a))
    if a >= 0.999:
        return f"#{r:02x}{g:02x}{b:02x}"
    return f"rgba({r}, {g}, {b}, {round(a, 3):g})"


def hls(r, g, b):
    return colorsys.rgb_to_hls(r / 255, g / 255, b / 255)


def from_hls(h, l, s, a):
    r, g, b = colorsys.hls_to_rgb(h, max(0, min(1, l)), max(0, min(1, s)))
    return fmt(r * 255, g * 255, b * 255, a)


def chroma(r, g, b):
    return (max(r, g, b) - min(r, g, b)) / 255


def bg(r, g, b, a):
    h, l, s = hls(r, g, b)
    c = chroma(r, g, b)
    if l >= 0.86:
        if c < 0.07:
            if l >= 0.985 and a >= 0.999:
                return "var(--glass-surface)"
            if l >= 0.985:
                return fmt(255, 255, 255, 0.08 * a)
            return fmt(255, 255, 255, (0.035 + (0.985 - l) * 0.75) * a)
        # Getönte helle Flächen (Hinweise, Auswahl): Farbe als leichter Schleier.
        return from_hls(h, 0.62, min(s, 0.85), 0.16 * a + 0.02)
    if c < 0.07 and l >= 0.6:
        return fmt(255, 255, 255, 0.13 * a)
    return None


def fg(r, g, b, a):
    h, l, s = hls(r, g, b)
    c = chroma(r, g, b)
    if l > 0.85:
        return None
    if c < 0.25:
        return from_hls(h, min(0.97, max(0.45, 1.088 - 0.862 * l)), min(s, 0.3), a)
    if l < 0.7:
        return from_hls(h, 0.7 + (0.7 - l) * 0.12, min(s, 0.9), a)
    return None


def line(r, g, b, a):
    h, l, s = hls(r, g, b)
    c = chroma(r, g, b)
    if l >= 0.72:
        if c < 0.1:
            return fmt(255, 255, 255, (0.08 + max(0, 0.95 - l) * 0.45) * a)
        return from_hls(h, 0.62, min(s, 0.85), 0.38 * a)
    if c < 0.12:
        return fmt(255, 255, 255, 0.2 * a)
    return fg(r, g, b, a)


def shadow(r, g, b, a):
    h, l, s = hls(r, g, b)
    if l > 0.72:
        return line(r, g, b, a) if a >= 0.6 else None
    if chroma(r, g, b) < 0.3 or l < 0.3:
        return fmt(0, 0, 0, min(0.55, a * 1.6 + 0.04))
    return None


def category(prop, value):
    p = prop.strip().lower()
    if p.startswith("--"):
        if re.search(r"(bg|background|surface|soft|tint|fill|paper|panel|card|wash|track)", p):
            return "bg"
        if re.search(r"(line|border|rule|divider|stroke|ring)", p):
            return "line"
        if re.search(r"(shadow|glow)", p):
            return "shadow"
        if re.search(r"(ink|text|muted|fg|foreground|label|title)", p):
            return "fg"
        return "auto"
    if p.startswith("background") or p in ("mask", "border-image"):
        return "bg"
    if p.startswith("border") or p.startswith("outline") or p == "column-rule":
        return "line"
    if p in ("box-shadow", "text-shadow", "filter", "-webkit-box-shadow"):
        return "shadow"
    return "fg"


def convert(cat, token):
    parsed = parse(token)
    if not parsed:
        return token
    r, g, b, a = parsed
    if cat == "auto":
        cat = "bg" if hls(r, g, b)[1] > 0.88 else "fg"
    result = {"bg": bg, "fg": fg, "line": line, "shadow": shadow}[cat](r, g, b, a)
    return result or token


RADII = {"6px": "12px", "7px": "12px", "8px": "14px", "9px": "16px", "10px": "16px", "11px": "18px", "12px": "18px"}


def round_corners(decl):
    """Glas hat weiche Ecken: mittlere Radien werden grösser (kleine Radien von Balken und Zählern bleiben)."""
    match = re.match(r"((?:\s|/\*.*?\*/)*)(border(?:-[a-z]+)*-radius)(\s*:\s*)(.*)", decl, re.S)
    if not match:
        return decl
    lead, prop, colon, value = match.groups()
    return lead + prop + colon + re.sub(r"(?<![\d.])(\d+px)", lambda m: RADII.get(m.group(1), m.group(1)), value)


def transform_declaration(decl):
    match = re.match(r"((?:\s|/\*.*?\*/)*)([-\w]+)(\s*:\s*)(.*)", decl, re.S)
    if not match:
        return decl
    lead, prop, colon, value = match.groups()
    if "url(" in value and "data:" in value:
        return decl
    cat = category(prop, value)
    return lead + prop + colon + COLOR.sub(lambda m: convert(cat, m.group(0)), value)


def transform(text, declaration=None):
    declaration = declaration or (lambda decl: round_corners(transform_declaration(decl)))
    out, buf, stack = [], [], []
    i, n = 0, len(text)
    quote, depth = None, 0

    def flush(end):
        decl = "".join(buf)
        buf.clear()
        in_print = any(h.startswith("@media print") or "print" in h and h.startswith("@media") for h in stack)
        if not in_print and ":" in decl and stack and not stack[-1].startswith("@"):
            decl = declaration(decl)
        out.append(decl + end)

    while i < n:
        ch = text[i]
        if quote:
            buf.append(ch)
            if ch == quote and text[i - 1] != "\\":
                quote = None
            i += 1
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j < 0 else j + 2
            buf.append(text[i:j])
            i = j
            continue
        if ch in "\"'":
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and ch == "{":
            header = re.sub(r"/\*.*?\*/", "", "".join(buf), flags=re.S).strip()
            out.append("".join(buf) + "{")
            buf.clear()
            stack.append(header)
            i += 1
            continue
        elif depth == 0 and ch in ";}":
            flush(ch)
            if ch == "}" and stack:
                stack.pop()
            i += 1
            continue
        buf.append(ch)
        i += 1
    out.append("".join(buf))
    return "".join(out)


if __name__ == "__main__":
    # --radius-only: nur die Ecken (für bereits umgestellte Dateien; die Farbumstellung ist nicht wiederholbar).
    only_radius = "--radius-only" in sys.argv
    for path in [arg for arg in sys.argv[1:] if not arg.startswith("--")]:
        if path.endswith(SKIP_FILES):
            continue
        with open(path, encoding="utf-8") as handle:
            source = handle.read()
        result = transform(source, round_corners if only_radius else None)
        if result != source:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(result)
            print("converted", path)
