// The contractor-facing portal — what a contractor login sees instead of the app.
// Deliberately simple: My Jobs (scope, price, paid/left, day counter, docs),
// Tasks (theirs to do + requests they send us), and Messages (one thread per job).
// RLS guarantees they only ever receive their own company's rows.
import { useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { T } from "../theme";
import { notify, uploadAttachment } from "../net";
import { useContractorData, jobTotal, jobPaid, jobLeft, jobDays, money, fmtDate, fmtWhen } from "./data";

const TASK_STATUSES = ["Not Started", "In Progress", "Completed"];
const stColor = (s) => s === "Completed" ? T.green : s === "In Progress" ? T.blue : T.textSub;

function Att({ att }) {
  if (!att || !att.url) return null;
  if (att.kind === "image") return <a href={att.url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 6 }}><img src={att.url} alt={att.name || "photo"} style={{ maxWidth: 220, maxHeight: 260, borderRadius: 10, display: "block", objectFit: "cover" }} /></a>;
  if (att.kind === "video") return <video src={att.url} controls playsInline preload="metadata" style={{ marginTop: 6, maxWidth: 240, width: "100%", maxHeight: 300, borderRadius: 10, display: "block", background: "#000" }} />;
  if (att.kind === "audio") return <audio src={att.url} controls preload="metadata" style={{ marginTop: 6, width: 240, height: 40 }} />;
  return <a href={att.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "8px 10px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, textDecoration: "none", color: T.text, maxWidth: 240 }}><span style={{ fontSize: 18 }}>📄</span><span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name || "Attachment"}</span></a>;
}

export function ContractorPortal() {
  const { displayName, contractorOrgId, signOut } = useAuth();
  const { orgs, jobs, tasks, messages, docs, save, error } = useContractorData();
  const org = (orgs || []).find((o) => String(o.id) === String(contractorOrgId)) || null;
  const myJobs = useMemo(() => (jobs || []).filter((j) => j.orgId === contractorOrgId).sort((a, b) => (a.status === "complete") - (b.status === "complete") || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))), [jobs, contractorOrgId]);
  const [tab, setTab] = useState("jobs");
  const [msgJobId, setMsgJobId] = useState(null);
  const [err, setErr] = useState("");

  const jobById = (id) => myJobs.find((j) => String(j.id) === String(id));
  const jobLabel = (id) => jobById(id)?.propertyAddress || jobById(id)?.title || "Job";

  // ── shared upload helper (photos, videos, PDFs) ────────────────────────────
  const stage = async (file) => {
    if (!file) return null;
    const isVideo = (file.type || "").startsWith("video/");
    const cap = isVideo ? 50 * 1024 * 1024 : 25 * 1024 * 1024;
    if (file.size > cap) { setErr(isVideo ? "Video is too large (max 50 MB) — trim it shorter or record at lower quality." : "File is too large (max 25 MB)."); return null; }
    setErr("");
    return uploadAttachment(file, "portal");
  };

  // ── Jobs tab ────────────────────────────────────────────────────────────────
  const sowRef = useRef(null);
  const [sowJobId, setSowJobId] = useState(null);
  const [sowBusy, setSowBusy] = useState(false);
  const uploadDoc = async (e) => {
    const file = (e.target.files || [])[0]; e.target.value = "";
    if (!file || !sowJobId) return;
    setSowBusy(true);
    try {
      const up = await stage(file);
      if (up) {
        await save("contractor_docs", { id: Date.now(), jobId: sowJobId, orgId: contractorOrgId, name: up.name, url: up.url, mime: up.mime, by: displayName, at: new Date().toISOString() });
        notify(null, { toAdmins: true, title: `${org?.name || displayName} uploaded a document`, body: `${up.name} — ${jobLabel(sowJobId)}` });
      }
    } catch (ex) { setErr(ex.message || "Upload failed."); }
    setSowBusy(false); setSowJobId(null);
  };

  const jobCard = (j) => {
    const total = jobTotal(j), paid = jobPaid(j), left = jobLeft(j), days = jobDays(j);
    const jobDocs = (docs || []).filter((d) => String(d.jobId) === String(j.id));
    const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
    return (
      <div key={j.id} style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, padding: "14px 16px", marginBottom: 12, opacity: j.status === "complete" ? 0.7 : 1 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 800, color: T.text }}>{j.propertyAddress || j.title || "Job"}</div>
            {j.title && j.propertyAddress && <div style={{ fontSize: 12.5, color: T.textSub }}>{j.title}</div>}
          </div>
          {j.status === "complete"
            ? <span style={{ fontSize: 10.5, fontWeight: 800, background: T.bg, color: T.textSub, borderRadius: 20, padding: "3px 10px" }}>COMPLETE</span>
            : days != null && <span style={{ fontSize: 10.5, fontWeight: 800, background: T.goldLight, color: "#8a6d1f", borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>DAY {days}</span>}
        </div>
        {j.startDate && <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 2 }}>Started {fmtDate(j.startDate)}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {[["Contract", money(total)], ["Paid", money(paid)], ["Remaining", money(left)]].map(([l, v], i) => (
            <div key={l} style={{ flex: 1, background: T.bg, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 9.5, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em" }}>{l}</div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: i === 2 ? (left > 0 ? T.gold : T.green) : T.text }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ height: 6, background: T.bg, borderRadius: 4, marginTop: 8, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: T.green, borderRadius: 4 }} /></div>
        {(j.changeOrders || []).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Change orders</div>
            {(j.changeOrders || []).map((c) => <div key={c.id} style={{ fontSize: 12.5, color: T.text, display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label || "Change order"}{c.date ? ` · ${fmtDate(c.date)}` : ""}</span><b>{money(c.amount)}</b></div>)}
          </div>
        )}
        {j.scope && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 }}>Scope of work</div>
            <div style={{ fontSize: 13, color: T.textSub, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{j.scope}</div>
          </div>
        )}
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {jobDocs.map((d) => <a key={d.id} href={d.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 16, border: `1px solid ${T.border}`, background: T.bg, color: T.blue, fontSize: 12, fontWeight: 600, textDecoration: "none", maxWidth: 200 }}>📄 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span></a>)}
          <button onClick={() => { setSowJobId(j.id); sowRef.current && sowRef.current.click(); }} disabled={sowBusy} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 16, border: `1.5px dashed ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{sowBusy && sowJobId === j.id ? "Uploading…" : "＋ Upload document"}</button>
        </div>
        <button onClick={() => { setTab("messages"); setMsgJobId(j.id); }} style={{ marginTop: 10, width: "100%", padding: "9px", borderRadius: 10, border: `1px solid ${T.border}`, background: "#fff", color: T.text, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>💬 Message Goldstone about this job</button>
      </div>
    );
  };

  // ── Tasks tab ───────────────────────────────────────────────────────────────
  const myTasks = (tasks || []).filter((t) => t.orgId === contractorOrgId);
  const forUs = myTasks.filter((t) => t.direction !== "to_team").sort((a, b) => (a.status === "Completed") - (b.status === "Completed") || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const toTeam = myTasks.filter((t) => t.direction === "to_team").sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const [reqText, setReqText] = useState("");
  const [reqJob, setReqJob] = useState("");
  const cycleStatus = async (t) => {
    const next = TASK_STATUSES[(TASK_STATUSES.indexOf(t.status || "Not Started") + 1) % TASK_STATUSES.length];
    await save("contractor_tasks", { ...t, status: next, doneAt: next === "Completed" ? new Date().toISOString() : null, doneBy: next === "Completed" ? displayName : null });
    if (next === "Completed") notify(null, { toAdmins: true, title: `${org?.name || displayName} completed a task`, body: `${t.text} — ${jobLabel(t.jobId)}` });
  };
  const sendRequest = async () => {
    const txt = reqText.trim(); if (!txt) return;
    await save("contractor_tasks", { id: Date.now(), jobId: reqJob || (myJobs[0]?.id ?? null), orgId: contractorOrgId, text: txt, status: "Not Started", direction: "to_team", createdBy: displayName, createdAt: new Date().toISOString() });
    setReqText("");
    notify(null, { toAdmins: true, title: `Task request from ${org?.name || displayName}`, body: `${txt}${reqJob ? ` — ${jobLabel(reqJob)}` : ""}` });
  };
  const taskRow = (t, mine) => (
    <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", borderTop: `1px solid ${T.border}` }}>
      {mine && <button onClick={() => cycleStatus(t)} title="Tap to change status" style={{ padding: "3px 10px", borderRadius: 20, border: "none", background: stColor(t.status) + "22", color: stColor(t.status), fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, whiteSpace: "nowrap" }}>{t.status || "Not Started"}</button>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.45, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: t.status === "Completed" ? 0.6 : 1 }}>{t.text}</div>
        <div style={{ fontSize: 11, color: T.textTert, marginTop: 2 }}>{jobLabel(t.jobId)}{t.createdAt ? ` · ${fmtDate(t.createdAt)}` : ""}{!mine && t.status === "Completed" ? " · ✓ done" : ""}</div>
      </div>
    </div>
  );

  // ── Messages tab ────────────────────────────────────────────────────────────
  const activeMsgJob = msgJobId || myJobs[0]?.id || null;
  const thread = (messages || []).filter((m) => m.orgId === contractorOrgId && String(m.jobId) === String(activeMsgJob)).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const attRef = useRef(null);
  const pickAtt = async (e) => {
    const file = (e.target.files || [])[0]; e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { const up = await stage(file); if (up) setPending(up); } catch (ex) { setErr(ex.message || "Upload failed."); }
    setBusy(false);
  };
  const sendMsg = async () => {
    const txt = draft.trim();
    if ((!txt && !pending) || !activeMsgJob || busy) return;
    const msg = { id: Date.now(), jobId: activeMsgJob, orgId: contractorOrgId, author: displayName, side: "contractor", text: txt, at: new Date().toISOString(), readBy: [displayName] };
    if (pending) msg.attachment = pending;
    setDraft(""); setPending(null);
    await save("contractor_messages", msg);
    notify(null, { toAdmins: true, title: `${org?.name || displayName} — ${jobLabel(activeMsgJob)}`, body: txt || "(attachment)" });
  };

  const tabBtn = (k, label, icon) => (
    <button key={k} onClick={() => setTab(k)} style={{ flex: 1, minHeight: 52, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, border: "none", background: "transparent", color: tab === k ? T.gold : T.textTert, cursor: "pointer", fontFamily: "inherit" }}>
      <span style={{ fontSize: 19 }}>{icon}</span><span style={{ fontSize: 10.5, fontWeight: tab === k ? 800 : 500 }}>{label}</span>
    </button>
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif" }}>
      <input ref={sowRef} type="file" accept="application/pdf,image/*" onChange={uploadDoc} style={{ display: "none" }} />
      {/* Header */}
      <div style={{ background: T.card, borderBottom: `1px solid ${T.border}`, padding: "max(10px,env(safe-area-inset-top)) 16px 10px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg,${T.gold},${T.goldMid})`, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "Georgia,serif", fontWeight: 700, fontSize: 18, flexShrink: 0 }}>G</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{org?.name || "Contractor Portal"}</div>
          <div style={{ fontSize: 11, color: T.textSub }}>Goldstone Properties · {displayName}</div>
        </div>
        <button onClick={signOut} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 8, color: T.textSub, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: "6px 10px", flexShrink: 0 }}>Sign out</button>
      </div>
      {(error || err) && <div onClick={() => setErr("")} style={{ background: "#FFF0EF", borderBottom: `1px solid ${T.red}`, color: T.red, fontSize: 12.5, fontWeight: 600, padding: "8px 16px", cursor: "pointer" }}>{err || error}</div>}

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 14, display: tab === "messages" ? "flex" : "block", flexDirection: "column" }}>
        {tab === "jobs" && (
          myJobs.length === 0 && jobs !== null
            ? <div style={{ textAlign: "center", color: T.textTert, fontSize: 13.5, padding: "50px 20px" }}>No jobs yet. Goldstone will add your first job here.</div>
            : myJobs.map(jobCard)
        )}
        {tab === "tasks" && (
          <>
            <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden", marginBottom: 14 }}>
              <div style={{ padding: "11px 14px", fontSize: 12, fontWeight: 800, color: T.gold, textTransform: "uppercase", letterSpacing: "0.05em" }}>Your tasks from Goldstone</div>
              {forUs.length === 0 && <div style={{ padding: "6px 14px 16px", fontSize: 13, color: T.textTert }}>Nothing assigned right now.</div>}
              {forUs.map((t) => taskRow(t, true))}
            </div>
            <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden" }}>
              <div style={{ padding: "11px 14px", fontSize: 12, fontWeight: 800, color: T.blue, textTransform: "uppercase", letterSpacing: "0.05em" }}>Requests you sent Goldstone</div>
              <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
                {myJobs.length > 1 && (
                  <select value={reqJob} onChange={(e) => setReqJob(e.target.value)} style={{ padding: "9px 10px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 13, fontFamily: "inherit", color: T.text, outline: "none" }}>
                    <option value="">Which job is this about?</option>
                    {myJobs.map((j) => <option key={j.id} value={j.id}>{j.propertyAddress || j.title}</option>)}
                  </select>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={reqText} onChange={(e) => setReqText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendRequest()} placeholder="Ask Goldstone for something… (materials, decision, payment)" style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 13.5, fontFamily: "inherit", outline: "none" }} />
                  <button onClick={sendRequest} disabled={!reqText.trim()} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: reqText.trim() ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 13, cursor: reqText.trim() ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}>Send</button>
                </div>
              </div>
              {toTeam.map((t) => taskRow(t, false))}
            </div>
          </>
        )}
        {tab === "messages" && (
          <>
            {myJobs.length > 1 && (
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 10, flexShrink: 0 }}>
                {myJobs.map((j) => { const on = String(activeMsgJob) === String(j.id); return <button key={j.id} onClick={() => setMsgJobId(j.id)} style={{ flexShrink: 0, padding: "6px 13px", borderRadius: 18, border: `1px solid ${on ? T.gold : T.border}`, background: on ? T.goldLight : "#fff", color: on ? "#8a6d1f" : T.textSub, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>{j.propertyAddress || j.title}</button>; })}
              </div>
            )}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10, minHeight: 120 }}>
              {!activeMsgJob && <div style={{ textAlign: "center", color: T.textTert, fontSize: 13, padding: "40px 0" }}>No jobs yet — messaging opens once you have a job.</div>}
              {activeMsgJob && thread.length === 0 && <div style={{ textAlign: "center", color: T.textTert, fontSize: 13, padding: "40px 0" }}>No messages yet on this job. Say hello below.</div>}
              {thread.map((m) => { const mine = m.side === "contractor"; return (
                <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%" }}>
                  <div style={{ fontSize: 10, color: T.textTert, marginBottom: 2, textAlign: mine ? "right" : "left" }}>{m.author || (mine ? "You" : "Goldstone")} · {fmtWhen(m.at)}</div>
                  <div style={{ background: mine ? T.gold : T.card, color: mine ? "#fff" : T.text, borderRadius: 14, padding: "9px 13px", fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", boxShadow: mine ? "none" : T.shadow }}>
                    {m.text}
                    <Att att={m.attachment} />
                  </div>
                </div>
              ); })}
            </div>
          </>
        )}
      </div>

      {/* Message composer */}
      {tab === "messages" && activeMsgJob && (
        <div style={{ background: T.card, borderTop: `1px solid ${T.border}`, padding: "10px 12px max(10px,env(safe-area-inset-bottom))", flexShrink: 0 }}>
          {pending && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.goldLight, border: `1px solid ${T.gold}`, borderRadius: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 13 }}>{pending.kind === "image" ? "🖼️" : pending.kind === "video" ? "🎬" : "📄"}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pending.name}</span>
              <button onClick={() => setPending(null)} style={{ background: "none", border: "none", color: T.textTert, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <input ref={attRef} type="file" accept="image/*,video/*,application/pdf" onChange={pickAtt} style={{ display: "none" }} />
            <button onClick={() => attRef.current && attRef.current.click()} disabled={busy} title="Attach a photo, video, or PDF" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.bg, fontSize: 17, cursor: "pointer" }}>📎</button>
            <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }} placeholder={busy ? "Uploading…" : "Message Goldstone…"} disabled={busy}
              style={{ flex: 1, minWidth: 0, padding: "11px 14px", borderRadius: 18, border: `1px solid ${T.border}`, background: T.bg, fontSize: 15, outline: "none", fontFamily: "inherit", resize: "none", lineHeight: 1.4, maxHeight: 120, overflowY: "auto", boxSizing: "border-box" }} />
            <button onClick={sendMsg} disabled={(!draft.trim() && !pending) || busy} style={{ padding: "10px 18px", borderRadius: 22, background: (draft.trim() || pending) && !busy ? T.gold : T.border, border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Send</button>
          </div>
        </div>
      )}

      {/* Bottom tabs */}
      <nav style={{ display: "flex", background: T.card, borderTop: `1px solid ${T.border}`, flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {tabBtn("jobs", "My Jobs", "🏠")}
        {tabBtn("tasks", "Tasks", "✅")}
        {tabBtn("messages", "Messages", "💬")}
      </nav>
    </div>
  );
}
