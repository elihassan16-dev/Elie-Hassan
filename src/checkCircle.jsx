// ✓ iOS Reminders-style check circle (Elie 10/13/26) — shared by team tasks,
// contractor tasks in the team app, the admin contractors page and the
// contractor portal. Tasks are just open or completed now (no In progress /
// N/A pickers). The BUTTON is the full 44pt tap square — phones force
// buttons to 44pt tall, so a 22pt button would stretch into an oval — and
// the 22pt ring is a span inside it; negative margins keep row layouts as if
// it were only the ring.
export function CheckCircle({ done, urgent, onToggle, size = 22, label }) {
  const m = -(44 - size) / 2;
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle && onToggle(); }} aria-label={label || (done ? "Reopen task" : "Mark complete")} title={done ? "Reopen" : "Mark complete"}
      style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, margin: m, padding: 0, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
      <span style={{ width: size, height: size, borderRadius: "50%", boxSizing: "border-box", border: done ? "none" : `1.5px solid ${urgent ? "#FF3B30" : "#C7C7CC"}`, background: done ? "#34C759" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {done && <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
    </button>
  );
}
// Open vs done for any task — "N/A" counts as done, "In Progress" as open.
export const isClosedStatus = (s) => s === "Completed" || s === "N/A";
