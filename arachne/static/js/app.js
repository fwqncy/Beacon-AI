// Arachne chat client: chats in the sidebar, streamed grounded answers with citations,
// Spider-Sense follow-ups, feedback, settings & the ⌘K menu.
import { initPalette } from "./palette.js";
import { setPrefs, updatePrefs } from "./prefs.js";
import { initSettings } from "./settings.js";
import { PRESETS } from "./theme.js";
import { mountAmbientWeb } from "./threads.js";
import { $, $$, announce, api, apiJSON, brandMenu, fillShortcuts, fmt, html, icon, mod, toast } from "./ui.js";

const CITE_MARKER = "\x1e";
const CITE_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

const els = {
  app: $("#app"), main: $("#main"), scroll: $("#scroll"), messages: $("#messages"),
  welcome: $("#welcome"), greeting: $("#greeting"), chatList: $("#chatList"),
  composer: $("#composer"), input: $("#input"), send: $("#send"),
  title: $("#chatTitle"), menu: $("#menu"), exportBtn: $("#exportChat"),
};

const state = { user: null, rank: null, chatId: null, chats: [], busy: false, controller: null };
const mobile = matchMedia("(max-width: 820px)");
let ambient = null;
let settings;
let palette;

// ---------- helpers ----------
function nearBottom() {
  const s = els.scroll;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 140;
}
function toBottom(force = false) {
  if (force || nearBottom()) els.scroll.scrollTop = els.scroll.scrollHeight;
}

// ---------- citations ----------
// Claude cites sources by retrieval number ([1], [7]); readers see them renumbered in order of
// first appearance (1, 2, …), while data-n keeps the original for lookups.
let citeLabels = new Map();

function citeOrder(text) {
  const order = new Map();
  for (const m of text.matchAll(CITE_RE)) {
    for (const n of m[1].split(/\s*,\s*/).map(Number)) if (!order.has(n)) order.set(n, order.size + 1);
  }
  return order;
}

const citeButton = (n) =>
  `<button type="button" class="cite" data-n="${n}" aria-label="Source ${citeLabels.get(Number(n)) ?? n}">${citeLabels.get(Number(n)) ?? n}</button>`;

// ---------- markdown (escaped first, then a small safe subset) ----------
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CITE_RUN = /[ \t]?((?:\[\d+(?:\s*,\s*\d+)*\])+)([.,;:!?)]?)/g;
const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/;

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(CITE_RUN, (_, cites, punct) => {
      const nums = [...cites.matchAll(/\d+/g)].map((m) => m[0]);
      return `&nbsp;<span class="nowrap">${nums.map(citeButton).join("")}${punct}</span>`;
    });
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

function markdown(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
    } else if (!line.trim()) {
      i++;
    } else if (/^#{1,4}\s/.test(line)) {
      out.push(`<h4>${inline(line.replace(/^#+\s+/, ""))}</h4>`);
      i++;
    } else if (LIST_ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && (LIST_ITEM.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (LIST_ITEM.test(lines[i])) items.push(lines[i].replace(LIST_ITEM, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
    } else {
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^```|^#{1,4}\s/.test(lines[i]) && !LIST_ITEM.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${buf.map(inline).join("<br>")}</p>`);
    }
  }
  return out.join("");
}

// ---------- messages ----------
function addUser(text) {
  const el = html(`<div class="msg user"><div class="bubble"></div></div>`);
  el.firstChild.textContent = text;
  els.messages.append(el);
  return el;
}

function addBot() {
  const el = html(`
    <article class="msg bot" aria-label="Arachne’s answer">
      <svg class="bot-mark" aria-hidden="true"><use href="/static/icons.svg#logo"/></svg>
      <div class="card">
        <div class="md"><p class="thinking"><span class="web-spinner" aria-hidden="true"></span>Searching company documents…</p></div>
        <div class="sources" hidden></div>
        <div class="sense" hidden></div>
        <div class="actions" hidden>
          <button type="button" class="icon-btn copy" aria-label="Copy Answer" title="Copy Answer">${icon("copy")}</button>
          <button type="button" class="icon-btn vote" data-value="1" aria-pressed="false" aria-label="Helpful" title="Helpful">${icon("thumb-up")}</button>
          <button type="button" class="icon-btn vote" data-value="-1" aria-pressed="false" aria-label="Not Helpful" title="Not Helpful">${icon("thumb-down")}</button>
        </div>
      </div>
    </article>`);
  els.messages.append(el);
  return el;
}

function fillBot(el, text, { streaming = false } = {}) {
  const md = el.querySelector(".md");
  if (!text && streaming) return;
  citeLabels = citeOrder(text);
  md.innerHTML = markdown(text);
  el.dataset.text = text;
  if (streaming) {
    const last = md.lastElementChild;
    (last?.lastElementChild?.tagName === "LI" ? last.lastElementChild : last)?.classList.add("caret");
  }
}

function finishBot(el, { text, sources = [], related = [], id = null, feedback = null }) {
  fillBot(el, text || "No answer came back. Try asking again.");
  if (id) el.dataset.id = id;
  const order = citeOrder(text || "");
  const shown = sources.filter((s) => order.has(s.n)).sort((a, b) => order.get(a.n) - order.get(b.n));

  const box = el.querySelector(".sources");
  box.innerHTML = shown.length ? `<p class="sources-label">Sources</p>` : "";
  for (const s of shown) {
    const item = html(`
      <div class="source" data-n="${s.n}">
        <button type="button" class="source-row" aria-expanded="false">
          <span class="cite" aria-hidden="true">${order.get(s.n)}</span><span class="source-name"></span>${icon("chev", "chev")}
        </button>
        <blockquote class="excerpt" hidden></blockquote>
      </div>`);
    item.querySelector(".source-name").textContent = `${s.title} · ${s.locator}`;
    item.querySelector(".excerpt").textContent = s.excerpt.replace(/^#+\s*/gm, "");
    box.append(item);
  }
  box.hidden = !shown.length;
  el.classList.toggle("no-sources", !shown.length);

  const sense = el.querySelector(".sense");
  sense.hidden = !related.length;
  if (related.length) {
    sense.innerHTML = `<p class="sense-label">${icon("spark")}Spider-Sense<span>Nearby threads you might need next</span></p><div class="sense-chips"></div>`;
    for (const r of related) {
      const chip = html(`<button type="button" class="chip"><span class="chip-loc"></span><span class="chip-text"></span><span class="chip-doc"></span></button>`);
      chip.dataset.q = r.question;
      chip.querySelector(".chip-loc").textContent = r.locator;
      chip.querySelector(".chip-text").textContent = r.heading.replace(/^\d+(\.\d+)*\s+/, "");
      chip.querySelector(".chip-doc").textContent = r.title;
      chip.setAttribute("aria-label", `Ask: ${r.question}`);
      sense.lastElementChild.append(chip);
    }
  }

  const actions = el.querySelector(".actions");
  actions.hidden = false;
  actions.querySelectorAll(".vote").forEach((b) => {
    b.hidden = !id;
    b.setAttribute("aria-pressed", String(Number(b.dataset.value) === feedback));
  });
  return shown.length;
}

function openSource(card, n, flash) {
  const src = card.querySelector(`.source[data-n="${n}"]`);
  if (!src) return;
  const ex = src.querySelector(".excerpt");
  const open = flash ? true : ex.hidden;
  ex.hidden = !open;
  src.classList.toggle("open", open);
  src.querySelector(".source-row").setAttribute("aria-expanded", String(open));
  if (flash) {
    src.classList.remove("flash");
    void src.offsetWidth;
    src.classList.add("flash");
    src.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

async function vote(btn) {
  const msg = btn.closest(".msg");
  const id = msg.dataset.id;
  if (!id) return;
  const value = Number(btn.dataset.value);
  const buttons = [...msg.querySelectorAll(".vote")];
  const before = buttons.map((b) => b.getAttribute("aria-pressed"));
  const next = btn.getAttribute("aria-pressed") === "true" ? 0 : value;
  buttons.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.value) === next)));
  try {
    await apiJSON(`/messages/${id}/feedback`, { method: "POST", body: JSON.stringify({ value: next }) });
    if (next === -1) toast("Marked as not helpful. It now shows under Holes in Your Web.");
    else if (next === 1) announce("Marked as helpful");
  } catch {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", before[i]));
    toast("Feedback didn’t save. Try again.");
  }
}

els.messages.addEventListener("click", async (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  const cite = e.target.closest(".md .cite");
  if (cite) return openSource(card, cite.dataset.n, true);
  const row = e.target.closest(".source-row");
  if (row) return openSource(card, row.parentElement.dataset.n, false);
  const chip = e.target.closest(".chip");
  if (chip) return ask(chip.dataset.q);
  const voteBtn = e.target.closest(".vote");
  if (voteBtn) return vote(voteBtn);
  const copy = e.target.closest(".copy");
  if (copy) {
    const text = card.closest(".msg").dataset.text || "";
    await navigator.clipboard.writeText(text.replace(/\s?\[(\d+(?:\s*,\s*\d+)*)\]/g, ""));
    copy.innerHTML = icon("check");
    announce("Answer copied");
    setTimeout(() => (copy.innerHTML = icon("copy")), 1500);
  }
});

// ---------- chats ----------
function setEmpty(empty) {
  els.main.classList.toggle("is-empty", empty);
  els.welcome.hidden = !empty;
  els.exportBtn.hidden = empty;
}

function setTitle(title) {
  els.title.textContent = title || "New Chat";
  els.title.classList.toggle("visually-hidden", !title);
  document.title = title ? `${title} · Arachne` : "New Chat · Arachne";
}

function renderChatList() {
  els.chatList.innerHTML = "";
  if (!state.chats.length) {
    els.chatList.innerHTML = `<p class="empty-list">Your chats will appear here.</p>`;
    return;
  }
  for (const c of state.chats) {
    const a = html(`<a class="chat-item" href="/c/${c.id}"><span></span>
      <button type="button" class="icon-btn del" aria-label="Delete Chat" title="Delete Chat">${icon("trash")}</button></a>`);
    a.querySelector("span").textContent = c.title;
    if (c.id === state.chatId) a.setAttribute("aria-current", "page");
    a.addEventListener("click", (e) => {
      if (e.target.closest(".del")) {
        e.preventDefault();
        return deleteChat(c);
      }
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // let the browser open a tab
      e.preventDefault();
      openChat(c.id, true);
    });
    els.chatList.append(a);
  }
}

async function loadChats() {
  state.chats = await apiJSON("/chats");
  renderChatList();
}

function closeMobileSidebar() {
  els.app.classList.remove("open");
}

function newChat(push = true) {
  if (state.busy) stop();
  state.chatId = null;
  els.messages.innerHTML = "";
  setTitle("");
  setEmpty(true);
  renderChatList();
  if (push && location.pathname !== "/") history.pushState({}, "", "/");
  closeMobileSidebar();
  if (!mobile.matches) els.input.focus();
}

async function openChat(id, push) {
  if (state.busy) stop();
  const res = await api(`/chats/${id}`);
  if (!res.ok) {
    toast("That chat doesn’t exist anymore. Starting a new one.");
    return newChat();
  }
  const chat = await res.json();
  state.chatId = chat.id;
  els.messages.innerHTML = "";
  setEmpty(false);
  setTitle(chat.title);
  for (const m of chat.messages) {
    if (m.role === "user") addUser(m.content);
    else finishBot(addBot(), { text: m.content, sources: m.sources, related: m.related, id: m.id, feedback: m.feedback });
  }
  renderChatList();
  if (push) history.pushState({}, "", `/c/${chat.id}`);
  closeMobileSidebar();
  toBottom(true);
}

async function deleteChat(c) {
  const index = state.chats.indexOf(c);
  state.chats.splice(index, 1);
  if (c.id === state.chatId) newChat();
  else renderChatList();
  try {
    await apiJSON(`/chats/${c.id}`, { method: "DELETE" });
  } catch {
    state.chats.splice(index, 0, c);
    renderChatList();
    toast("That chat didn’t delete. Try again.");
    return;
  }
  toast(`Deleted “${c.title}”`, {
    action: "Undo",
    duration: 6000,
    onAction: async () => {
      await apiJSON(`/chats/${c.id}/restore`, { method: "POST" });
      state.chats.splice(Math.min(index, state.chats.length), 0, c);
      renderChatList();
      announce("Chat restored");
    },
  });
}

async function exportChat() {
  if (!state.chatId) return;
  const chat = await apiJSON(`/chats/${state.chatId}`);
  const date = new Intl.DateTimeFormat(navigator.language, { dateStyle: "long" }).format(new Date());
  const lines = [`# ${chat.title}`, "", `_Exported from Arachne on ${date}_`, ""];
  for (const m of chat.messages) {
    if (m.role === "user") {
      lines.push(`**You:** ${m.content}`, "");
      continue;
    }
    const order = citeOrder(m.content);
    const text = m.content.replace(CITE_RE, (_, list) => list.split(/\s*,\s*/).map((n) => `[${order.get(Number(n)) ?? n}]`).join(""));
    lines.push(`**Arachne:** ${text}`, "");
    const used = m.sources.filter((s) => order.has(s.n)).sort((a, b) => order.get(a.n) - order.get(b.n));
    if (used.length) lines.push("Sources:", ...used.map((s) => `${order.get(s.n)}. ${s.title} · ${s.locator}`), "");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: `${chat.title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "arachne-chat"}.md`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Chat exported as Markdown");
}

// ---------- asking ----------
function setBusy(busy) {
  state.busy = busy;
  els.composer.classList.toggle("busy", busy);
  els.send.setAttribute("aria-label", busy ? "Stop Answering" : "Send Question");
  els.send.title = busy ? "Stop Answering" : "Send Question";
}

function stop() {
  state.controller?.abort();
}

function adoptChat(id, text) {
  if (!id || state.chatId === id) return;
  state.chatId = id;
  const title = text.length > 60 ? text.slice(0, 59).trimEnd() + "…" : text;
  state.chats.unshift({ id, title });
  setTitle(title);
  history.pushState({}, "", `/c/${id}`);
  renderChatList();
}

async function ask(text) {
  text = text.trim();
  if (!text || state.busy) return;
  setEmpty(false);
  addUser(text);
  const bot = addBot();
  toBottom(true);
  els.input.value = "";
  autosize();
  setBusy(true);
  ambient?.tremor(true);
  announce("Arachne is searching company documents…");

  state.controller = new AbortController();
  let answer = "";
  let payload = {};
  try {
    const res = await api("/ask", {
      method: "POST",
      body: JSON.stringify({ text, chat_id: state.chatId }),
      signal: state.controller.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(typeof err.detail === "string" ? err.detail : `Request failed (${res.status})`);
    }
    if ((res.headers.get("content-type") || "").includes("application/json")) {
      const data = await res.json(); // no matching documents
      adoptChat(data.chat_id, text);
      answer = data.message;
      payload = { message_id: data.message_id };
    } else {
      adoptChat(res.headers.get("X-Chat-Id"), text);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let frame = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        answer = buf.split(CITE_MARKER)[0];
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            fillBot(bot, answer, { streaming: true });
            toBottom();
          });
        }
      }
      cancelAnimationFrame(frame);
      const [body, tail] = buf.split(CITE_MARKER);
      answer = body;
      if (tail) payload = JSON.parse(tail);
    }
  } catch (err) {
    if (err.name !== "AbortError") answer = answer || `Something went wrong: ${err.message} Try asking again.`;
  } finally {
    const cited = finishBot(bot, {
      text: answer, sources: payload.sources || [], related: payload.related || [], id: payload.message_id,
    });
    announce(cited ? `Answer ready, with ${cited} source${cited === 1 ? "" : "s"}` : "Answer ready");
    ambient?.tremor(false);
    setBusy(false);
    state.controller = null;
    toBottom();
    const i = state.chats.findIndex((c) => c.id === state.chatId);
    if (i > 0) state.chats.unshift(...state.chats.splice(i, 1));
    renderChatList();
    refreshRank();
  }
}

// ---------- rank (how far your web has grown) ----------
function showRank(rank) {
  $("#rankLabel").textContent = rank.name;
  $("#hudRank").textContent = rank.name;
}

async function refreshRank() {
  try {
    const me = await apiJSON("/me");
    if (state.rank && me.rank.level > state.rank.level) {
      toast(`Your web grew: you’re now a ${me.rank.name}`, {
        action: "View Your Web", duration: 7000, onAction: () => (location.href = "/web"),
      });
    }
    state.rank = me.rank;
    showRank(me.rank);
  } catch {}
}

// ---------- composer ----------
function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 220) + "px";
}

els.input.addEventListener("input", autosize);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing && (!e.shiftKey || mod(e))) {
    e.preventDefault();
    ask(els.input.value);
  }
});
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  if (state.busy) return stop();
  if (!els.input.value.trim()) {
    els.input.focus();
    announce("Type a question first");
    return;
  }
  ask(els.input.value);
});
$$(".suggestion").forEach((b) => b.addEventListener("click", () => ask(b.dataset.q)));

// ---------- chrome ----------
$("#newChat").addEventListener("click", () => newChat());
$("#newChatTop").addEventListener("click", () => newChat());
$("[data-brand]").addEventListener("click", (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  newChat();
});
$("#collapse").addEventListener("click", () => {
  if (mobile.matches) closeMobileSidebar();
  else els.app.classList.add("collapsed");
});
$("#expand").addEventListener("click", () => {
  if (mobile.matches) els.app.classList.add("open");
  else els.app.classList.remove("collapsed");
});
$("#scrim").addEventListener("click", closeMobileSidebar);
els.exportBtn.addEventListener("click", exportChat);
$("#openSettings").addEventListener("click", () => settings.open());
$("#openSearch").addEventListener("click", () => palette.open());

$("#accountBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const open = els.menu.hidden;
  els.menu.hidden = !open;
  $("#accountBtn").setAttribute("aria-expanded", String(open));
  if (open) els.menu.querySelector("[role=menuitem]").focus();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#menu")) {
    els.menu.hidden = true;
    $("#accountBtn").setAttribute("aria-expanded", "false");
  }
});
els.menu.addEventListener("keydown", (e) => {
  const items = [...els.menu.querySelectorAll("[role=menuitem]")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "Escape") {
    els.menu.hidden = true;
    $("#accountBtn").focus();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  }
});
$("#menuSettings").addEventListener("click", () => {
  els.menu.hidden = true;
  settings.open();
});
$("#logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  location.href = "/login";
});

document.addEventListener("keydown", (e) => {
  if ($("#settings").open) return;
  if (mod(e) && !e.shiftKey && e.key.toLowerCase() === "k") {
    e.preventDefault();
    palette.open();
  } else if (mod(e) && e.shiftKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    newChat();
  } else if (e.key === "Escape" && state.busy && !$("#palette").open) {
    stop();
  }
});

window.addEventListener("popstate", route);

function route() {
  const m = location.pathname.match(/^\/c\/([\w-]+)/);
  if (m) openChat(m[1], false);
  else newChat(false);
}

function greet(name) {
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  return `Good ${part}, ${name.split(" ")[0]}`;
}

function commands() {
  const cmds = [
    { label: "New Chat", icon: "plus", hint: "", keywords: "start fresh", run: () => newChat() },
    { label: "Open Your Web", icon: "web", keywords: "constellation stats rank learned", run: () => (location.href = "/web") },
    { label: "Settings…", icon: "settings", keywords: "preferences", run: () => settings.open() },
    { label: "Change Colour Scheme…", icon: "palette", keywords: "theme appearance colour color", run: () => settings.open("appearance") },
  ];
  for (const [key, p] of Object.entries(PRESETS)) {
    cmds.push({ label: `Theme: ${p.label}`, icon: "palette", keywords: "theme colour color", run: () => updatePrefs({ theme: key }) });
  }
  if (state.chatId) cmds.push({ label: "Export Chat as Markdown", icon: "download", keywords: "download save", run: exportChat });
  cmds.push({ label: "Sign Out", icon: "logout", keywords: "log out", run: () => $("#logout").click() });
  return cmds;
}

(async function init() {
  fillShortcuts();
  brandMenu($("[data-brand]"));
  try {
    ambient = mountAmbientWeb($("#ambient"));
  } catch {
    $("#ambient").hidden = true; // no WebGL: the plain background still works
  }

  const me = await apiJSON("/me");
  state.user = me;
  state.rank = me.rank;
  setPrefs(me.prefs);
  $("#userName").textContent = me.name;
  $("#userTeam").textContent = `${me.team} team`;
  $("#menuEmail").textContent = me.email;
  $("#avatar").textContent = me.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  els.greeting.textContent = greet(me.name);
  $("#hudDocs").textContent = fmt(me.kb.documents);
  $("#hudPassages").textContent = fmt(me.kb.passages);
  $("#hudTeam").textContent = me.team;
  showRank(me.rank);

  settings = initSettings();
  palette = initPalette({
    commands,
    chats: () => state.chats.map((c) => ({ ...c, open: () => openChat(c.id, true) })),
    ask: (q) => {
      newChat();
      ask(q);
    },
  });

  await loadChats();
  route();

  const params = new URLSearchParams(location.search);
  if (params.get("ask")) {
    els.input.value = params.get("ask");
    autosize();
    els.input.focus();
    params.delete("ask");
    history.replaceState({}, "", location.pathname + (params.size ? `?${params}` : ""));
  }
  if (params.has("settings")) settings.open(params.get("settings"));
  document.body.classList.add("ready");
})();

