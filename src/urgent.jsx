// 🚨 Urgent (Elie approved 10/5/26). Anyone on the team — and contractors in
// their portal — can mark a message or a task URGENT:
//  • chats: a 🚨 Urgent chip above the typing box (ChatComposer / the portal
//    composer); the next message goes out with urgent:true, a red URGENT tag
//    and a "🚨 URGENT" notification. The chip resets after each message.
//  • tasks: "🚨 Mark urgent" in the task's status menu, or the switch when
//    adding tasks. urgent / urgentAt / urgentBy live on the task.
// The Dashboard shows a red URGENT window (count) that opens every open urgent
// item (Mine / Everyone), and the next time someone opens the app a red pop-up
// in the middle of the screen walks them through what's new for them.
// An urgent task stays open until it's done; an urgent message until someone
// other than its author replies in that thread, or anyone taps ✓ Handled.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { useData } from "./data/DataProvider";
import { useContractorData } from "./contractors/data";
import { notify, urgentPing, attLabel } from "./net";

export const RED = "#FF3B30", RED_TEXT = "#D70015", RED_TINT = "#FFF5F4", RED_SOFT = "#FFE5E3";
const OFFICE_TASK_PID = "__office_task__"; // same virtual property id GoldstoneApp uses for company tasks

// ── Composer → message hand-off. The composer sets `on` right before it calls
// its onSend; every place that builds a message object runs urgentMark(msg)
// while building it (synchronously), which stamps it and arms the notification.
export const urgentNext = { on: false };
export function urgentMark(msg) {
  if (urgentNext.on && msg) {
    msg.urgent = true;
    urgentNext.on = false;
    urgentPing.until = Date.now() + 8000;
  }
  return msg;
}

// Small red pill.
export function UrgentTag({ style }) {
  return <span style={{ display: "inline-block", background: RED, color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", borderRadius: 6, padding: "2px 6px", lineHeight: 1.3, verticalAlign: 1, ...style }}>URGENT</span>;
}
// Bubble overrides for an urgent message (red hairline + light red, dark text).
export const urgentBubble = (m) => (m && m.urgent ? { border: `1.5px solid ${RED}`, background: RED_TINT, color: T.text } : null);

// The composer chip.
export function UrgentChip({ on, onToggle, style }) {
  return (
    <button type="button" onClick={onToggle} title={on ? "This message goes out URGENT — tap to turn off" : "Send the next message as URGENT"} aria-pressed={on}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, minHeight: 32, padding: "0 12px", borderRadius: 16, border: `1.5px solid ${on ? RED : "#D1D1D6"}`, background: on ? RED : "#fff", color: on ? "#fff" : "#3A3A3C", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? `0 0 0 3px ${RED_SOFT}` : "none", flexShrink: 0, ...style }}>
      🚨 Urgent{on ? " ✓" : ""}
    </button>
  );
}

const ms = (v) => (typeof v === "number" ? v : Date.parse(v) || 0);
const ago = (v) => {
  const t = ms(v); if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const first = (n) => String(n || "").split(" ")[0];
const isOpenTask = (t) => t && t.urgent && t.status !== "Completed" && t.status !== "N/A";
// On my plate = I'm the delegate, or I own it and it isn't delegated; unassigned = everyone's.
const taskIsMine = (t, me) => (!t.assignee && !t.delegate) || t.delegate === me || (t.assignee === me && !t.delegate);

// Every open urgent item the team app can see.
export function collectUrgent({ props, officeTasks, officeMessages, ctrJobs, ctrMessages, ctrOrgs, me }) {
  const tasks = [], msgs = [];
  const thread = (list, ctx) => {
    const arr = (list || []).filter(Boolean);
    arr.forEach((m) => {
      if (!m.urgent || m.urgentDone) return;
      const at = ms(m.at);
      const answered = arr.some((x) => x !== m && ms(x.at) > at && (ctx.sideKey ? x.side !== m.side : x.author !== m.author));
      if (answered) return;
      const forTeam = ctx.sideKey ? m.side === "contractor" : true;
      const mine = forTeam && m.author !== me && (!(m.mentions || []).length || (m.mentions || []).includes(me) || ctx.sideKey);
      msgs.push({ kind: "msg", key: `m:${ctx.where}:${ctx.propId ?? ""}:${ctx.taskId ?? ""}:${ctx.jobId ?? ""}:${m.id}`, where: ctx.where, propId: ctx.propId, taskId: ctx.taskId, jobId: ctx.jobId, id: m.id, msg: m,
        text: m.text || attLabel(m.attachment) || "", author: m.author || "", at, label: ctx.label, mine, toContractor: ctx.sideKey && m.side !== "contractor" });
    });
  };
  (props || []).filter((p) => p && !p.archived).forEach((p) => {
    const label = `${p.address || ""}${p.city ? `, ${p.city}` : ""}`;
    (p.tasks || []).forEach((t) => {
      if (isOpenTask(t)) tasks.push({ kind: "task", key: `t:${p.id}:${t.id}`, propId: p.id, taskId: t.id, task: t, text: t.text || "Task", by: t.urgentBy || t.assignedBy || "", at: ms(t.urgentAt || t.assignedAt), label, who: t.delegate || t.assignee || "", mine: taskIsMine(t, me) });
      thread(t.messages, { where: "task", propId: p.id, taskId: t.id, label: `${label} · ${t.text || "task"}` });
    });
    thread(p.messages, { where: "prop", propId: p.id, label });
  });
  (officeTasks || []).forEach((t) => {
    if (isOpenTask(t)) tasks.push({ kind: "task", key: `t:office:${t.id}`, propId: OFFICE_TASK_PID, taskId: t.id, task: t, text: t.text || "Task", by: t.urgentBy || t.assignedBy || "", at: ms(t.urgentAt || t.assignedAt), label: "Office", who: t.delegate || t.assignee || "", mine: taskIsMine(t, me) });
    thread(t.messages, { where: "officeTask", taskId: t.id, label: `Office · ${t.text || "task"}` });
  });
  thread(officeMessages, { where: "office", label: "Office chat" });
  const byJob = {};
  (ctrMessages || []).forEach((m) => { if (m && m.jobId != null) (byJob[m.jobId] = byJob[m.jobId] || []).push(m); });
  Object.entries(byJob).forEach(([jid, list]) => {
    const job = (ctrJobs || []).find((j) => String(j.id) === String(jid));
    if (!job) return;
    const org = ((ctrOrgs || []).find((o) => String(o.id) === String(job.orgId)) || {}).name || "Contractor";
    thread(list, { where: "ctr", jobId: job.id, propId: job.propertyId, label: `${org} · ${job.propertyAddress || ""}`, sideKey: true });
  });
  tasks.sort((a, b) => b.at - a.at); msgs.sort((a, b) => b.at - a.at);
  return { tasks, msgs };
}

// Data + actions for the team app.
export function useUrgent() {
  const d = useData() || {};
  const c = useContractorData() || {};
  const me = d.currentUser;
  const all = useMemo(() => collectUrgent({ props: d.sharedProps, officeTasks: d.officeTasks, officeMessages: d.officeMessages, ctrJobs: c.jobs, ctrMessages: c.messages, ctrOrgs: c.orgs, me }),
    [d.sharedProps, d.officeTasks, d.officeMessages, c.jobs, c.messages, c.orgs, me]);
  const flush = (f) => { if (f) setTimeout(f, 0); };
  const done = { by: me || "", at: new Date().toISOString() };
  const handle = (it) => {
    const mark = (m) => (String(m.id) === String(it.id) ? { ...m, urgentDone: done } : m);
    if (it.where === "prop") { d.setSharedProps((prev) => prev.map((p) => (p.id !== it.propId ? p : { ...p, messages: (p.messages || []).map(mark) }))); flush(d.flushProps); }
    else if (it.where === "task") { d.setSharedProps((prev) => prev.map((p) => (p.id !== it.propId ? p : { ...p, tasks: (p.tasks || []).map((t) => (t.id !== it.taskId ? t : { ...t, messages: (t.messages || []).map(mark) })) }))); flush(d.flushProps); }
    else if (it.where === "office") { d.setOfficeMessages((prev) => (prev || []).map(mark)); flush(d.flushOffice); }
    else if (it.where === "officeTask") { d.setOfficeTasks((prev) => (prev || []).map((t) => (t.id !== it.taskId ? t : { ...t, messages: (t.messages || []).map(mark) }))); flush(d.flushOfficeTasks); }
    else if (it.where === "ctr" && c.save) c.save("contractor_messages", { ...it.msg, urgentDone: done }).catch(() => {});
  };
  const upTask = makeUpTask(d);
  const completeTask = (it) => upTask(it.propId, it.taskId, (t) => ({ ...t, status: "Completed", completedAt: new Date().toISOString(), completedBy: me }));
  return { ...all, me, handle, completeTask, setTaskUrgent: (t, on) => setTaskUrgent(t, on, { me, upTask, props: d.sharedProps }) };
}

// Update one task wherever it lives (a property, or the office list).
function makeUpTask(d) {
  const flush = (f) => { if (f) setTimeout(f, 0); };
  return (propId, taskId, fn) => {
    if (propId === OFFICE_TASK_PID) { d.setOfficeTasks((prev) => (prev || []).map((t) => (t.id === taskId ? fn(t) : t))); flush(d.flushOfficeTasks); }
    else { d.setSharedProps((prev) => prev.map((p) => (String(p.id) !== String(propId) ? p : { ...p, tasks: (p.tasks || []).map((t) => (t.id === taskId ? fn(t) : t)) }))); flush(d.flushProps); }
  };
}
// Light hook for task rows: just the setter (no scanning of every chat).
export function useSetTaskUrgent() {
  const d = useData() || {};
  return (t, on) => setTaskUrgent(t, on, { me: d.currentUser, upTask: makeUpTask(d), props: d.sharedProps });
}
// Flip a task's urgent flag (and tell whoever's doing it).
export function setTaskUrgent(t, on, { me, upTask, props }) {
  if (!t) return;
  const propId = t.propId;
  upTask(propId, t.id, (x) => ({ ...x, urgent: !!on, urgentAt: on ? Date.now() : null, urgentBy: on ? me : null }));
  if (!on) return;
  const who = [...new Set([t.assignee, t.delegate].filter((n) => n && n !== me))];
  const p = propId === OFFICE_TASK_PID ? null : (props || []).find((x) => String(x.id) === String(propId));
  const where = p ? ` — 🏠 ${p.address}${p.city ? `, ${p.city}` : ""}` : propId === OFFICE_TASK_PID ? " — Office" : "";
  const url = `/?goto=task:${propId === OFFICE_TASK_PID ? "office" : propId}:${t.id}`;
  if (who.length) notify(who, { title: "🚨 URGENT task", body: `${me}: ${t.text || "Task"}${where}`, tag: `urgent-task-${t.id}`, url });
  else notify(null, { toTeam: true, title: "🚨 URGENT task", body: `${me}: ${t.text || "Task"}${where}`, tag: `urgent-task-${t.id}`, url });
}

// Jump somewhere in the app from anywhere (handled by the shell's deep-link code).
export const gsGoto = (to) => { try { window.dispatchEvent(new CustomEvent("gs-goto", { detail: to })); } catch { /* no window */ } };
export const openUrgentItem = (it) => {
  if (it.kind === "task") return gsGoto(`task:${it.propId === OFFICE_TASK_PID ? "office" : it.propId}:${it.taskId}`);
  if (it.where === "office" || it.where === "officeTask") return gsGoto("chat:__office__");
  if (it.propId != null) return gsGoto(`chat:${it.propId}`);
};

// ── The red Dashboard window ──
export function UrgentTile({ isMobile, onOpen }) {
  const { tasks, msgs } = useUrgent();
  const mineT = tasks.filter((x) => x.mine).length, mineM = msgs.filter((x) => x.mine).length;
  const n = mineT + mineM, total = tasks.length + msgs.length;
  if (!total) return null;
  const parts = [mineT ? `${mineT} task${mineT === 1 ? "" : "s"}` : "", mineM ? `${mineM} message${mineM === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  return (
    <div onClick={onOpen} role="button" style={{ gridColumn: "1 / -1", background: T.card, borderRadius: 16, padding: isMobile ? "12px 14px" : "14px 18px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", boxShadow: `0 0 0 1.5px ${RED}, 0 4px 14px rgba(255,59,48,0.16)` }}>
      <span style={{ width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: 12, background: RED_SOFT, display: "flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 17 : 19, flexShrink: 0 }}>🚨</span>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, color: RED_TEXT, lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>{n}</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: RED_TEXT, letterSpacing: "0.08em", marginTop: 2 }}>URGENT{n !== total ? ` · ${total} TEAM-WIDE` : ""}</div>
      </span>
      <span style={{ marginLeft: "auto", textAlign: "right", fontSize: 12, color: T.textSub, lineHeight: 1.4 }}>
        {parts ? <b style={{ color: RED_TEXT }}>{parts}</b> : <span>none on you</span>}<br />tap to see them ›
      </span>
    </div>
  );
}

// ── Tap it: everything urgent ──
export function UrgentSheet({ isMobile, onClose }) {
  const { tasks, msgs, handle, completeTask } = useUrgent();
  const [tab, setTab] = useState(() => (tasks.some((x) => x.mine) || msgs.some((x) => x.mine) ? "mine" : "all"));
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const T2 = tab === "mine" ? tasks.filter((x) => x.mine) : tasks;
  const M2 = tab === "mine" ? msgs.filter((x) => x.mine) : msgs;
  const nMine = tasks.filter((x) => x.mine).length + msgs.filter((x) => x.mine).length;
  const seg = (on) => ({ flex: 1, minHeight: 34, border: "none", borderRadius: 14, background: on ? "#fff" : "transparent", color: on ? T.text : T.textSub, fontWeight: on ? 650 : 450, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.14)" : "none" });
  const lab = { fontSize: 12, fontWeight: 600, color: T.textSub, margin: "14px 4px 6px", letterSpacing: "0.02em" };
  const chip = { display: "inline-block", background: T.bg, borderRadius: 8, padding: "2px 7px", fontSize: 11.5, color: "#3A3A3C", marginRight: 6, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" };
  const card = { background: "#fff", borderRadius: 14, padding: "11px 12px", marginBottom: 8, display: "flex", gap: 10, alignItems: "flex-start", boxShadow: `inset 3px 0 0 ${RED}`, cursor: "pointer" };
  const go = (it) => { onClose(); openUrgentItem(it); };
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.32)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, width: isMobile ? "100%" : 540, maxHeight: isMobile ? "90vh" : "86vh", borderRadius: isMobile ? "28px 28px 0 0" : 24, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {isMobile && <div style={{ width: 36, height: 5, borderRadius: 3, background: "rgba(60,60,67,0.3)", margin: "8px auto 0", flexShrink: 0 }} />}
        <div style={{ display: "flex", alignItems: "center", padding: "10px 14px 8px" }}>
          <div style={{ flex: 1, fontSize: 20, fontWeight: 700, color: T.text }}>🚨 Urgent</div>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <span style={{ width: 30, height: 30, borderRadius: 15, background: "rgba(118,118,128,0.12)", color: T.textSub, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✕</span>
          </button>
        </div>
        <div style={{ padding: "0 14px" }}>
          <div style={{ display: "flex", borderRadius: 18, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)", padding: 3, gap: 2 }}>
            <button onClick={() => setTab("mine")} style={seg(tab === "mine")}>Mine ({nMine})</button>
            <button onClick={() => setTab("all")} style={seg(tab === "all")}>Everyone ({tasks.length + msgs.length})</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "0 14px calc(16px + env(safe-area-inset-bottom))" }}>
          {!T2.length && !M2.length && <div style={{ textAlign: "center", color: T.textSub, fontSize: 14, padding: "36px 10px" }}>{tab === "mine" ? "Nothing urgent on you right now. 🎉" : "Nothing urgent right now. 🎉"}</div>}
          {T2.length > 0 && <div style={lab}>TASKS · TAP TO OPEN</div>}
          {T2.map((it) => (
            <div key={it.key} onClick={() => go(it)} style={card}>
              <button onClick={(e) => { e.stopPropagation(); completeTask(it); }} title="Mark done" aria-label="Mark done" style={{ width: 26, height: 26, borderRadius: "50%", border: `2px solid ${RED}`, background: "#fff", flexShrink: 0, marginTop: 1, cursor: "pointer", padding: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 650, color: RED_TEXT, lineHeight: 1.3 }}>{it.text}</div>
                <div style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}><span style={chip}>🏠 {it.label}</span>{it.by ? `from ${first(it.by)}` : ""}{it.who ? ` · ${first(it.who)}` : ""} · {ago(it.at)}</div>
              </div>
              <span style={{ color: "#C7C7CC", fontSize: 18, alignSelf: "center" }}>›</span>
            </div>
          ))}
          {M2.length > 0 && <div style={lab}>MESSAGES · TAP TO OPEN THE CHAT</div>}
          {M2.map((it) => (
            <div key={it.key} onClick={() => go(it)} style={card}>
              <span style={{ fontSize: 19, flexShrink: 0 }}>{it.where === "ctr" ? "👷" : "💬"}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14.5, fontWeight: 650, color: RED_TEXT, lineHeight: 1.3 }}><UrgentTag style={{ marginRight: 6 }} />{it.text}</div>
                <div style={{ fontSize: 12, color: T.textSub, marginTop: 4 }}><span style={chip}>{it.label}</span>from {first(it.author)}{it.toContractor ? " → contractor" : ""} · {ago(it.at)}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handle(it); }} title="Done — take it off the urgent list" style={{ flexShrink: 0, alignSelf: "center", minHeight: 32, padding: "0 10px", borderRadius: 16, border: "1px solid #3BA55D", background: "#EDFBF1", color: "#15803D", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>✓ Handled</button>
            </div>
          ))}
          <div style={{ fontSize: 12, color: T.textSub, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>A task leaves this list when it's marked done.<br />A message leaves when someone replies or taps ✓ Handled.</div>
        </div>
      </div>
    </div>, document.body);
}

// ── The red pop-up in the middle of the screen (team app + contractor portal) ──
export function UrgentPopup({ item, index, count, onOpen, onLater, openLabel }) {
  if (!item) return null;
  const isTask = item.kind === "task";
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 3500, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div role="alertdialog" aria-label="Urgent" style={{ background: "#fff", borderRadius: 26, padding: "24px 20px 16px", width: "100%", maxWidth: 360, boxShadow: "0 24px 60px rgba(0,0,0,0.35)", textAlign: "center" }}>
        <div style={{ width: 58, height: 58, borderRadius: "50%", background: RED_SOFT, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🚨</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: RED_TEXT }}>{isTask ? "New urgent task" : "New urgent message"}</div>
        <div style={{ fontSize: 13, color: T.textSub, marginTop: 3 }}>from {first(item.by || item.author) || "the team"} · {ago(item.at)}</div>
        <div style={{ background: RED_TINT, border: "1px solid #FFC9C5", borderRadius: 14, padding: 12, margin: "14px 0", textAlign: "left" }}>
          <div style={{ fontSize: 15.5, fontWeight: 650, color: T.text, lineHeight: 1.35, whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>{item.text}</div>
          {item.label && <div style={{ marginTop: 7 }}><span style={{ display: "inline-block", background: "#fff", borderRadius: 8, padding: "2px 8px", fontSize: 12, color: "#3A3A3C" }}>{isTask ? "🏠 " : ""}{item.label}</span></div>}
        </div>
        <button onClick={onOpen} style={{ width: "100%", minHeight: 50, borderRadius: 25, border: "none", background: RED, color: "#fff", fontWeight: 700, fontSize: 16, cursor: "pointer", fontFamily: "inherit" }}>{openLabel || (isTask ? "Open the task" : "Open the chat")}</button>
        <button onClick={onLater} style={{ width: "100%", minHeight: 44, borderRadius: 22, border: "none", background: "transparent", color: T.text, fontWeight: 600, fontSize: 15, cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}>Got it — later</button>
        {count > 1 && <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 2 }}>{index + 1} of {count} new urgent items</div>}
      </div>
    </div>, document.body);
}

// Which urgent items this person has already been shown (per person, per device).
const seenKey = (who) => `gs_urgent_seen_${String(who || "").toLowerCase()}`;
export const readSeen = (who) => { try { return new Set(JSON.parse(localStorage.getItem(seenKey(who)) || "[]")); } catch { return new Set(); } };
export const addSeen = (who, key) => { try { const s = readSeen(who); s.add(key); localStorage.setItem(seenKey(who), JSON.stringify([...s].slice(-400))); } catch { /* private mode */ } };

// Team app: pop up anything urgent that's new for me.
export function UrgentAlert() {
  const { fresh } = useData() || {};
  const { tasks, msgs, me } = useUrgent();
  const [, bump] = useState(0);
  if (!me || fresh === false) return null;
  const seen = readSeen(me);
  const mineNew = [
    ...tasks.filter((x) => x.mine && x.by !== me),
    ...msgs.filter((x) => x.mine),
  ].filter((x) => !seen.has(x.key)).sort((a, b) => a.at - b.at);
  if (!mineNew.length) return null;
  const it = mineNew[0];
  const done = () => { addSeen(me, it.key); bump((v) => v + 1); };
  return <UrgentPopup item={it} index={0} count={mineNew.length} onOpen={() => { done(); openUrgentItem(it); }} onLater={done} />;
}
