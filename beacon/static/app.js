// Beacon chat client: sidebar of chats, streamed grounded answers with citations.
const $ = (sel) => document.querySelector(sel);
const CITE_MARKER = "\x1e";
const CITE_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

const els = {
  app: $("#app"), main: $("#main"), scroll: $("#scroll"), messages: $("#messages"),
  welcome: $("#welcome"), greeting: $("#greeting"), chatList: $("#chatList"),
  composer: $("#composer"), input: $("#input"), send: $("#send"),
  title: $("#chatTitle"),
  menu: $("#menu"), toast: $("#toast"),
};

const state = { user: null, chatId: null, chats: [], busy: false, controller: null };
const mobile = window.matchMedia("(max-width: 820px)");

// ---------- helpers ----------
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function html(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

function icon(name, cls = "icon") {
  return `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("Not signed in");
  }
  return res;
}

let toastTimer;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 2400);
}

function nearBottom() {
  const s = els.scroll;
  return s.scrollHeight - s.scrollTop - s.clientHeight < 120;
}

function toBottom(force = false) {
  if (force || nearBottom()) els.scroll.scrollTop = els.scroll.scrollHeight;
}

// ---------- citations ----------
// Claude cites sources by their retrieval number ([1], [7]); readers see them renumbered
// in order of first appearance (1, 2, …), while data-n keeps the original for lookup.
let citeLabels = new Map();

function citeOrder(text) {
  const order = new Map();
  for (const m of text.matchAll(CITE_RE)) {
    for (const n of m[1].split(/\s*,\s*/).map(Number)) if (!order.has(n)) order.set(n, order.size + 1);
  }
  return order;
}

function citeButton(n) {
  return `<button type="button" class="cite" data-n="${n}">${citeLabels.get(Number(n)) ?? n}</button>`;
}

// ---------- markdown (escaped first, then a small safe subset) ----------
const CITE_RUN = /((?:\[\d+(?:\s*,\s*\d+)*\])+)([.,;:!?)]?)/g;

function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(CITE_RUN, (_, cites, punct) => {
      const nums = [...cites.matchAll(/\d+/g)].map((m) => m[0]);
      return `<span class="nowrap">${nums.map(citeButton).join("")}${punct}</span>`;
    });
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/;

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
      while (i < lines.length && lines[i].trim() && !/^```|^#{1,4}\s/.test(lines[i]) && !LIST_ITEM.test(lines[i])) {
        buf.push(lines[i++]);
      }
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
    <div class="msg bot">
      <img class="bot-mark" src="/static/logo.svg" alt="">
      <div class="card">
        <div class="md"><div class="thinking"><span class="dots"><i></i><i></i><i></i></span>Searching company documents…</div></div>
        <div class="sources" hidden></div>
        <div class="actions" hidden>
          <button class="icon-btn copy" title="Copy" aria-label="Copy answer">${icon("copy")}</button>
        </div>
      </div>
    </div>`);
  els.messages.append(el);
  return el;
}

function fillBot(el, text, { streaming = false } = {}) {
  const md = el.querySelector(".md");
  if (!text && streaming) return;
  citeLabels = citeOrder(text);
  md.innerHTML = markdown(text);
  el.dataset.text = text;
  if (streaming) (md.lastElementChild?.lastElementChild?.tagName === "LI" ? md.lastElementChild.lastElementChild : md.lastElementChild)?.classList.add("caret");
}

function finishBot(el, text, sources) {
  fillBot(el, text || "_No answer was returned._");
  const order = citeOrder(text || "");
  const shown = (sources || []).filter((s) => order.has(s.n)).sort((a, b) => order.get(a.n) - order.get(b.n));
  const box = el.querySelector(".sources");
  box.innerHTML = "";
  for (const s of shown) {
    const item = html(`
      <div class="source" data-n="${s.n}">
        <button type="button" class="source-row">
          <span class="cite">${order.get(s.n)}</span><span class="source-name"></span>${icon("chev", "chev")}
        </button>
        <div class="excerpt" hidden></div>
      </div>`);
    item.querySelector(".source-name").textContent = `${s.title} · ${s.locator}`;
    item.querySelector(".excerpt").textContent = s.excerpt.replace(/^#+\s*/gm, "");
    box.append(item);
  }
  box.hidden = shown.length === 0;
  el.classList.toggle("no-sources", shown.length === 0);
  el.querySelector(".actions").hidden = false;
  return shown.length;
}

function openSource(card, n, flash) {
  const src = card.querySelector(`.source[data-n="${n}"]`);
  if (!src) return;
  const ex = src.querySelector(".excerpt");
  const open = flash ? true : ex.hidden;
  ex.hidden = !open;
  src.classList.toggle("open", open);
  if (flash) {
    src.classList.remove("flash");
    void src.offsetWidth;
    src.classList.add("flash");
    src.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

els.messages.addEventListener("click", async (e) => {
  const card = e.target.closest(".card");
  if (!card) return;
  const cite = e.target.closest(".md .cite");
  if (cite) return openSource(card, cite.dataset.n, true);
  const row = e.target.closest(".source-row");
  if (row) return openSource(card, row.parentElement.dataset.n, false);
  const copy = e.target.closest(".copy");
  if (copy) {
    const text = card.closest(".msg").dataset.text || "";
    await navigator.clipboard.writeText(text.replace(/\s?\[(\d+(?:\s*,\s*\d+)*)\]/g, ""));
    copy.innerHTML = icon("check");
    setTimeout(() => (copy.innerHTML = icon("copy")), 1500);
  }
});

// ---------- chats ----------
function setEmpty(empty) {
  els.main.classList.toggle("is-empty", empty);
  els.welcome.hidden = !empty;
}

function renderChatList() {
  els.chatList.innerHTML = "";
  if (!state.chats.length) {
    els.chatList.innerHTML = `<div class="empty-list">No chats yet</div>`;
    return;
  }
  for (const c of state.chats) {
    const a = html(`<a class="chat-item" href="/c/${c.id}"><span></span>
      <button class="icon-btn del" title="Delete chat" aria-label="Delete chat">${icon("trash")}</button></a>`);
    a.querySelector("span").textContent = c.title;
    a.classList.toggle("active", c.id === state.chatId);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      if (e.target.closest(".del")) return deleteChat(c);
      openChat(c.id, true);
    });
    els.chatList.append(a);
  }
}

async function loadChats() {
  const res = await api("/chats");
  state.chats = await res.json();
  renderChatList();
}

function closeMobileSidebar() {
  els.app.classList.remove("open");
}

function newChat(push = true) {
  if (state.busy) stop();
  state.chatId = null;
  els.messages.innerHTML = "";
  els.title.textContent = "";
  document.title = "Beacon";
  setEmpty(true);
  renderChatList();
  if (push && location.pathname !== "/") history.pushState({}, "", "/");
  closeMobileSidebar();
  els.input.focus();
}

async function openChat(id, push) {
  if (state.busy) stop();
  const res = await api(`/chats/${id}`);
  if (!res.ok) {
    toast("That chat couldn't be found");
    return newChat();
  }
  const chat = await res.json();
  state.chatId = chat.id;
  els.messages.innerHTML = "";
  setEmpty(false);
  els.title.textContent = chat.title;
  document.title = `${chat.title} · Beacon`;
  for (const m of chat.messages) {
    if (m.role === "user") addUser(m.content);
    else finishBot(addBot(), m.content, m.sources);
  }
  renderChatList();
  if (push) history.pushState({}, "", `/c/${chat.id}`);
  closeMobileSidebar();
  toBottom(true);
}

async function deleteChat(c) {
  if (!confirm(`Delete “${c.title}”?`)) return;
  await api(`/chats/${c.id}`, { method: "DELETE" });
  state.chats = state.chats.filter((x) => x.id !== c.id);
  if (c.id === state.chatId) newChat();
  else renderChatList();
}

// ---------- asking ----------
function setBusy(busy) {
  state.busy = busy;
  els.composer.classList.toggle("busy", busy);
  els.send.setAttribute("aria-label", busy ? "Stop" : "Send");
  updateSend();
}

function updateSend() {
  els.send.disabled = !state.busy && !els.input.value.trim();
}

function stop() {
  state.controller?.abort();
}

function adoptChat(id, text) {
  if (!id || state.chatId === id) return;
  state.chatId = id;
  const title = text.length > 60 ? text.slice(0, 57) + "…" : text;
  state.chats.unshift({ id, title });
  els.title.textContent = title;
  document.title = `${title} · Beacon`;
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

  state.controller = new AbortController();
  let answer = "";
  let sources = [];
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
        if (!frame) frame = requestAnimationFrame(() => {
          frame = 0;
          fillBot(bot, answer, { streaming: true });
          toBottom();
        });
      }
      cancelAnimationFrame(frame);
      const [body, tail] = buf.split(CITE_MARKER);
      answer = body;
      if (tail) sources = JSON.parse(tail).sources;
    }
  } catch (err) {
    if (err.name !== "AbortError") answer = answer || `Something went wrong: ${err.message}`;
  } finally {
    finishBot(bot, answer, sources);
    setBusy(false);
    state.controller = null;
    toBottom();
    // move this chat to the top of Recents
    const i = state.chats.findIndex((c) => c.id === state.chatId);
    if (i > 0) state.chats.unshift(...state.chats.splice(i, 1));
    renderChatList();
  }
}

// ---------- composer ----------
function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 220) + "px";
  updateSend();
}

els.input.addEventListener("input", autosize);
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    ask(els.input.value);
  }
});
els.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  state.busy ? stop() : ask(els.input.value);
});
document.querySelectorAll(".suggestion").forEach((b) =>
  b.addEventListener("click", () => ask(b.lastChild.textContent))
);

// ---------- chrome ----------
$("#newChat").addEventListener("click", () => newChat());
$("#newChatTop").addEventListener("click", () => newChat());
document.querySelector("[data-nav]").addEventListener("click", (e) => {
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

$("#accountBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  els.menu.hidden = !els.menu.hidden;
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".menu")) els.menu.hidden = true;
});
$("#logout").addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  location.href = "/login";
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    newChat();
  } else if (e.key === "Escape" && state.busy) {
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

(async function init() {
  const me = await (await api("/me")).json();
  state.user = me;
  $("#userName").textContent = me.name;
  $("#userTeam").textContent = `${me.team} team`;
  $("#menuEmail").textContent = me.email;
  $("#avatar").textContent = me.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  els.greeting.textContent = greet(me.name);
  await loadChats();
  route();
})();
