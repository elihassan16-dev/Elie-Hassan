// ☑ Main tasks with sub-items (Elie approved 10/13/26).
// A task can carry a short checklist: t.subtasks = [{id,text,done,doneAt,doneBy}].
// Ticking the last item completes the main task on its own (subAutoDone), and
// unticking one reopens a task that was completed that way.
// Automation rules carry the items as plain text: rule.tasks[i].subs = ["…"].
import { useState } from "react";
import { T } from "./theme";
import { useUpTask } from "./urgent";

export const subsOf = (t) => (Array.isArray(t && t.subtasks) ? t.subtasks.filter((s) => s && s.text) : []);
export const subProgress = (t) => { const s = subsOf(t); return { done: s.filter((x) => x.done).length, total: s.length }; };
const newId = () => Date.now() + Math.floor(Math.random() * 1e5);
export const makeSubs = (texts) => (texts || []).map((x) => String(x || "").trim()).filter(Boolean).map((text, i) => ({ id: newId() + i, text, done: false }));

// New checklist → the task's status follows it.
export function withSubs(t, subs, me) {
  const total = subs.length, done = subs.filter((x) => x.done).length;
  const isDone = t.status === "Completed" || t.status === "N/A";
  if (total && done === total && !isDone) return { ...t, subtasks: subs, status: "Completed", completedAt: new Date().toISOString(), completedBy: me || "", subAutoDone: true };
  if (done < total && t.status === "Completed" && t.subAutoDone) return { ...t, subtasks: subs, status: "Not Started", completedAt: null, completedBy: null, subAutoDone: false };
  return { ...t, subtasks: subs };
}

export function useSubtaskOps() {
  const { upTask, me } = useUpTask();
  const edit = (t, fn) => upTask(t.propId, t.id, (x) => withSubs(x, fn(subsOf(x)), me));
  return {
    toggle: (t, sid) => edit(t, (s) => s.map((x) => (x.id !== sid ? x : x.done ? { ...x, done: false, doneAt: null, doneBy: null } : { ...x, done: true, doneAt: new Date().toISOString(), doneBy: me || "" }))),
    add: (t, text) => { const v = String(text || "").trim(); if (v) edit(t, (s) => [...s, { id: newId(), text: v, done: false }]); },
    remove: (t, sid) => edit(t, (s) => s.filter((x) => x.id !== sid)),
  };
}

const Check = ({ size }) => (
  <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
// 44pt tap target around a small ring (same look as the task circles).
export function SubCircle({ done, onToggle, size = 20, label }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle(); }} aria-label={label || (done ? "Untick item" : "Tick item")} aria-pressed={!!done}
      style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, margin: -(44 - size) / 2, padding: 0, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, WebkitTapHighlightColor: "transparent" }}>
      <span style={{ width: size, height: size, borderRadius: "50%", boxSizing: "border-box", border: done ? "none" : "1.5px solid #C7C7CC", background: done ? "#34C759" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>{done && <Check size={size} />}</span>
    </button>
  );
}

// "1/3 ▬▬" pill shown next to a task's name.
export function SubProgress({ t, style }) {
  const { done, total } = subProgress(t);
  if (!total) return null;
  const all = done === total;
  return (
    <span title={`${done} of ${total} done`} style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, fontSize: 11, fontWeight: 700, color: all ? "#1E7B3C" : "#8a6d1f", background: all ? "#E8F4EC" : "#FDF6E3", border: `1px solid ${all ? "#BFE3CB" : "#EAD9A9"}`, borderRadius: 10, padding: "0 7px", lineHeight: "18px", fontVariantNumeric: "tabular-nums", ...style }}>
      {done}/{total}
      <span style={{ width: 26, height: 4, borderRadius: 2, background: all ? "#BFE3CB" : "#EAD9A9", overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.round((done / total) * 100)}%`, background: all ? "#34C759" : T.gold }} /></span>
    </span>
  );
}

const shortDate = (iso) => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return ""; } };
const first = (n) => String(n || "").split(" ")[0];

// Task pop-up section: tick items, add one, swipe-free ✕ to remove.
export function ChecklistSection({ task, sec, h6 }) {
  const ops = useSubtaskOps();
  const subs = subsOf(task);
  const [adding, setAdding] = useState(false);
  const [txt, setTxt] = useState("");
  const { done, total } = subProgress(task);
  const save = () => { if (txt.trim()) ops.add(task, txt); setTxt(""); };
  if (!total && !adding) {
    return (
      <div style={{ ...sec, padding: "4px 12px" }}>
        <button onClick={() => setAdding(true)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 40, padding: 0, border: "none", background: "none", color: "#8a6d1f", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ width: 22, textAlign: "center", fontSize: 17 }}>＋</span>Add a checklist
        </button>
      </div>
    );
  }
  return (
    <div style={sec}>
      <div style={{ ...h6, display: "flex", justifyContent: "space-between" }}><span>Checklist</span>{total > 0 && <span>{done} of {total} done</span>}</div>
      {subs.map((s, i) => (
        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 42, borderTop: i ? `1px solid ${T.border}` : "none" }}>
          <SubCircle done={s.done} onToggle={() => ops.toggle(task, s.id)} size={22} />
          <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, color: s.done ? T.textTert : T.text, textDecoration: s.done ? "line-through" : "none", wordBreak: "break-word" }}>{s.text}</span>
          {s.done && s.doneBy && <span style={{ fontSize: 11.5, color: T.textSub, whiteSpace: "nowrap" }}>{first(s.doneBy)}{s.doneAt ? ` · ${shortDate(s.doneAt)}` : ""}</span>}
          <button onClick={() => { if (window.confirm(`Remove "${s.text}" from the checklist?`)) ops.remove(task, s.id); }} aria-label={`Remove ${s.text}`} style={{ width: 32, height: 32, minHeight: 32, border: "none", background: "none", color: T.textTert, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>
      ))}
      {adding ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44, borderTop: total ? `1px solid ${T.border}` : "none", paddingTop: total ? 6 : 0 }}>
          <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setAdding(false); setTxt(""); } }} placeholder="New item…"
            style={{ flex: 1, minWidth: 0, minHeight: 36, borderRadius: 10, border: `1px solid ${T.border}`, padding: "0 10px", fontSize: 16, fontFamily: "inherit", outline: "none" }} />
          <button onClick={save} disabled={!txt.trim()} style={{ minHeight: 36, padding: "0 14px", borderRadius: 18, border: "none", background: txt.trim() ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: txt.trim() ? "pointer" : "default", fontFamily: "inherit" }}>Add</button>
          <button onClick={() => { setAdding(false); setTxt(""); }} style={{ minHeight: 36, padding: "0 8px", border: "none", background: "none", color: T.textSub, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" }}>Done</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", minHeight: 42, padding: 0, border: "none", borderTop: `1px solid ${T.border}`, background: "none", color: "#8a6d1f", fontSize: 14.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ width: 22, textAlign: "center", fontSize: 17 }}>＋</span>Add item
        </button>
      )}
    </div>
  );
}

// The ▸ list rows under a task in the Tasks view.
export function SubRows({ task, grid }) {
  const ops = useSubtaskOps();
  const subs = subsOf(task);
  if (grid === "mobile") {
    return subs.map((s) => (
      <div key={s.id} onClick={(e) => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px 0 46px", minHeight: 44, borderTop: `1px solid rgba(60,60,67,0.08)`, background: "#FAFAFB" }}>
        <SubCircle done={s.done} onToggle={() => ops.toggle(task, s.id)} size={20} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: s.done ? T.textTert : T.text, textDecoration: s.done ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.text}</span>
        {s.done && s.doneAt && <span style={{ fontSize: 11.5, color: T.textSub }}>{shortDate(s.doneAt)}</span>}
      </div>
    ));
  }
  return subs.map((s) => (
    <div key={s.id} onClick={(e) => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: grid, columnGap: 12, alignItems: "center", padding: "0 16px 0 50px", minHeight: 38, borderTop: `1px solid rgba(60,60,67,0.08)`, background: "#FAFAFB", fontSize: 13 }}>
      <SubCircle done={s.done} onToggle={() => ops.toggle(task, s.id)} size={18} />
      <span style={{ minWidth: 0, color: s.done ? T.textTert : "#3A3A3C", textDecoration: s.done ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.text}</span>
      <span />
      <span style={{ fontSize: 12, color: T.textSub }}>{s.done ? `${first(s.doneBy)}${s.doneAt ? ` · ${shortDate(s.doneAt)}` : ""}` : ""}</span>
      <span />
    </div>
  ));
}

// ── One-time grouping of the separate "Turn on water / electric / gas" tasks ──
const UTIL_RE = /^\s*turn\s*(on|over)\s*(the\s*)?(water|electric(ity)?|gas|power|sewer)\b/i;
export const isUtilText = (s) => UTIL_RE.test(String(s || ""));
const MASTER = "Turn on utilities";

// Property tasks: ≥2 separate utility tasks → one "Turn on utilities" task whose
// checklist keeps each one's done state; messages, contacts and the urgent flag
// carry over; the master sits where the first one was. Returns null if nothing to do.
export function groupUtilTasks(tasks) {
  const list = tasks || [];
  const hits = list.filter((t) => !(t.subtasks && t.subtasks.length) && isUtilText(t.text));
  if (hits.length < 2) return null;
  const firstT = hits[0];
  const isDone = (t) => t.status === "Completed" || t.status === "N/A";
  const subs = hits.map((t, i) => ({ id: (Number(t.id) || newId()) + i, text: String(t.text).trim(), done: isDone(t), doneAt: isDone(t) ? t.completedAt || null : null, doneBy: isDone(t) ? t.completedBy || "" : null }));
  const allDone = subs.every((s) => s.done);
  const contacts = []; hits.forEach((t) => (Array.isArray(t.taskContacts) ? t.taskContacts : t.taskContact ? [t.taskContact] : []).forEach((c) => { if (c && !contacts.some((x) => (x.id && x.id === c.id) || x.name === c.name)) contacts.push(c); }));
  const master = {
    ...firstT,
    text: MASTER,
    subtasks: subs,
    status: allDone ? "Completed" : "Not Started",
    completedAt: allDone ? hits.map((t) => t.completedAt).filter(Boolean).sort().pop() || null : null,
    completedBy: allDone ? firstT.completedBy || null : null,
    subAutoDone: allDone,
    urgent: hits.some((t) => t.urgent && !isDone(t)),
    messages: hits.flatMap((t) => t.messages || []).sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))),
    ...(contacts.length ? { taskContacts: contacts, taskContact: contacts[0] } : {}),
    groupedFrom: hits.map((t) => t.id),
  };
  const gone = new Set(hits.map((t) => t.id));
  const out = [];
  list.forEach((t) => { if (t.id === firstT.id) out.push(master); else if (!gone.has(t.id)) out.push(t); });
  return out;
}

// Automation rules: ≥2 utility tasks in one rule → one task with sub-items.
export function groupUtilRule(rule) {
  const tasks = rule.tasks || [];
  const hits = tasks.filter((t) => !(t.subs && t.subs.length) && isUtilText(t.text));
  if (hits.length < 2) return null;
  const f = hits[0];
  const master = { ...f, text: MASTER, subs: hits.map((t) => String(t.text).trim()) };
  const out = [];
  tasks.forEach((t) => { if (t === f) out.push(master); else if (!hits.includes(t)) out.push(t); });
  return { ...rule, tasks: out };
}
