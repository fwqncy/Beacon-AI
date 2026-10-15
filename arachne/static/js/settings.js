// Settings dialog: colour scheme (presets + colour wheel), answer tailoring, motion. Deep-linked via ?settings=.
import { colorWheel } from "./colorwheel.js";
import { getPrefs, previewPrefs, updatePrefs } from "./prefs.js";
import { PRESETS, themeFromAccent } from "./theme.js";
import { $, $$, html, icon } from "./ui.js";

const SECTIONS = ["appearance", "answers", "motion"];

function swatchesFor(tokens) {
  return [tokens.bg, tokens.bubble, tokens.accent, tokens.muted].map((c) => `<span style="background:${c}"></span>`).join("");
}

export function initSettings() {
  const dialog = $("#settings");
  let wheel;
  let saveTimer;

  dialog.innerHTML = `
    <div class="sheet-inner">
      <header class="sheet-head">
        <h2 id="settingsTitle">Settings</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close Settings" title="Close Settings">${icon("x")}</button>
      </header>
      <nav class="sheet-tabs" aria-label="Settings Sections">
        ${SECTIONS.map((s) => `<a href="?settings=${s}" data-sec="${s}">${s[0].toUpperCase() + s.slice(1)}</a>`).join("")}
      </nav>
      <div class="sheet-scroll">
        <section class="set-section" id="set-appearance" aria-labelledby="h-appearance">
          <h3 id="h-appearance">Colour Scheme</h3>
          <p class="hint">Saved to your account, so it follows you to every device.</p>
          <div class="themes" role="radiogroup" aria-labelledby="h-appearance">
            ${Object.entries(PRESETS).map(([key, p]) => `
              <label class="theme-card">
                <input class="visually-hidden" type="radio" name="theme" value="${key}">
                <span class="theme-swatches" aria-hidden="true">${swatchesFor(p.tokens)}</span>
                <span class="theme-name">${p.label}</span>
                <span class="theme-note">${p.note}</span>
              </label>`).join("")}
            <label class="theme-card">
              <input class="visually-hidden" type="radio" name="theme" value="custom">
              <span class="theme-swatches custom-swatches" aria-hidden="true"></span>
              <span class="theme-name">Custom Colour</span>
              <span class="theme-note">Any accent from the colour wheel</span>
            </label>
          </div>
          <div class="custom-panel" id="customPanel" hidden></div>
        </section>
        <section class="set-section" id="set-answers" aria-labelledby="h-answers">
          <h3 id="h-answers">Answers</h3>
          <label class="check-row">
            <input type="checkbox" name="tailor">
            <span>
              <span class="check-title">Tailor Answers to You</span>
              <span class="hint">Arachne adds your name, team & most-asked topics to each question so examples fit your work. <a href="/web#learned">See exactly what’s shared</a>.</span>
            </span>
          </label>
          <fieldset class="segmented">
            <legend>Answer Length</legend>
            ${["concise", "balanced", "detailed"].map((v) => `
              <label><input class="visually-hidden" type="radio" name="style" value="${v}"><span>${v[0].toUpperCase() + v.slice(1)}</span></label>`).join("")}
          </fieldset>
        </section>
        <section class="set-section" id="set-motion" aria-labelledby="h-motion">
          <h3 id="h-motion">Motion</h3>
          <fieldset class="segmented">
            <legend class="visually-hidden">Motion</legend>
            ${[["system", "Match System"], ["reduce", "Reduced"], ["full", "Full"]].map(([v, l]) => `
              <label><input class="visually-hidden" type="radio" name="motion" value="${v}"><span>${l}</span></label>`).join("")}
          </fieldset>
          <p class="hint">Reduced keeps every web still & turns off the tremor while Arachne answers.</p>
        </section>
      </div>
    </div>`;

  const customPanel = $("#customPanel", dialog);

  function syncFromPrefs() {
    const p = getPrefs();
    $$("input[name=theme]", dialog).forEach((r) => (r.checked = r.value === p.theme));
    $("input[name=tailor]", dialog).checked = p.tailor;
    $$("input[name=style]", dialog).forEach((r) => (r.checked = r.value === p.style));
    $$("input[name=motion]", dialog).forEach((r) => (r.checked = r.value === p.motion));
    $(".custom-swatches", dialog).innerHTML = swatchesFor(themeFromAccent(p.accent));
    customPanel.hidden = p.theme !== "custom";
    if (!customPanel.hidden && !wheel) mountWheel();
  }

  function mountWheel() {
    wheel = colorWheel(customPanel, {
      value: getPrefs().accent,
      onInput: (hex) => {
        previewPrefs({ theme: "custom", accent: hex });
        $(".custom-swatches", dialog).innerHTML = swatchesFor(themeFromAccent(hex));
      },
      onChange: (hex) => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => updatePrefs({ theme: "custom", accent: hex }), 250);
      },
    });
  }

  dialog.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "theme") {
      updatePrefs({ theme: t.value });
      customPanel.hidden = t.value !== "custom";
      if (t.value === "custom" && !wheel) mountWheel();
    } else if (t.name === "tailor") updatePrefs({ tailor: t.checked });
    else if (t.name === "style" || t.name === "motion") updatePrefs({ [t.name]: t.value });
  });

  dialog.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]") || e.target === dialog) close();
    const tab = e.target.closest("[data-sec]");
    if (tab) {
      e.preventDefault();
      show(tab.dataset.sec);
    }
  });

  dialog.addEventListener("close", () => {
    const url = new URL(location.href);
    url.searchParams.delete("settings");
    history.replaceState(history.state, "", url);
  });

  function show(section) {
    const sec = SECTIONS.includes(section) ? section : "appearance";
    $$("[data-sec]", dialog).forEach((a) => a.setAttribute("aria-current", a.dataset.sec === sec ? "true" : "false"));
    $(`#set-${sec}`, dialog).scrollIntoView({ block: "start", behavior: "instant" });
    const url = new URL(location.href);
    url.searchParams.set("settings", sec);
    history.replaceState(history.state, "", url);
  }

  function open(section = "appearance") {
    syncFromPrefs();
    if (!dialog.open) dialog.showModal();
    show(section);
  }

  function close() {
    dialog.close();
  }

  window.addEventListener("arachne:prefs", () => dialog.open && syncFromPrefs());
  return { open, close };
}
