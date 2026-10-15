// Colour schemes: hand-tuned presets, plus a full theme generated from any accent colour.
const STORAGE_KEY = "arachne:theme";

export const PRESETS = {
  maroon: {
    label: "Maroon & Knight",
    note: "Dark Void, Dark Maroon & Shining Knight",
    tokens: {
      bg: "#0E0E0F", sidebar: "#120B0D", surface: "#181012", "surface-2": "#22161A", "surface-3": "#2E1D22",
      border: "rgba(155,160,171,0.14)", "border-strong": "rgba(155,160,171,0.27)",
      text: "#F0F4F5", "text-2": "#CDD1D8", muted: "#9BA0AB",
      accent: "#A3213A", "accent-hi": "#DD6A7E", "accent-lo": "#390007", "on-accent": "#F0F4F5",
      bubble: "#390007", web: "#9BA0AB",
    },
  },
  goldnavy: {
    label: "Gold & Navy",
    note: "Burnished gold on deep navy",
    tokens: {
      bg: "#070B16", sidebar: "#091020", surface: "#0D1629", "surface-2": "#131F38", "surface-3": "#1B2947",
      border: "rgba(150,170,210,0.14)", "border-strong": "rgba(150,170,210,0.27)",
      text: "#F5F0E4", "text-2": "#D6CFBF", muted: "#8F99AF",
      accent: "#D4A447", "accent-hi": "#EBC877", "accent-lo": "#142650", "on-accent": "#0A1020",
      bubble: "#142650", web: "#8F99AF",
    },
  },
  rose: {
    label: "Spider Rose",
    note: "Halftone pink on ink",
    tokens: {
      bg: "#100C0E", sidebar: "#150F12", surface: "#1C1418", "surface-2": "#261B21", "surface-3": "#33242C",
      border: "rgba(214,170,190,0.14)", "border-strong": "rgba(214,170,190,0.27)",
      text: "#F7EEF2", "text-2": "#DCCBD3", muted: "#A48F99",
      accent: "#C2577D", "accent-hi": "#E58AAA", "accent-lo": "#4A1A2C", "on-accent": "#FFF5F8",
      bubble: "#3A1626", web: "#B98FA3",
    },
  },
  violet: {
    label: "Midnight Violet",
    note: "Blueprint lines on midnight",
    tokens: {
      bg: "#0E0D12", sidebar: "#131118", surface: "#18161F", "surface-2": "#211E2A", "surface-3": "#2A2635",
      border: "rgba(170,160,220,0.14)", "border-strong": "rgba(170,160,220,0.27)",
      text: "#ECEBF3", "text-2": "#C4C1D1", muted: "#8F8BA1",
      accent: "#8B5CF6", "accent-hi": "#B79CFF", "accent-lo": "#2A1A5E", "on-accent": "#FFFFFF",
      bubble: "#2A2140", web: "#9C9CF0",
    },
  },
};

export const DEFAULT_PREFS = { theme: "maroon", accent: "#a3213a", tailor: true, style: "balanced", motion: "system" };

// ---------- colour maths (sRGB <-> OKLab/OKLCH) ----------
export function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]) {
  const c = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchToLinear(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH -> hex, reducing chroma until the colour fits in sRGB. */
export function oklch(L, C, H) {
  let c = C;
  for (let i = 0; i < 24; i++) {
    const lin = oklchToLinear(L, c, H);
    if (lin.every((v) => v >= -0.0005 && v <= 1.0005)) return rgbToHex(lin.map(toGamma));
    c *= 0.88;
  }
  return rgbToHex(oklchToLinear(L, 0, H).map(toGamma));
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export function alpha(hex, a) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v * 255));
  return `rgba(${r},${g},${b},${a})`;
}

/** A whole dark theme from one accent colour: surfaces and text are tinted toward its hue. */
export function themeFromAccent(hex) {
  const { l, c, h } = hexToOklch(hex);
  const tint = Math.min(c, 0.16);
  const aL = Math.min(0.78, Math.max(0.5, l));
  const accent = oklch(aL, c, h);
  const text = oklch(0.96, 0.008 + tint * 0.04, h);
  const dark = oklch(0.17, 0.02 + tint * 0.1, h);
  const border = hexToRgb(oklch(0.78, 0.02 + tint * 0.15, h)).map((v) => Math.round(v * 255)).join(",");
  return {
    bg: oklch(0.145, tint * 0.08, h),
    sidebar: oklch(0.165, tint * 0.1, h),
    surface: oklch(0.19, tint * 0.12, h),
    "surface-2": oklch(0.225, tint * 0.14, h),
    "surface-3": oklch(0.275, tint * 0.16, h),
    border: `rgba(${border},0.14)`,
    "border-strong": `rgba(${border},0.27)`,
    text,
    "text-2": oklch(0.86, 0.012 + tint * 0.08, h),
    muted: oklch(0.7, 0.015 + tint * 0.12, h),
    accent,
    "accent-hi": oklch(Math.min(0.86, aL + 0.12), c * 0.85, h),
    "accent-lo": oklch(0.27, Math.min(c, 0.12), h),
    "on-accent": contrast(accent, text) >= contrast(accent, dark) ? text : dark,
    bubble: oklch(0.25, Math.min(c, 0.1), h),
    web: oklch(0.72, 0.02 + tint * 0.2, h),
  };
}

export function tokensFor(prefs) {
  if (prefs.theme === "custom" && /^#[0-9a-f]{6}$/i.test(prefs.accent || "")) return themeFromAccent(prefs.accent);
  return (PRESETS[prefs.theme] || PRESETS.maroon).tokens;
}

// ---------- applying ----------
export function applyTheme(prefs, { persist = true } = {}) {
  const t = tokensFor(prefs);
  const vars = {};
  for (const [k, v] of Object.entries(t)) vars[`--${k}`] = v;
  vars["--accent-soft"] = alpha(t.accent, 0.16);
  vars["--accent-ring"] = alpha(t["accent-hi"], 0.55);
  vars["--web-faint"] = alpha(t.web, 0.12);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.motion = prefs.motion || "system";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bg);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ vars, motion: root.dataset.motion }));
    } catch {}
  }
  window.dispatchEvent(new CustomEvent("arachne:theme", { detail: t }));
  return t;
}

/** Current colours, read back from CSS so the 3D scenes always match the page. */
export function readTokens() {
  const css = getComputedStyle(document.documentElement);
  const get = (k) => css.getPropertyValue(`--${k}`).trim();
  return {
    bg: get("bg"), text: get("text"), muted: get("muted"), web: get("web"),
    accent: get("accent"), accentHi: get("accent-hi"), accentLo: get("accent-lo"),
  };
}

export function motionReduced() {
  const m = document.documentElement.dataset.motion || "system";
  return m === "reduce" || (m === "system" && matchMedia("(prefers-reduced-motion: reduce)").matches);
}
