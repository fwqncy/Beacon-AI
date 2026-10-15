// ⌘K command menu: search chats, run commands, or ask Arachne straight from the keyboard.
import { $, esc, html, icon } from "./ui.js";

export function initPalette({ commands, chats, ask }) {
  const dialog = $("#palette");
  dialog.innerHTML = `
    <div class="palette-search">
      ${icon("search")}
      <input id="paletteInput" type="text" role="combobox" aria-expanded="true" aria-controls="paletteList"
             aria-autocomplete="list" aria-label="Search chats & commands" placeholder="Search chats & commands…"
             autocomplete="off" spellcheck="false">
      <kbd>Esc</kbd>
    </div>
    <ul class="palette-list" id="paletteList" role="listbox" aria-label="Results"></ul>
    <footer class="palette-foot" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> Move</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span>
    </footer>`;
  const input = $("#paletteInput", dialog);
  const list = $("#paletteList", dialog);
  let items = [];
  let active = 0;

  function results(q) {
    const query = q.trim().toLowerCase();
    const match = (s) => !query || s.toLowerCase().includes(query);
    const out = [];
    if (query) out.push({ group: "Ask", label: `Ask Arachne: “${q.trim()}”`, icon: "logo", run: () => ask(q.trim()) });
    for (const c of commands()) if (match(`${c.label} ${c.keywords || ""}`)) out.push({ group: "Commands", ...c });
    const found = chats().filter((c) => match(c.title)).slice(0, query ? 12 : 6);
    for (const c of found) out.push({ group: "Chats", label: c.title, icon: "web", href: `/c/${c.id}`, run: () => c.open() });
    return out;
  }

  function render() {
    items = results(input.value);
    active = Math.min(active, Math.max(0, items.length - 1));
    list.innerHTML = "";
    let group = "";
    items.forEach((item, i) => {
      if (item.group !== group) {
        group = item.group;
        list.append(html(`<li class="palette-group" role="presentation">${group}</li>`));
      }
      const li = html(`<li role="option" class="palette-item" id="pi-${i}" data-i="${i}">${icon(item.icon || "spark")}<span></span>${item.hint ? `<kbd>${esc(item.hint)}</kbd>` : ""}</li>`);
      li.querySelector("span").textContent = item.label;
      list.append(li);
    });
    if (!items.length) list.append(html(`<li class="palette-empty" role="presentation">No chats or commands match. Press Enter to ask Arachne instead.</li>`));
    highlight();
  }

  function highlight() {
    list.querySelectorAll("[role=option]").forEach((li) => {
      const on = Number(li.dataset.i) === active;
      li.setAttribute("aria-selected", on);
      if (on) li.scrollIntoView({ block: "nearest" });
    });
    input.setAttribute("aria-activedescendant", items.length ? `pi-${active}` : "");
  }

  function run(i) {
    const item = items[i];
    close();
    item?.run();
  }

  input.addEventListener("input", () => {
    active = 0;
    render();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      highlight();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items.length) run(active);
      else if (input.value.trim()) {
        close();
        ask(input.value.trim());
      }
    }
  });
  list.addEventListener("pointermove", (e) => {
    const li = e.target.closest("[role=option]");
    if (li && Number(li.dataset.i) !== active) {
      active = Number(li.dataset.i);
      highlight();
    }
  });
  list.addEventListener("click", (e) => {
    const li = e.target.closest("[role=option]");
    if (li) run(Number(li.dataset.i));
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });

  function open() {
    input.value = "";
    active = 0;
    render();
    if (!dialog.open) dialog.showModal();
    input.focus();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  return { open, close };
}
