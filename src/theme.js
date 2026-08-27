// Shared design tokens — the single source of truth for the app's look.
// Imported by the main app AND the contractor portal so they stay identical.
export const T={gold:"#B8953F",goldLight:"#F8F1E0",goldMid:"#D4A843",bg:"#F2F2F7",card:"#FFFFFF",cardAlt:"#F9F9FB",border:"rgba(0,0,0,0.08)",text:"#1C1C1E",textSub:"#6E6E73",textTert:"#8E8E93",blue:"#007AFF",green:"#34C759",red:"#FF3B30",orange:"#FF9500",purple:"#AF52DE",teal:"#5AC8FA",shadow:"0 1px 3px rgba(0,0,0,0.07),0 4px 16px rgba(0,0,0,0.04)",shadowMd:"0 2px 8px rgba(0,0,0,0.10),0 8px 32px rgba(0,0,0,0.06)",radius:14,radiusSm:10};

// ── Popups must not force-close mid-edit ─────────────────────────────────────
// Every popup closes when its dark backdrop is clicked. But a browser "click"
// lands on the backdrop even when the press STARTED inside the sheet —
// drag-selecting text out of an input, or a slightly swipey tap on a phone —
// so editing could slam the popup shut and eat the edit. One capture-phase
// guard fixes every popup at once: a click on a fixed-position backdrop is
// swallowed unless the press began on that backdrop itself. Lives here (a
// module side-effect) because every surface — app, contractor portal and the
// preview harness — imports the theme.
if (typeof document !== "undefined" && !window.__gsPopupGuard) {
  window.__gsPopupGuard = true;
  let gsPopDown = null;
  document.addEventListener("pointerdown", (e) => { gsPopDown = e.target; }, true);
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.style && t.style.position === "fixed" && gsPopDown && gsPopDown !== t) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);
}
