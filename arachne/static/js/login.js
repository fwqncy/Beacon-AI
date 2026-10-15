// Sign in / create account, beside the knowledge orb.
import { motionReduced } from "./theme.js";
import { mountOrb } from "./threads.js";
import { $, $$ } from "./ui.js";

const form = $("#form");
const submit = $("#submit");
const submitLabel = $("#submitLabel");
const formError = $("#formError");
let mode = "login";

const COPY = {
  login: { title: "Sign In to Arachne", sub: "Pick up the thread where you left it.", submit: "Sign In" },
  signup: { title: "Create Your Account", sub: "Your web starts with your first question.", submit: "Create Account" },
};

function setMode(next) {
  mode = next;
  $$(".mode").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $$("[data-signup]").forEach((el) => (el.hidden = mode !== "signup"));
  $("#password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("#formTitle").textContent = COPY[mode].title;
  $("#formSub").textContent = COPY[mode].sub;
  submitLabel.textContent = COPY[mode].submit;
  document.title = `${COPY[mode].submit} · Arachne`;
  clearErrors();
}

function clearErrors() {
  formError.textContent = "";
  $$(".field-error").forEach((p) => (p.textContent = ""));
  $$(".input").forEach((i) => i.removeAttribute("aria-invalid"));
}

function fieldError(id, msg) {
  $(`#${id}Error`).textContent = msg;
  $(`#${id}`).setAttribute("aria-invalid", "true");
}

function validate(body) {
  const errors = [];
  if (mode === "signup" && !body.name) errors.push(["name", "Enter your name so teammates know who’s asking."]);
  if (!body.email) errors.push(["email", "Enter your work email."]);
  else if (!/^\S+@\S+\.\S+$/.test(body.email)) errors.push(["email", "Use a full email address, like name@company.com."]);
  if (!body.password) errors.push(["password", "Enter your password."]);
  else if (mode === "signup" && body.password.length < 6) errors.push(["password", "Use at least 6 characters."]);
  return errors;
}

$$(".mode").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));

$("#demo").addEventListener("click", () => {
  setMode("login");
  $("#email").value = "demo@arachne.dev";
  $("#password").value = "arachne123";
  form.requestSubmit();
});

fetch("/auth/teams")
  .then((r) => r.json())
  .then((teams) => ($("#team").innerHTML = teams.map((t) => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join("")));

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (submit.disabled) return;
  clearErrors();
  const body = { email: $("#email").value.trim(), password: $("#password").value };
  if (mode === "signup") Object.assign(body, { name: $("#name").value.trim(), team: $("#team").value });
  const errors = validate(body);
  if (errors.length) {
    errors.forEach(([id, msg]) => fieldError(id, msg));
    $(`#${errors[0][0]}`).focus();
    return;
  }

  submit.disabled = true;
  submit.setAttribute("aria-busy", "true");
  const spinner = Object.assign(document.createElement("span"), { className: "spinner" });
  const shown = setTimeout(() => submit.prepend(spinner), 150); // no flicker on fast responses
  try {
    const res = await fetch(`/auth/${mode}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) {
      location.href = "/";
      return;
    }
    const data = await res.json().catch(() => ({}));
    const detail = typeof data.detail === "string" ? data.detail : "That didn’t work. Check your details & try again.";
    if (res.status === 401) {
      fieldError("password", `${detail}. Try again, or use the demo account below.`);
      $("#password").focus();
    } else if (res.status === 409) {
      fieldError("email", `${detail}. Sign in instead.`);
      $("#email").focus();
    } else {
      formError.textContent = detail;
    }
  } catch {
    formError.textContent = "Arachne isn’t reachable right now. Check that the server is running, then try again.";
  } finally {
    clearTimeout(shown);
    spinner.remove();
    submit.disabled = false;
    submit.removeAttribute("aria-busy");
  }
});

// ---------- the orb ----------
const toggle = $("#motionToggle");
try {
  const orb = mountOrb($("#orb"));
  if (motionReduced()) toggle.hidden = true;
  toggle.addEventListener("click", () => {
    const paused = toggle.getAttribute("aria-pressed") !== "true";
    orb.setPlaying(!paused);
    toggle.setAttribute("aria-pressed", String(paused));
    const label = paused ? "Play Animation" : "Pause Animation";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  });
} catch {
  $("#orb").hidden = true;
  toggle.hidden = true;
}

if (matchMedia("(pointer: fine)").matches) $("#email").focus();
