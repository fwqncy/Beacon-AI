// Colour wheel: hue around the disc, saturation out from the centre, brightness on a slider.
import { hexToRgb, rgbToHex } from "./theme.js";
import { html } from "./ui.js";

export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex([f(5), f(3), f(1)]);
}

export function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max];
}

const SWATCHES = [
  ["#A3213A", "Burgundy"], ["#D4A447", "Gold"], ["#2F5DA8", "Navy Blue"], ["#C2577D", "Rose"],
  ["#8B5CF6", "Violet"], ["#1F9E89", "Teal"], ["#E2643D", "Ember"], ["#9BA0AB", "Shining Knight"],
];
const HEX = /^#?[0-9a-f]{6}$/i;
const SIZE = 196;

export function colorWheel(mount, { value = "#A3213A", onInput, onChange }) {
  let [h, s, v] = hexToHsv(value);
  const el = html(`
    <div class="wheel">
      <div class="wheel-disc" role="slider" tabindex="0" aria-label="Colour Wheel"
           aria-valuemin="0" aria-valuemax="360" aria-describedby="wheelHelp">
        <canvas width="${SIZE * 2}" height="${SIZE * 2}"></canvas>
        <span class="wheel-thumb" aria-hidden="true"></span>
      </div>
      <div class="wheel-controls">
        <label class="field-label" for="wheelBright">Brightness</label>
        <input id="wheelBright" name="brightness" type="range" min="35" max="100" step="1">
        <label class="field-label" for="wheelHex">Hex Code</label>
        <div class="hex-row">
          <span class="hex-swatch" aria-hidden="true"></span>
          <input id="wheelHex" class="input mono" name="accent" autocomplete="off" spellcheck="false"
                 maxlength="7" placeholder="#A3213A" aria-describedby="wheelHexError" translate="no">
        </div>
        <p class="field-error" id="wheelHexError" aria-live="polite"></p>
        <span class="field-label" id="quickLabel">Quick Picks</span>
        <div class="swatch-row" role="group" aria-labelledby="quickLabel">
          ${SWATCHES.map(([c, n]) => `<button type="button" class="swatch" style="--c:${c}" data-hex="${c}" aria-label="${n}" title="${n}"></button>`).join("")}
        </div>
        <p id="wheelHelp" class="hint">Drag on the wheel, or focus it & use ←&nbsp;→ for hue and ↑&nbsp;↓ for saturation.</p>
      </div>
    </div>`);
  mount.replaceChildren(el);

  const disc = el.querySelector(".wheel-disc");
  const canvas = el.querySelector("canvas");
  const thumb = el.querySelector(".wheel-thumb");
  const bright = el.querySelector("#wheelBright");
  const hexIn = el.querySelector("#wheelHex");
  const hexErr = el.querySelector("#wheelHexError");
  const swatch = el.querySelector(".hex-swatch");
  const ctx = canvas.getContext("2d");
  let drawnV = -1;

  function draw() {
    if (drawnV === v) return;
    drawnV = v;
    const n = canvas.width;
    const c = n / 2;
    const img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x - c + 0.5;
        const dy = c - y - 0.5;
        const r = Math.hypot(dx, dy) / c;
        if (r > 1) continue;
        const hue = (Math.atan2(dy, dx) * 180) / Math.PI;
        const [R, G, B] = hexToRgb(hsvToHex((hue + 360) % 360, r, v));
        const i = (y * n + x) * 4;
        img.data[i] = R * 255;
        img.data[i + 1] = G * 255;
        img.data[i + 2] = B * 255;
        img.data[i + 3] = 255 * Math.min(1, (1 - r) * c); // soft edge
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function sync(fromHex = false) {
    const hex = hsvToHex(h, s, v);
    draw();
    const a = (h * Math.PI) / 180;
    thumb.style.transform = `translate(${(Math.cos(a) * s * SIZE) / 2}px, ${(-Math.sin(a) * s * SIZE) / 2}px)`;
    thumb.style.background = hex;
    swatch.style.background = hex;
    bright.value = Math.round(v * 100);
    if (!fromHex) hexIn.value = hex;
    disc.setAttribute("aria-valuenow", Math.round(h));
    disc.setAttribute("aria-valuetext", `Hue ${Math.round(h)}°, saturation ${Math.round(s * 100)}%, ${hex}`);
    return hex;
  }

  const emit = (final) => {
    const hex = hsvToHex(h, s, v);
    onInput?.(hex);
    if (final) onChange?.(hex);
  };

  function fromPointer(e) {
    const r = disc.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = r.top + r.height / 2 - e.clientY;
    h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    s = Math.min(1, Math.hypot(dx, dy) / (r.width / 2));
    sync();
    emit(false);
  }

  disc.addEventListener("pointerdown", (e) => {
    disc.setPointerCapture(e.pointerId);
    disc.classList.add("dragging");
    fromPointer(e);
  });
  disc.addEventListener("pointermove", (e) => {
    if (disc.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  disc.addEventListener("pointerup", () => {
    disc.classList.remove("dragging");
    emit(true);
  });
  disc.addEventListener("keydown", (e) => {
    const big = e.shiftKey ? 3 : 1;
    const moves = {
      ArrowLeft: () => (h = (h + 355 - 5 * (big - 1) * 2) % 360),
      ArrowRight: () => (h = (h + 5 + 10 * (big - 1)) % 360),
      ArrowUp: () => (s = Math.min(1, s + 0.05 * big)),
      ArrowDown: () => (s = Math.max(0, s - 0.05 * big)),
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    moves[e.key]();
    sync();
    emit(true);
  });
  bright.addEventListener("input", () => {
    v = bright.value / 100;
    sync();
    emit(false);
  });
  bright.addEventListener("change", () => emit(true));

  function commitHex() {
    const raw = hexIn.value.trim();
    if (!HEX.test(raw)) {
      hexErr.textContent = "Use a 6-digit hex code, like #A3213A.";
      hexIn.setAttribute("aria-invalid", "true");
      return;
    }
    hexErr.textContent = "";
    hexIn.removeAttribute("aria-invalid");
    [h, s, v] = hexToHsv(raw.startsWith("#") ? raw : `#${raw}`);
    sync(true);
    emit(true);
  }
  hexIn.addEventListener("input", () => {
    if (HEX.test(hexIn.value.trim())) commitHex();
  });
  hexIn.addEventListener("change", commitHex);
  hexIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitHex();
    }
  });
  el.querySelector(".swatch-row").addEventListener("click", (e) => {
    const b = e.target.closest(".swatch");
    if (!b) return;
    [h, s, v] = hexToHsv(b.dataset.hex);
    sync();
    emit(true);
  });

  sync();
  return {
    set(hex) {
      [h, s, v] = hexToHsv(hex);
      sync();
    },
  };
}
