// "Your Web" page: the constellation plus what Arachne has learned about how you use it.
import { mountConstellation } from "./constellation.js";
import { getPrefs, setPrefs, updatePrefs } from "./prefs.js";
import { motionReduced } from "./theme.js";
import { $, announce, apiJSON, compact, esc, fmt, fmtDate, html } from "./ui.js";

const tip = $("#tip");
let tipTimer;
let tipHiddenAt = 0;

function showTip(hit, x, y) {
  clearTimeout(tipTimer);
  if (!hit) {
    if (!tip.hidden) tipHiddenAt = performance.now();
    tip.hidden = true;
    return;
  }
  let key = "";
  let body = "";
  let meta = "";
  if (hit.type === "chat") {
    key = "Chat";
    body = hit.chat.title;
    meta = `${fmtDate(hit.chat.created_at)} · ${hit.chat.cited.length} sections cited · Click to open`;
  } else if (hit.type === "section") {
    key = `${hit.doc.title} · ${hit.section.locator}`;
    body = hit.section.heading.replace(/^\d+(\.\d+)*\s+/, "");
    meta = hit.section.visits ? `Cited ${fmt(hit.section.visits)}× · Click to ask about it` : "Not explored yet · Click to ask about it";
  } else {
    key = "Document";
    body = hit.doc.title;
    const lit = hit.doc.sections.filter((s) => s.visits).length;
    meta = `${lit} of ${hit.doc.sections.length} sections explored`;
  }
  tip.innerHTML = `<span class="tip-key">${esc(key)}</span>${esc(body)}<span class="tip-meta">${esc(meta)}</span>`;
  const place = () => {
    tip.style.left = `${Math.min(x + 14, innerWidth - 300)}px`;
    tip.style.top = `${Math.min(y + 14, innerHeight - 90)}px`;
    tip.hidden = false;
  };
  // first tooltip waits a beat; moving between nodes shows the next one straight away
  if (!tip.hidden || performance.now() - tipHiddenAt < 400) place();
  else tipTimer = setTimeout(place, 280);
}

function askUrl(q) {
  return `/?ask=${encodeURIComponent(q)}`;
}

function select(hit, e) {
  let url = null;
  if (hit.type === "chat") url = `/c/${hit.chat.id}`;
  else if (hit.type === "section") {
    const topic = hit.section.heading.replace(/^\d+(\.\d+)*\s+/, "");
    url = askUrl(`What does the ${hit.doc.title} say about ${topic[0].toLowerCase() + topic.slice(1)}?`);
  }
  if (!url) return;
  if (e?.metaKey || e?.ctrlKey) window.open(url, "_blank");
  else location.href = url;
}

// ---------- panel ----------
function renderRank(rank) {
  $("#rankLevel").innerHTML = `LV&nbsp;${rank.level}`;
  $("#rankTitle").textContent = rank.name;
  const p = $("#rankProgress");
  if (rank.next_at) {
    p.max = rank.next_at - rank.floor;
    p.value = rank.questions - rank.floor;
    const left = rank.next_at - rank.questions;
    $("#rankNext").textContent = `${fmt(left)} more question${left === 1 ? "" : "s"} to become a ${rank.next_name}.`;
  } else {
    p.max = 1;
    p.value = 1;
    $("#rankNext").textContent = "Highest rank reached. Your web is complete.";
  }
}

function renderStats(s) {
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const tiles = [
    ["Questions Asked", fmt(s.questions)],
    ["Chats", fmt(s.chats)],
    ["Grounded Answers", `${pct(s.grounded, s.answers)}%`, s.answers ? `of ${fmt(s.answers)}` : ""],
    ["Day Streak", fmt(s.streak), s.streak === 1 ? "day" : "days"],
    ["Documents Explored", `${fmt(s.documents_explored)}`, `/ ${fmt(s.documents_total)}`],
    ["Sections Explored", `${fmt(s.sections_explored)}`, `/ ${fmt(s.sections_total)}`],
    ["Helpful Votes", fmt(s.helpful), s.unhelpful ? `${fmt(s.unhelpful)} not` : ""],
    ["Tokens Spun", compact(s.tokens_in + s.tokens_out)],
  ];
  $("#stats").innerHTML = tiles
    .map(([k, v, small]) => `<div class="stat"><dt>${k}</dt><dd>${esc(v)}${small ? `<small>${esc(small)}</small>` : ""}</dd></div>`)
    .join("");
}

function renderHours(activity) {
  const hours = new Array(24).fill(0);
  for (const t of activity) hours[new Date(t).getHours()]++;
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  $("#hoursChart").innerHTML = hours
    .map((n, h) => {
      const height = Math.max(2, (n / max) * 60);
      const cls = n ? (h === peak ? "peak" : "on") : "";
      return `<rect class="${cls}" x="${h * 10 + 1}" y="${64 - height}" width="8" height="${height}" rx="2"/>`;
    })
    .join("");
  if (!activity.length) {
    $("#hoursCaption").textContent = "Your rhythm appears once you’ve asked a few questions.";
    return;
  }
  const at = new Date();
  at.setHours(peak, 0, 0, 0);
  const label = new Intl.DateTimeFormat(navigator.language, { hour: "numeric", minute: "2-digit" }).format(at);
  $("#hoursCaption").textContent = `You ask most around ${label}, in your local time.`;
}

function renderLearned(profile) {
  $("#topics").innerHTML = profile.topics.length
    ? profile.topics.map((t) => `<li>${esc(t.title)}<span>×${fmt(t.count)}</span></li>`).join("")
    : `<li class="none">Nothing yet. Topics appear as Arachne cites documents for you.</li>`;
  const tailor = getPrefs().tailor;
  $("#tailor").checked = tailor;
  $("#styleName").textContent = getPrefs().style[0].toUpperCase() + getPrefs().style.slice(1);
  const ctx = $("#context");
  ctx.textContent = tailor ? profile.context : "Nothing. Tailoring is off, so Arachne sends only your question & the matching sources.";
  ctx.classList.toggle("off", !tailor);
}

function renderGaps(gaps) {
  const list = $("#gapList");
  if (!gaps.length) {
    list.innerHTML = `<li class="empty-note" style="border:0;background:none;padding:0">No holes yet. Every question so far found a source.</li>`;
    return;
  }
  list.innerHTML = "";
  for (const g of gaps) {
    const li = html(`
      <li>
        <p class="gap-q"></p>
        <div class="gap-meta">
          <span class="badge ${g.reason === "No Sources" ? "warn" : "danger"}">${esc(g.reason)}</span>
          <span>${esc(fmtDate(g.at))}</span>
          <a href="${askUrl(g.question)}">Ask Again</a>
        </div>
      </li>`);
    li.querySelector(".gap-q").textContent = `“${g.question}”`;
    list.append(li);
  }
}

function renderThreads(chats, scene) {
  const list = $("#threadList");
  if (!chats.length) {
    list.innerHTML = `<li class="empty-note">No chats yet. <a href="/">Start one</a>.</li>`;
    return;
  }
  list.innerHTML = "";
  for (const c of [...chats].reverse()) {
    const li = html(`<li><a href="/c/${c.id}"><span class="dew" aria-hidden="true"></span><span class="t-title"></span><span class="t-meta"></span></a></li>`);
    li.querySelector(".t-title").textContent = c.title;
    li.querySelector(".t-meta").textContent = `${fmtDate(c.created_at)} · ${c.cited.length} cited`;
    const a = li.firstChild;
    const on = () => scene?.highlightChat(c.id);
    const off = () => scene?.highlightChat(null);
    a.addEventListener("pointerenter", on);
    a.addEventListener("pointerleave", off);
    a.addEventListener("focus", on);
    a.addEventListener("blur", off);
    list.append(li);
  }
}

function renderEngine(engine, stats) {
  const perAnswer = stats.answers ? Math.round(stats.tokens_out / stats.answers) : 0;
  const rows = [
    ["Model", engine.model],
    ["Effort", engine.effort],
    ["Passages per question", fmt(engine.top_k)],
    ["Avg. output per answer", perAnswer ? `${fmt(perAnswer)} tokens` : "–"],
    ["Input tokens", fmt(stats.tokens_in)],
    ["Output tokens", fmt(stats.tokens_out)],
  ];
  $("#engine").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd translate="no">${esc(v)}</dd>`).join("");
}

// ---------- boot ----------
(async function init() {
  const [me, data] = await Promise.all([apiJSON("/me"), apiJSON("/web/data")]);
  setPrefs(me.prefs);
  document.title = `Your Web · ${data.rank.name} · Arachne`;

  let scene = null;
  try {
    scene = mountConstellation($("#constellation"), data, {
      labels: $("#labels"), onHover: showTip, onSelect: select,
      avoid: [$(".stage-head h1"), $(".stage-sub"), $(".back"), $(".legend"), $(".stage-controls")],
    });
  } catch {
    $("#constellation").hidden = true;
  }

  renderRank(data.rank);
  renderStats(data.stats);
  renderHours(data.activity);
  renderLearned(data.profile);
  renderGaps(data.gaps);
  renderThreads(data.chats, scene);
  renderEngine(data.engine, data.stats);
  $("#emptyState").hidden = data.stats.questions > 0;

  const playPause = $("#playPause");
  const syncPlay = () => {
    const playing = scene?.playing;
    playPause.setAttribute("aria-pressed", String(!playing));
    const label = playing ? "Pause Motion" : "Play Motion";
    playPause.setAttribute("aria-label", label);
    playPause.title = label;
  };
  playPause.addEventListener("click", () => {
    if (motionReduced()) {
      announce("Motion is reduced. Turn it on in Settings to animate the web.");
      return;
    }
    scene?.setPlaying(!scene.playing);
    syncPlay();
  });
  $("#replay").addEventListener("click", () => scene?.replay());
  $("#resetView").addEventListener("click", () => scene?.resetView());
  window.addEventListener("arachne:prefs", () => {
    scene?.setPlaying(!motionReduced() && scene.playing);
    syncPlay();
  });
  syncPlay();

  $("#tailor").addEventListener("change", async (e) => {
    await updatePrefs({ tailor: e.target.checked });
    renderLearned(data.profile);
    announce(e.target.checked ? "Tailoring on" : "Tailoring off");
  });

  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
})();
