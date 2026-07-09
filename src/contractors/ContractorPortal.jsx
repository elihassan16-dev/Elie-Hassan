// The contractor-facing portal — what a contractor login sees instead of the app.
// Mirrors the main app's layout: their jobs (properties) listed on the left, and
// the selected job's detail on the right with three tabs — Overview (money, scope,
// docs), Tasks, and Messages. Mobile: list first, tap in, ‹ back.
// RLS guarantees they only ever receive their own company's rows.
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { T } from "../theme";
import { notify, uploadAttachment, qbAuthFetch, uploadStreamVideo, STREAM_VIDEO_CAP } from "../net";
import { useContractorData, jobTotal, jobPaid, jobLeft, jobDays, money, fmtDate, fmtWhen } from "./data";

const TASK_STATUSES = ["Not Started", "In Progress", "Completed", "N/A"];
const stColor = (s) => s === "Completed" ? T.green : s === "In Progress" ? T.blue : s === "N/A" ? "#6b6b70" : T.textSub;
const taskClosed = (s) => s === "Completed" || s === "N/A";
// Same status pill both sides use — a dropdown styled like the app's status chips.
function StatusPill({ t, onSet }) {
  const v = TASK_STATUSES.includes(t.status) ? t.status : "Not Started";
  const c = stColor(v);
  return (
    <select value={v} onChange={(e) => onSet(t, e.target.value)} title="Change status"
      style={{ padding: "3px 6px", borderRadius: 20, border: "none", background: c + "22", color: c, fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
      {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

function useIsMobile(bp = 768) {
  const [m, setM] = useState(typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => { const f = () => setM(window.innerWidth < bp); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [bp]);
  return m;
}

function Att({ att }) {
  if (!att || !att.url) return null;
  if (att.kind === "image") return <a href={att.url} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 6 }}><img src={att.url} alt={att.name || "photo"} style={{ maxWidth: 220, maxHeight: 260, borderRadius: 10, display: "block", objectFit: "cover" }} /></a>;
  if (att.kind === "video" && att.stream) return <iframe src={att.url} title={att.name || "video"} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen style={{ marginTop: 6, width: "min(320px,72vw)", aspectRatio: "16/9", border: "none", borderRadius: 10, display: "block", background: "#000" }} />;
  if (att.kind === "video") return <video src={att.url} controls playsInline preload="metadata" style={{ marginTop: 6, maxWidth: 240, width: "100%", maxHeight: 300, borderRadius: 10, display: "block", background: "#000" }} />;
  if (att.kind === "audio") return <audio src={att.url} controls preload="metadata" style={{ marginTop: 6, width: 240, height: 40 }} />;
  return <a href={att.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, padding: "8px 10px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, textDecoration: "none", color: T.text, maxWidth: 240 }}><span style={{ fontSize: 18 }}>📄</span><span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.name || "Attachment"}</span></a>;
}

const UTIL_DEFS = [["electric", "⚡", "Electric"], ["gas", "🔥", "Gas"], ["water", "💧", "Water"]];
const PERMIT_DEFS = [["building", "🏗", "Building"], ["plumbing", "🚿", "Plumbing"], ["mechanical", "❄️", "Mechanical"], ["electrical", "⚡", "Electrical"]];
// Each permit tracks three stages, each its own dropdown (blank until someone
// sets it): filing → plan review → inspections. Mirrors the Goldstone board.
const PERMIT_COLS = [
  ["permits", "permitsBy", [["", "Filed?"], ["yes", "Filed ✓"], ["na", "Not needed"]]],
  ["permitPlans", "permitPlansBy", [["", "Plans?"], ["approved", "Plans approved ✓"], ["not_approved", "Not approved"]]],
  ["permitInsp", "permitInspBy", [["", "Inspections?"], ["rough", "Rough passed ✓"], ["final", "Final passed ✓"], ["none", "None passed yet"]]],
];
const PERMIT_VAL_COLOR = { yes: ["#15803D", "#EDFBF1"], na: ["#6b6b70", "#E9E9EE"], approved: ["#15803D", "#EDFBF1"], not_approved: ["#B42318", "#FFF0EF"], rough: ["#B45309", "#FFF7E8"], final: ["#15803D", "#EDFBF1"], none: ["#B42318", "#FFF0EF"] };

export function ContractorPortal() {
  const { displayName, contractorOrgId, signOut } = useAuth();
  const { orgs, jobs, tasks, messages, docs, siteStatus, save, error } = useContractorData();
  const isMobile = useIsMobile();
  const org = (orgs || []).find((o) => String(o.id) === String(contractorOrgId)) || null;
  const myJobs = useMemo(() => (jobs || []).filter((j) => j.orgId === contractorOrgId).sort((a, b) => (a.status === "complete") - (b.status === "complete") || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))), [jobs, contractorOrgId]);
  const [selJobId, setSelJobId] = useState(null);
  const [tab, setTab] = useState("overview");
  const [statusOpen, setStatusOpen] = useState(false); // 🏗 site-status popup
  const [err, setErr] = useState("");
  const selJob = myJobs.find((j) => String(j.id) === String(selJobId)) || null;
  // Desktop opens straight into the first job, like the main app's lists.
  useEffect(() => { if (!isMobile && !selJobId && myJobs.length) setSelJobId(myJobs[0].id); }, [isMobile, selJobId, myJobs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unread = Goldstone-side messages I haven't read yet, per job.
  const unreadFor = (jobId) => (messages || []).filter((m) => String(m.jobId) === String(jobId) && m.side === "team" && !(m.readBy || []).includes(displayName)).length;
  // Opening a job's Messages tab marks its Goldstone messages read.
  useEffect(() => {
    if (!selJob || tab !== "messages") return;
    (messages || []).filter((m) => String(m.jobId) === String(selJob.id) && m.side === "team" && !(m.readBy || []).includes(displayName))
      .forEach((m) => { save("contractor_messages", { ...m, readBy: [...(m.readBy || []), displayName] }).catch(() => {}); });
  }, [selJob?.id, tab, (messages || []).length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── shared upload helper (photos, videos, PDFs) ────────────────────────────
  // Videos ride Cloudflare Stream (200 MB, transcoded); other files use storage.
  const [pct, setPct] = useState(0);
  const stage = async (file) => {
    if (!file) return null;
    const isVideo = (file.type || "").startsWith("video/");
    if (isVideo) {
      if (file.size > STREAM_VIDEO_CAP) { setErr("Video is too large (max 200 MB) — trim it shorter and try again."); return null; }
      setErr("");
      try { return await uploadStreamVideo(file, setPct); }
      catch (ex) {
        if (file.size <= 50 * 1024 * 1024) return uploadAttachment(file, "portal");
        throw ex;
      } finally { setPct(0); }
    }
    if (file.size > 25 * 1024 * 1024) { setErr("File is too large (max 25 MB)."); return null; }
    setErr("");
    return uploadAttachment(file, "portal");
  };

  // ── Overview tab ────────────────────────────────────────────────────────────
  const sowRef = useRef(null);
  const [sowBusy, setSowBusy] = useState(false);
  const uploadDoc = async (e) => {
    const file = (e.target.files || [])[0]; e.target.value = "";
    if (!file || !selJob) return;
    setSowBusy(true);
    try {
      const up = await stage(file);
      if (up) {
        await save("contractor_docs", { id: Date.now(), jobId: selJob.id, orgId: contractorOrgId, name: up.name, url: up.url, mime: up.mime, by: displayName, at: new Date().toISOString() });
        notify(null, { toAdmins: true, title: `${org?.name || displayName} uploaded a document`, body: `${up.name} — ${selJob.propertyAddress}` });
      }
    } catch (ex) { setErr(ex.message || "Upload failed."); }
    setSowBusy(false);
  };

  const overview = (j) => {
    const total = jobTotal(j), paid = jobPaid(j), left = jobLeft(j), days = jobDays(j);
    const jobDocs = (docs || []).filter((d) => String(d.jobId) === String(j.id));
    const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
    // Site status is a shared whiteboard: contractors can flip utilities and set
    // permits too — every change is stamped with the name of who made it and
    // Goldstone gets notified.
    const stRow = (siteStatus || []).find((s) => String(s.id) === String(j.propertyId)) || null;
    const st = stRow || { id: String(j.propertyId), address: j.propertyAddress || "", utilities: {}, permits: {}, utilitiesBy: {}, permitsBy: {} };
    const stamp = { by: displayName, at: new Date().toISOString() };
    const writeStatus = async (patch, note) => {
      try {
        await save("site_status", { ...st, ...patch, updatedAt: new Date().toISOString(), updatedBy: displayName });
        if (note) notify(null, { toAdmins: true, title: `Site status — ${j.propertyAddress || ""}`, body: `${note} — ${displayName} (${org?.name || "contractor"})` });
      } catch (ex) { setErr(ex.message || "Couldn't update the status board."); }
    };
    const flipUtil = (u, label) => {
      const on = (st.utilities || {})[u] === "on";
      writeStatus({ utilities: { ...(st.utilities || {}), [u]: on ? "off" : "on" }, utilitiesBy: { ...(st.utilitiesBy || {}), [u]: stamp } }, `${label} turned ${on ? "OFF" : "ON"}`);
    };
    const setPermitCol = (field, byField, k, label, v, opts) => writeStatus(
      { [field]: { ...(st[field] || {}), [k]: v }, [byField]: { ...(st[byField] || {}), [k]: stamp } },
      v ? `${label} permit — ${(opts.find(o => o[0] === v) || [])[1] || v}` : null
    );
    const byCap = (m) => m && m.by ? `${m.by.split(" ")[0]}${m.at ? ` · ${fmtDate(m.at).replace(/, \d{4}$/, "")}` : ""}` : null;
    const sec = (t) => <div style={{ fontSize: 10.5, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", margin: "14px 0 6px" }}>{t}</div>;
    return (
      <div style={{ padding: 14 }}>
        {/* Slim launcher — the board itself is a popup, same as Goldstone's side. */}
        <button onClick={() => setStatusOpen(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: T.card, border: "none", borderRadius: T.radius, boxShadow: T.shadow, padding: "13px 16px", marginBottom: 12, cursor: "pointer", fontFamily: "inherit", textAlign: "left", boxSizing: "border-box" }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>🏗</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, color: T.text }}>Site Status</span>
            <span style={{ display: "block", fontSize: 11, color: T.textSub }}>Utilities, permits & property info — tap to view or update</span>
          </span>
          {UTIL_DEFS.map(([u, icon]) => { const on = (st.utilities || {})[u] === "on"; return <span key={u} title={u} style={{ fontSize: 15, filter: on ? "none" : "grayscale(1)", opacity: on ? 1 : 0.4, flexShrink: 0 }}>{icon}</span>; })}
          <span style={{ fontSize: 15, color: T.textTert, flexShrink: 0 }}>›</span>
        </button>
        {statusOpen && (
          <div onClick={() => setStatusOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 420, backdropFilter: "blur(6px)", padding: 16, boxSizing: "border-box" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "min(580px,94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, background: T.goldLight, flexShrink: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>🏗 Site Status</div>
                  <div style={{ fontSize: 11.5, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.propertyAddress || ""} · Goldstone sees every update</div>
                </div>
                <button onClick={() => setStatusOpen(false)} style={{ background: "none", border: "none", fontSize: 22, color: T.textTert, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>
              <div style={{ padding: "16px 18px", overflowY: "auto" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Utilities</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                  {UTIL_DEFS.map(([u, icon, label]) => {
                    const on = (st.utilities || {})[u] === "on";
                    const cap = byCap((st.utilitiesBy || {})[u]);
                    return (
                      <button key={u} onClick={() => flipUtil(u, label)} style={{ padding: "14px 8px 12px", borderRadius: 14, border: `1.5px solid ${on ? T.green : T.border}`, background: on ? "#EDFBF1" : T.bg, cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                        <span style={{ fontSize: 24, filter: on ? "none" : "grayscale(1)", opacity: on ? 1 : 0.55 }}>{icon}</span>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{label}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: on ? "#15803D" : T.textSub, background: on ? "#D3F3DD" : "#E9E9EE", borderRadius: 12, padding: "2px 10px", letterSpacing: "0.04em" }}>{on ? "ON" : "OFF"}</span>
                        {cap && <span style={{ fontSize: 8.5, fontWeight: 700, color: T.textTert }}>{cap}</span>}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: T.textTert, marginTop: 6 }}>Tap to flip — every change shows who made it.</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", margin: "18px 0 8px" }}>Permits</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {PERMIT_DEFS.map(([k, icon, label]) => {
                    // Attribution = whoever touched any of the three stages last.
                    const latest = PERMIT_COLS.map(([, bf]) => (st[bf] || {})[k]).filter(Boolean).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))[0];
                    const cap = byCap(latest);
                    return (
                      <div key={k} style={{ display: "flex", alignItems: "center", gap: 10, background: T.bg, borderRadius: 12, padding: "9px 12px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 17, flexShrink: 0 }}>{icon}</span>
                        <span style={{ width: 86, flexShrink: 0 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: T.text }}>{label}</span>
                          {cap && <span style={{ display: "block", fontSize: 9, fontWeight: 700, color: T.textTert }}>{cap}</span>}
                        </span>
                        <div style={{ flex: 1, display: "flex", gap: 6, minWidth: 250 }}>
                          {PERMIT_COLS.map(([field, byField, opts]) => {
                            const raw = (st[field] || {})[k] || "";
                            const v = field === "permits" && raw === "no" ? "" : raw; // legacy "Not filed" → blank
                            const [fg, bg] = PERMIT_VAL_COLOR[v] || [T.textSub, "#fff"];
                            return (
                              <select key={field} value={v} onChange={(e) => setPermitCol(field, byField, k, label, e.target.value, opts)}
                                style={{ flex: 1, minWidth: 0, padding: "7px 4px", borderRadius: 10, border: `1px solid ${v ? fg : T.border}`, background: bg, color: v ? fg : T.textTert, fontWeight: 700, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer" }}>
                                {opts.map(([ov, ol]) => <option key={ov} value={ov}>{ol}</option>)}
                              </select>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14, alignItems: "center" }}>
                  {st.info?.parcel && <span style={{ fontSize: 11, fontWeight: 700, color: T.text, background: T.bg, borderRadius: 14, padding: "4px 10px" }}>📐 Block/Lot: {st.info.parcel}</span>}
                  {st.info?.lockbox && <span style={{ fontSize: 11, fontWeight: 700, color: T.text, background: T.bg, borderRadius: 14, padding: "4px 10px" }}>🔒 Lockbox: {st.info.lockbox}</span>}
                  <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(st.address || j.propertyAddress || "")}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: T.blue, borderRadius: 14, padding: "4px 10px", textDecoration: "none" }}>📍 Google Maps</a>
                </div>
                {stRow && stRow.updatedAt && <div style={{ fontSize: 10.5, color: T.textTert, marginTop: 14, textAlign: "right" }}>Updated {fmtWhen(stRow.updatedAt)}{stRow.updatedBy ? ` by ${stRow.updatedBy}` : ""}</div>}
              </div>
            </div>
          </div>
        )}
        <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: 8 }}>
            {[["Contract", money(total)], ["Paid", money(paid)], ["Remaining", money(left)], ["Days", j.status === "complete" ? "Done" : (days == null ? "—" : days)]].map(([l, v], i) => (
              <div key={l} style={{ flex: 1, background: T.bg, borderRadius: 10, padding: "9px 6px", textAlign: "center" }}>
                <div style={{ fontSize: 9.5, fontWeight: 800, color: T.textTert, textTransform: "uppercase" }}>{l}</div>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: i === 2 ? (left > 0 ? T.gold : T.green) : T.text }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ height: 6, background: T.bg, borderRadius: 4, marginTop: 10, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: T.green, borderRadius: 4 }} /></div>
          <div style={{ fontSize: 11, color: T.textTert, marginTop: 4 }}>{pct}% paid{j.startDate ? ` · started ${fmtDate(j.startDate)}` : ""}</div>

          {(j.payments || []).length > 0 && (<>
            {sec("Payments received")}
            {(j.payments || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "4px 0", borderBottom: `1px solid ${T.border}` }}>
                <span style={{ color: T.textSub, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtDate(p.date)}{p.note ? ` · ${p.note}` : ""}</span>
                <b style={{ color: T.green, flexShrink: 0 }}>{money(p.amount)}</b>
              </div>
            ))}
          </>)}

          {(j.changeOrders || []).length > 0 && (<>
            {sec("Change orders")}
            {(j.changeOrders || []).map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "4px 0", borderBottom: `1px solid ${T.border}` }}>
                <span style={{ color: T.textSub, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label || "Change order"}{c.date ? ` · ${fmtDate(c.date)}` : ""}</span>
                <b style={{ flexShrink: 0 }}>{money(c.amount)}</b>
              </div>
            ))}
          </>)}

          {sec("Scope of work")}
          <div style={{ fontSize: 13, color: j.scope ? T.textSub : T.textTert, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{j.scope || "No written scope yet — upload your SOW below or ask Goldstone."}</div>

          {sec("Documents")}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
            {jobDocs.map((d) => <a key={d.id} href={d.url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 16, border: `1px solid ${T.border}`, background: T.bg, color: T.blue, fontSize: 12, fontWeight: 600, textDecoration: "none", maxWidth: 210 }}>📄 <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span></a>)}
            <button onClick={() => sowRef.current && sowRef.current.click()} disabled={sowBusy} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 16, border: `1.5px dashed ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{sowBusy ? "Uploading…" : "＋ Upload document"}</button>
          </div>
        </div>
      </div>
    );
  };

  // ── Tasks tab (scoped to the open job) ──────────────────────────────────────
  const [reqText, setReqText] = useState("");
  const [reqWho, setReqWho] = useState([]); // Goldstone names the request is aimed at ([] = everyone)
  const [roster, setRoster] = useState([]); // Goldstone team names (via /api/team/roster)
  useEffect(() => { qbAuthFetch("/api/team/roster").then((d) => setRoster(d.names || [])).catch(() => {}); }, []);
  const toggleWho = (n) => setReqWho((p) => p.includes(n) ? p.filter((x) => x !== n) : [...p, n]);
  const setTaskStatus = async (t, next) => {
    if (next === (t.status || "Not Started")) return;
    await save("contractor_tasks", { ...t, status: next, statusBy: displayName, doneAt: next === "Completed" ? new Date().toISOString() : null, doneBy: next === "Completed" ? displayName : null });
    notify(null, { toAdmins: true, title: next === "Completed" ? `${org?.name || displayName} completed a task` : `${org?.name || displayName} updated a task`, body: `${t.text} — ${next} · ${selJob?.propertyAddress || ""}` });
  };
  const sendRequest = async () => {
    const txt = reqText.trim(); if (!txt || !selJob) return;
    await save("contractor_tasks", { id: Date.now(), jobId: selJob.id, orgId: contractorOrgId, text: txt, status: "Not Started", direction: "to_team", createdBy: displayName, createdAt: new Date().toISOString(), askedOf: reqWho });
    setReqText(""); setReqWho([]);
    // Aimed at specific people → alert just them; otherwise the whole team.
    const title = `Task request from ${org?.name || displayName}`;
    const body = `${txt} — ${selJob.propertyAddress}`;
    if (reqWho.length) notify(reqWho, { title, body });
    else if (roster.length) notify(roster, { title, body });
    else notify(null, { toAdmins: true, title, body });
  };
  const tasksTab = (j) => {
    const jt = (tasks || []).filter((t) => t.orgId === contractorOrgId && String(t.jobId) === String(j.id));
    const forUs = jt.filter((t) => t.direction !== "to_team").sort((a, b) => taskClosed(a.status) - taskClosed(b.status) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const toTeam = jt.filter((t) => t.direction === "to_team").sort((a, b) => taskClosed(a.status) - taskClosed(b.status) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return (
      <div style={{ padding: 14 }}>
        <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ padding: "11px 14px", fontSize: 12, fontWeight: 800, color: T.gold, textTransform: "uppercase", letterSpacing: "0.05em" }}>Your tasks from Goldstone</div>
          {forUs.length === 0 && <div style={{ padding: "6px 14px 16px", fontSize: 13, color: T.textTert }}>Nothing assigned on this job right now.</div>}
          {forUs.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", borderTop: `1px solid ${T.border}` }}>
              <StatusPill t={t} onSet={setTaskStatus} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.45, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: taskClosed(t.status) ? 0.6 : 1 }}>{t.text}</div>
                <div style={{ fontSize: 11, color: T.textTert, marginTop: 2 }}>{t.createdBy ? `from ${t.createdBy.split(" ")[0]} · ` : ""}{t.createdAt ? fmtDate(t.createdAt) : ""}{(t.statusBy || t.doneBy) ? ` · ${t.status === "Completed" ? "✓ " : ""}${(t.statusBy || t.doneBy).split(" ")[0]}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden" }}>
          <div style={{ padding: "11px 14px", fontSize: 12, fontWeight: 800, color: T.blue, textTransform: "uppercase", letterSpacing: "0.05em" }}>Ask Goldstone for something</div>
          {roster.length > 0 && (
            <div style={{ padding: "0 14px 8px", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: T.textTert, fontWeight: 700 }}>Who are you asking?</span>
              <button onClick={() => setReqWho([])} style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 16, border: `1px solid ${reqWho.length === 0 ? T.gold : T.border}`, background: reqWho.length === 0 ? T.goldLight : "#fff", color: reqWho.length === 0 ? "#8a6d1f" : T.textSub, cursor: "pointer", fontFamily: "inherit" }}>{reqWho.length === 0 ? "✓ " : ""}Everyone</button>
              {roster.map((n) => { const on = reqWho.includes(n); return (
                <button key={n} onClick={() => toggleWho(n)} style={{ fontSize: 11.5, fontWeight: on ? 700 : 600, padding: "4px 11px", borderRadius: 16, border: `1px solid ${on ? T.gold : T.border}`, background: on ? T.goldLight : "#fff", color: on ? "#8a6d1f" : T.textSub, cursor: "pointer", fontFamily: "inherit" }}>{on ? "✓ " : ""}{n.split(" ")[0]}</button>
              ); })}
            </div>
          )}
          <div style={{ padding: "0 14px 12px", display: "flex", gap: 8 }}>
            <input value={reqText} onChange={(e) => setReqText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendRequest()} placeholder="Materials, a decision, a payment…" style={{ flex: 1, minWidth: 0, padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, fontSize: 13.5, fontFamily: "inherit", outline: "none" }} />
            <button onClick={sendRequest} disabled={!reqText.trim()} style={{ padding: "10px 16px", borderRadius: 10, border: "none", background: reqText.trim() ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 13, cursor: reqText.trim() ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}>Send</button>
          </div>
          {toTeam.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", borderTop: `1px solid ${T.border}` }}>
              <StatusPill t={t} onSet={setTaskStatus} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.45, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: taskClosed(t.status) ? 0.6 : 1 }}>{t.text}</div>
                <div style={{ fontSize: 11, color: T.textTert, marginTop: 2 }}>{t.createdAt ? fmtDate(t.createdAt) : ""}{(t.statusBy || t.doneBy) ? ` · ${t.status === "Completed" ? "✓ " : ""}${(t.statusBy || t.doneBy).split(" ")[0]}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── Messages tab (scoped to the open job) ───────────────────────────────────
  // Same toolkit the Goldstone team has: general thread or a specific task,
  // photos/videos (camera or library), files, and 🎤 voice notes.
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msgTarget, setMsgTarget] = useState(null); // {id,text} → tag the message to that task
  const [recOn, setRecOn] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const cancelRef = useRef(false);
  const timerRef = useRef(null);
  const attRef = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => () => clearInterval(timerRef.current), []);
  const thread = selJob ? (messages || []).filter((m) => m.orgId === contractorOrgId && String(m.jobId) === String(selJob.id)).sort((a, b) => String(a.at || "").localeCompare(String(b.at || ""))) : [];
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [thread.length, tab, selJobId]);
  const pickAtt = async (e) => {
    const file = (e.target.files || [])[0]; e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { const up = await stage(file); if (up) setPending(up); } catch (ex) { setErr(ex.message || "Upload failed."); }
    setBusy(false);
  };
  // Voice notes — MediaRecorder, uploaded like any attachment.
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/mp4", "audio/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = []; cancelRef.current = false;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        clearInterval(timerRef.current);
        setRecOn(false); setRecSecs(0);
        if (cancelRef.current) return;
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (!blob.size) return;
        setBusy(true);
        try {
          const ext = /mp4|aac|m4a/.test(mr.mimeType || "") ? "m4a" : "webm";
          setPending(await uploadAttachment(new File([blob], `voice-note-${Date.now()}.${ext}`, { type: blob.type || "audio/webm" }), "portal"));
        } catch { setErr("Couldn't save the voice note."); }
        setBusy(false);
      };
      mrRef.current = mr; mr.start();
      setRecOn(true); setRecSecs(0);
      timerRef.current = setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch { setErr("Microphone access was blocked — allow it in your browser settings."); }
  };
  const stopRec = () => { cancelRef.current = false; if (mrRef.current && mrRef.current.state !== "inactive") mrRef.current.stop(); };
  const cancelRec = () => { cancelRef.current = true; if (mrRef.current && mrRef.current.state !== "inactive") mrRef.current.stop(); };
  const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const sendMsg = async () => {
    const txt = draft.trim();
    if ((!txt && !pending) || !selJob || busy) return;
    const msg = { id: Date.now(), jobId: selJob.id, orgId: contractorOrgId, author: displayName, side: "contractor", text: txt, at: new Date().toISOString(), readBy: [displayName] };
    if (pending) msg.attachment = pending;
    if (msgTarget) { msg.taskRefId = msgTarget.id; msg.taskRefText = msgTarget.text; }
    setDraft(""); setPending(null);
    await save("contractor_messages", msg);
    notify(null, { toAdmins: true, title: `${org?.name || displayName} — ${msgTarget ? msgTarget.text : selJob.propertyAddress}`, body: txt || "(attachment)" });
  };

  // ── Layout ──────────────────────────────────────────────────────────────────
  const showList = !isMobile || !selJob;
  const showDetail = !isMobile || !!selJob;
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
      {(error || err) && <div onClick={() => setErr("")} style={{ background: "#FFF0EF", borderBottom: `1px solid ${T.red}`, color: T.red, fontSize: 12.5, fontWeight: 600, padding: "8px 16px", cursor: "pointer", flexShrink: 0 }}>{err || error}</div>}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Job list (left) */}
        {showList && (
          <div style={{ width: isMobile ? "100%" : 290, flexShrink: 0, display: "flex", flexDirection: "column", borderRight: isMobile ? "none" : `1px solid ${T.border}`, background: T.card, overflow: "hidden" }}>
            <div style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}`, fontSize: 12.5, fontWeight: 800, color: T.textSub }}>Your jobs ({myJobs.length})</div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {myJobs.length === 0 && jobs !== null && <div style={{ padding: 24, textAlign: "center", color: T.textTert, fontSize: 13 }}>No jobs yet. Goldstone will add your first job here.</div>}
              {myJobs.map((j) => {
                const on = String(selJobId) === String(j.id);
                const days = jobDays(j);
                const un = unreadFor(j.id);
                const openT = (tasks || []).filter((t) => String(t.jobId) === String(j.id) && t.direction !== "to_team" && !taskClosed(t.status)).length;
                return (
                  <div key={j.id} onClick={() => { setSelJobId(j.id); setTab("overview"); setMsgTarget(null); setStatusOpen(false); }} style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: on && !isMobile ? T.goldLight : "transparent", opacity: j.status === "complete" ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.propertyAddress || j.title || "Job"}</div>
                        <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.status === "complete" ? "Complete" : days != null ? `Day ${days}` : "Active"} · {money(jobLeft(j))} left{openT ? ` · ${openT} task${openT !== 1 ? "s" : ""}` : ""}</div>
                      </div>
                      {un > 0 && <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: T.red, color: "#fff", fontSize: 11, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{un}</span>}
                      <span style={{ fontSize: 14, color: T.textTert, flexShrink: 0 }}>›</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Detail (right) */}
        {showDetail && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {!selJob
              ? <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: T.textSub, padding: 24, textAlign: "center" }}>
                  <div style={{ fontSize: 30 }}>🏠</div><div style={{ fontSize: 15, fontWeight: 700 }}>Pick a job</div>
                </div>
              : <>
                <div style={{ background: T.card, borderBottom: `1px solid ${T.border}`, padding: "10px 14px 0", flexShrink: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isMobile && <button onClick={() => setSelJobId(null)} style={{ background: "none", border: "none", color: T.gold, fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", padding: "2px 4px", flexShrink: 0 }}>‹</button>}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15.5, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selJob.propertyAddress || selJob.title}</div>
                      {selJob.title && selJob.propertyAddress && <div style={{ fontSize: 11.5, color: T.textSub }}>{selJob.title}</div>}
                    </div>
                    {selJob.status === "complete"
                      ? <span style={{ fontSize: 10, fontWeight: 800, background: T.bg, color: T.textSub, borderRadius: 20, padding: "3px 10px", flexShrink: 0 }}>COMPLETE</span>
                      : jobDays(selJob) != null && <span style={{ fontSize: 10, fontWeight: 800, background: T.goldLight, color: "#8a6d1f", borderRadius: 20, padding: "3px 10px", flexShrink: 0 }}>DAY {jobDays(selJob)}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 2, marginTop: 8 }}>
                    {[["overview", "Overview"], ["tasks", "Tasks"], ["messages", "Messages"]].map(([k, l]) => (
                      <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 16px", border: "none", borderBottom: tab === k ? `2.5px solid ${T.gold}` : "2.5px solid transparent", background: "none", color: tab === k ? T.gold : T.textSub, fontWeight: tab === k ? 800 : 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                        {l}{k === "messages" && unreadFor(selJob.id) > 0 ? ` (${unreadFor(selJob.id)})` : ""}
                      </button>
                    ))}
                  </div>
                </div>
                <div ref={tab === "messages" ? scrollRef : undefined} style={{ flex: 1, overflowY: "auto", display: tab === "messages" ? "flex" : "block", flexDirection: "column" }}>
                  {tab === "overview" && overview(selJob)}
                  {tab === "tasks" && tasksTab(selJob)}
                  {tab === "messages" && (
                    <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                      {thread.length === 0 && <div style={{ textAlign: "center", color: T.textTert, fontSize: 13, padding: "40px 0" }}>No messages yet on this job. Say hello below.</div>}
                      {thread.map((m) => { const mine = m.side === "contractor"; return (
                        <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "86%" }}>
                          <div style={{ fontSize: 10, color: T.textTert, marginBottom: 2, textAlign: mine ? "right" : "left" }}>{m.author || (mine ? "You" : "Goldstone")} · {fmtWhen(m.at)}</div>
                          <div style={{ background: mine ? T.gold : T.card, color: mine ? "#fff" : T.text, borderRadius: 14, padding: "9px 13px", fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", boxShadow: mine ? "none" : T.shadow }}>
                            {m.taskRefText && <div style={{ fontSize: 10.5, fontWeight: 800, marginBottom: 4, color: mine ? "rgba(255,255,255,0.9)" : "#8a6d1f", background: mine ? "rgba(255,255,255,0.18)" : T.goldLight, borderRadius: 10, padding: "2px 8px", display: "inline-block" }}>↳ Task: {m.taskRefText}</div>}
                            {m.taskRefText && <br />}
                            {m.text}
                            <Att att={m.attachment} />
                          </div>
                        </div>
                      ); })}
                    </div>
                  )}
                </div>
                {tab === "messages" && (() => {
                  const openTasks = (tasks || []).filter((t) => String(t.jobId) === String(selJob.id) && !taskClosed(t.status));
                  return (
                  <div style={{ background: T.card, borderTop: `1px solid ${T.border}`, padding: "10px 12px max(10px,env(safe-area-inset-bottom))", flexShrink: 0 }}>
                    {openTasks.length > 0 && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.textTert, flexShrink: 0 }}>Posting to:</span>
                        <button onClick={() => setMsgTarget(null)} style={{ flexShrink: 0, padding: "4px 11px", borderRadius: 14, border: `1px solid ${!msgTarget ? T.gold : T.border}`, background: !msgTarget ? T.goldLight : T.bg, color: !msgTarget ? "#8a6d1f" : T.textSub, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>💬 General</button>
                        {openTasks.map((t) => { const on = msgTarget && String(msgTarget.id) === String(t.id); return (
                          <button key={t.id} onClick={() => setMsgTarget(on ? null : { id: t.id, text: t.text })} title={t.text} style={{ flexShrink: 0, padding: "4px 11px", borderRadius: 14, border: `1px solid ${on ? T.gold : T.border}`, background: on ? T.goldLight : T.bg, color: on ? "#8a6d1f" : T.textSub, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }}>↳ {t.text}</button>
                        ); })}
                      </div>
                    )}
                    {pending && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.goldLight, border: `1px solid ${T.gold}`, borderRadius: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 13 }}>{pending.kind === "image" ? "🖼️" : pending.kind === "video" ? "🎬" : pending.kind === "audio" ? "🎤" : "📄"}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pending.name}</span>
                        <button onClick={() => setPending(null)} style={{ background: "none", border: "none", color: T.textTert, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
                      </div>
                    )}
                    {recOn ? (
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ width: 10, height: 10, borderRadius: "50%", background: T.red, flexShrink: 0, animation: "gsPulse 1s infinite" }} />
                        <style>{`@keyframes gsPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: T.text }}>Recording… {fmtSecs(recSecs)}</span>
                        <button onClick={cancelRec} style={{ padding: "9px 14px", borderRadius: 20, border: `1px solid ${T.border}`, background: T.bg, color: T.textSub, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                        <button onClick={stopRec} style={{ padding: "9px 16px", borderRadius: 20, border: "none", background: T.red, color: "#fff", fontWeight: 800, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>■ Stop</button>
                      </div>
                    ) : (
                    <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                      <input ref={attRef} type="file" accept="image/*,video/*,application/pdf" onChange={pickAtt} style={{ display: "none" }} />
                      <button onClick={() => attRef.current && attRef.current.click()} disabled={busy} title="Attach a photo, video, or PDF" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.bg, fontSize: 17, cursor: "pointer" }}>📎</button>
                      <button onClick={startRec} disabled={busy} title="Record a voice note" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.bg, fontSize: 17, cursor: "pointer" }}>🎤</button>
                      <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }} placeholder={busy ? (pct ? `Uploading video… ${pct}%` : "Uploading…") : msgTarget ? "Reply about this task…" : "Message Goldstone…"} disabled={busy}
                        style={{ flex: 1, minWidth: 0, padding: "11px 14px", borderRadius: 18, border: `1px solid ${msgTarget ? T.gold : T.border}`, background: T.bg, fontSize: 15, outline: "none", fontFamily: "inherit", resize: "none", lineHeight: 1.4, maxHeight: 120, overflowY: "auto", boxSizing: "border-box" }} />
                      <button onClick={sendMsg} disabled={(!draft.trim() && !pending) || busy} style={{ padding: "10px 18px", borderRadius: 22, background: (draft.trim() || pending) && !busy ? T.gold : T.border, border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Send</button>
                    </div>
                    )}
                  </div>
                  );
                })()}
              </>}
          </div>
        )}
      </div>
    </div>
  );
}
