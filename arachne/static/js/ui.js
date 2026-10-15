// Small shared helpers: DOM, API, toasts, announcements, shortcuts, brand menu.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function html(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

export function icon(name, cls = "icon") {
  return `<svg class="${cls}" aria-hidden="true"><use href="/static/icons.svg#${name === "logo" ? "logo" : `i-${name}`}"/></svg>`;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("Not signed in");
  }
  return res;
}

export const apiJSON = async (path, opts) => {
  const res = await api(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(typeof err.detail === "string" ? err.detail : `Request failed (${res.status})`);
  }
  return res.json();
};

// ---------- formatting ----------
export const nf = new Intl.NumberFormat(navigator.language);
export const fmt = (n) => nf.format(n);
export const compact = (n) => new Intl.NumberFormat(navigator.language, { notation: "compact" }).format(n);
export const fmtDate = (d) =>
  new Intl.DateTimeFormat(navigator.language, { month: "short", day: "numeric" }).format(new Date(d));

// ---------- keyboard ----------
export const isMac = /mac|iphone|ipad/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);
export const mod = (e) => (isMac ? e.metaKey : e.ctrlKey);
const SHORTCUTS = { palette: ["mod", "K"], new: ["shift", "mod", "O"] };
export function shortcutLabel(name) {
  if (isMac) return SHORTCUTS[name].map((k) => ({ mod: "⌘", shift: "⇧" })[k] || k).join("");
  const keys = [...SHORTCUTS[name]].sort((a, b) => (b === "mod") - (a === "mod")); // Ctrl first, as Windows writes it
  return keys.map((k) => ({ mod: "Ctrl", shift: "Shift" })[k] || k).join("+");
}
export function fillShortcuts(root = document) {
  $$("[data-shortcut]", root).forEach((el) => (el.textContent = shortcutLabel(el.dataset.shortcut)));
}

// ---------- toasts & announcements ----------
export function announce(msg) {
  const el = $("#announcer");
  if (!el) return;
  el.textContent = "";
  requestAnimationFrame(() => (el.textContent = msg));
}

export function toast(msg, { action, onAction, duration = 3200 } = {}) {
  const region = $("#toasts");
  const el = html(`<div class="toast"><span></span></div>`);
  el.firstChild.textContent = msg;
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 180);
  };
  if (action) {
    const btn = html(`<button type="button" class="toast-action"></button>`);
    btn.textContent = action;
    btn.addEventListener("click", () => {
      onAction?.();
      close();
    });
    el.append(btn);
  }
  region.append(el);
  timer = setTimeout(close, duration);
  return close;
}

// ---------- brand menu (right-click the logo) ----------
export function brandMenu(logo) {
  let menu;
  const close = () => {
    menu?.remove();
    menu = null;
    document.removeEventListener("pointerdown", outside, true);
  };
  const outside = (e) => {
    if (menu && !menu.contains(e.target)) close();
  };
  logo.addEventListener("contextmenu", async (e) => {
    e.preventDefault();
    close();
    const svg = await (await fetch("/static/logo.svg")).text();
    menu = html(`
      <div class="menu brand-menu" role="menu" aria-label="Brand Assets">
        <button type="button" role="menuitem" data-act="copy">${icon("copy")}Copy Logo as SVG</button>
        <a role="menuitem" href="/static/logo.svg" download="arachne-logo.svg">${icon("download")}Download Logo</a>
      </div>`);
    const x = e.clientX || logo.getBoundingClientRect().left;
    const y = e.clientY || logo.getBoundingClientRect().bottom;
    Object.assign(menu.style, { left: `${Math.min(x, innerWidth - 220)}px`, top: `${y + 6}px` });
    menu.addEventListener("click", async (ev) => {
      if (ev.target.closest('[data-act="copy"]')) {
        await navigator.clipboard.writeText(svg);
        toast("Logo SVG copied");
      }
      close();
    });
    menu.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        close();
        logo.focus();
      }
    });
    document.body.append(menu);
    menu.querySelector("[role=menuitem]").focus();
    document.addEventListener("pointerdown", outside, true);
  });
}
