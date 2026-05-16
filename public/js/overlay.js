export function showOverlay(el) {
  if (!el) return;
  el.classList.remove("hidden");
  el.hidden = false;
  el.style.removeProperty("display");
}

export function hideOverlay(el) {
  if (!el) return;
  el.classList.add("hidden");
  el.hidden = true;
  el.style.display = "none";
}
