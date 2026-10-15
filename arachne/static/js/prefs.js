// The signed-in user's preferences: applied instantly, saved in the background, rolled back on failure.
import { DEFAULT_PREFS, applyTheme } from "./theme.js";
import { apiJSON, toast } from "./ui.js";

let prefs = { ...DEFAULT_PREFS };

export const getPrefs = () => prefs;

export function setPrefs(next) {
  prefs = { ...DEFAULT_PREFS, ...next };
  applyTheme(prefs);
  window.dispatchEvent(new CustomEvent("arachne:prefs", { detail: prefs }));
}

/** Show a theme without saving it (colour wheel dragging). */
export function previewPrefs(patch) {
  applyTheme({ ...prefs, ...patch }, { persist: false });
}

export async function updatePrefs(patch) {
  const before = prefs;
  setPrefs({ ...prefs, ...patch });
  try {
    await apiJSON("/me/prefs", { method: "PATCH", body: JSON.stringify(patch) });
  } catch {
    setPrefs(before);
    toast("That setting didn’t save. Check your connection & try again.");
  }
}
