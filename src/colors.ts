/**
 * Colour normalisation for token fingerprinting. Every colour notation in source
 * (3/4/6/8-digit hex, rgb()/rgba(), hsl()/hsla()) is reduced to the canonical
 * lowercase `#rrggbb` the profile's token map is keyed on, with alpha dropped, so one
 * token map matches however the value was written. Only values that land in the
 * profile fire, so the low-false-positive stance is unchanged.
 */

export interface FoundColor {
  /** Canonical `#rrggbb`. */
  hex: string;
  /** True when converted from hsl(): integer h/s/l rounding can land a couple of steps off an authored hex. */
  approximate: boolean;
}

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/gi;

// Whole-notation scanners. The trailing lookahead keeps `#0f62fe80x` / `#12345` from
// matching as a shorter colour.
const SCAN_RE =
  /#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])|\b(?:rgba?|hsla?)\(\s*[^()]*\)/g;

const toHex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

function channel(raw: string): number | null {
  const m = /^(\d*\.?\d+)(%?)$/.exec(raw);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2] ? (v / 100) * 255 : v;
}

function parseRgb(args: string): string | null {
  // Legacy `r, g, b[, a]` and modern `r g b [/ a]` both split on commas/spaces/slash.
  const parts = args.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb = parts.slice(0, 3).map(channel);
  if (rgb.some((c) => c === null)) return null;
  return `#${rgb.map((c) => toHex2(c as number)).join('')}`;
}

function parseHsl(args: string): string | null {
  const parts = args.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const hm = /^(-?\d*\.?\d+)(deg)?$/.exec(parts[0]);
  const sm = /^(\d*\.?\d+)%$/.exec(parts[1]);
  const lm = /^(\d*\.?\d+)%$/.exec(parts[2]);
  if (!hm || !sm || !lm) return null;
  const h = (((parseFloat(hm[1]) % 360) + 360) % 360) / 360;
  const s = Math.min(1, parseFloat(sm[1]) / 100);
  const l = Math.min(1, parseFloat(lm[1]) / 100);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    const x = (t + 1) % 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return `#${[hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map((c) => toHex2(c * 255)).join('')}`;
}

/** Canonical `#rrggbb` for one complete colour notation, or null if it isn't one. */
export function normalizeColor(raw: string): FoundColor | null {
  const value = raw.trim();
  const hexMatch = [...value.matchAll(HEX_RE)][0];
  if (hexMatch) {
    let digits = hexMatch[1].toLowerCase();
    if (digits.length <= 4) digits = [...digits].map((c) => c + c).join('');
    return { hex: `#${digits.slice(0, 6)}`, approximate: false };
  }
  const fn = [...value.matchAll(/^(rgba?|hsla?)\(\s*([^()]*)\)$/gi)][0];
  if (!fn) return null;
  const isHsl = fn[1].toLowerCase().startsWith('hsl');
  const hex = isHsl ? parseHsl(fn[2]) : parseRgb(fn[2]);
  return hex ? { hex, approximate: isHsl } : null;
}

/** Every colour written in `text`, normalised, in order of appearance. */
export function findColors(text: string): FoundColor[] {
  const out: FoundColor[] = [];
  for (const m of text.matchAll(SCAN_RE)) {
    const color = normalizeColor(m[0]);
    if (color) out.push(color);
  }
  return out;
}

// Integer-percent hsl() (what people write by hand) can drift up to 2 per channel from
// the hex it was derived from.
const HSL_TOLERANCE = [0, -1, 1, -2, 2];

/** The canonical hex plus its near neighbours, for approximate (hsl) lookups. */
export function hexNeighbours(hex: string): string[] {
  const base = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const out: string[] = [];
  for (const dr of HSL_TOLERANCE) {
    for (const dg of HSL_TOLERANCE) {
      for (const db of HSL_TOLERANCE) {
        out.push(`#${[base[0] + dr, base[1] + dg, base[2] + db].map(toHex2).join('')}`);
      }
    }
  }
  return out;
}
