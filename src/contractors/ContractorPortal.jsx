// The contractor-facing portal — what a contractor login sees instead of the app.
// Mirrors the main app's layout: their jobs (properties) listed on the left, and
// the selected job's detail on the right with three tabs — Overview (money, scope,
// docs), Tasks, and Messages. Mobile: list first, tap in, ‹ back.
// RLS guarantees they only ever receive their own company's rows.
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { T } from "../theme";
import { notify, uploadAttachment, qbAuthFetch, STREAM_VIDEO_CAP } from "../net";
import { registerServiceWorker, refreshSubscription, enablePush, notificationsSupported, notificationPermission } from "../push";
import { startVideoUpload, resolveVideoAttachment, videoUploadState, bindCtrVideoMessage, VideoUploadBubble, resumeVideoUploads } from "../videoUpload";
import { useContractorData, jobTotal, jobPaid, jobLeft, jobDays, money, fmtDate, fmtWhen } from "./data";
import { openSowPdf } from "./sowPdf";
import { ContactShareModal, ContactCardBubble } from "../contactShare";

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
  if (!att) return null;
  if (att.kind === "contact" && att.contact) return <ContactCardBubble c={att.contact} mine={false} />;
  // Video still uploading in the background (or failed) — progress bubble instead.
  if (att.kind === "video" && (att.pending || att.failed)) return <VideoUploadBubble att={att} mine={false} />;
  if (!att.url) return null;
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
// Certificate of Occupancy — its own two-way row, mirrored with Goldstone.
const CO_OPTS = [["", "Not set"], ["not_filed", "Not filed"], ["filed", "Filed ✓"], ["inspection", "Inspection scheduled"], ["passed", "Passed ✓"], ["failed", "Not passed"]];
const CO_COLOR = { not_filed: ["#B42318", "#FFF0EF"], filed: ["#15803D", "#EDFBF1"], inspection: ["#B45309", "#FFF7E8"], passed: ["#15803D", "#EDFBF1"], failed: ["#B42318", "#FFF0EF"] };

// Events a contractor can put on the shared schedule (they land on Goldstone's
// calendar too). Inspections carry which trade it's for.
export const EVENT_TYPES = [["rough", "🔎", "Rough inspection"], ["final", "✅", "Final inspection"], ["custom", "🔍", "Custom inspection (name it)"], ["walk", "🚶", "Site walkthrough"], ["delivery", "🚚", "Delivery"], ["other", "📌", "Other"]];
export const EVENT_TRADES = ["Building", "Plumbing", "Mechanical", "Electrical"];
export const eventLabel = (ev) => {
  if (ev.type === "custom") return `${ev.customLabel || "Custom inspection"}${ev.trade ? ` — ${ev.trade}` : ""}`;
  const t = EVENT_TYPES.find((x) => x[0] === ev.type) || EVENT_TYPES[EVENT_TYPES.length - 1];
  return `${t[2]}${ev.trade ? ` — ${ev.trade}` : ""}`;
};
export const eventIcon = (ev) => (EVENT_TYPES.find((x) => x[0] === ev.type) || EVENT_TYPES[EVENT_TYPES.length - 1])[1];
const fmtClock = (t) => { if (!t) return ""; const [h, m] = String(t).split(":"); const d = new Date(); d.setHours(+h, +m || 0); return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };

// The SOW opens as a real PDF (generated on-device) — see ./sowPdf.js.
// An edited scope clears sowPdfUrl, so regenerating picks up the highlights.
export const openScopePdf = (job) => { if (job.sowPdfUrl) window.open(job.sowPdfUrl, "_blank"); else openSowPdf(job); };
const scopeUpdatedRecently = (j) => !!j.scopeEditedAt && (Date.now() - new Date(j.scopeEditedAt).getTime()) < 7 * 86400000;

export function ContractorPortal() {
  const { displayName, contractorOrgId, signOut } = useAuth();
  const { orgs, jobs, tasks, messages, docs, siteStatus, save, error } = useContractorData();
  const isMobile = useIsMobile();
  const org = (orgs || []).find((o) => String(o.id) === String(contractorOrgId)) || null;
  const myJobs = useMemo(() => (jobs || []).filter((j) => j.orgId === contractorOrgId).sort((a, b) => (a.status === "complete") - (b.status === "complete") || String(b.createdAt || "").localeCompare(String(a.createdAt || ""))), [jobs, contractorOrgId]);
  const [selJobId, setSelJobId] = useState(null);
  const [tab, setTab] = useState("overview");
  const [statusOpen, setStatusOpen] = useState(false); // 🏗 site-status popup
  const [evOpen, setEvOpen] = useState(false); // 📅 schedule-an-event form
  const [evDraft, setEvDraft] = useState({ type: "rough", trade: "", date: "", time: "", note: "", customLabel: "" });
  const [coReqOpen, setCoReqOpen] = useState(false); // change-order request form
  const [coReq, setCoReq] = useState({ label: "", amount: "" });
  const [prAmt, setPrAmt] = useState({}); // price drafts for Goldstone-requested COs
  const [bidAmt, setBidAmt] = useState(""); // bid draft on a "price this job" request
  const [pricePop, setPricePop] = useState(false); // contract-price breakdown popup
  const [doneOpen, setDoneOpen] = useState(false); // ✓ completed-tasks popup
  const [err, setErr] = useState("");
  // ── Push notifications ──────────────────────────────────────────────────────
  // Same pipeline the team app uses: register the service worker, silently
  // re-subscribe devices that already said yes, and offer a one-tap opt-in for
  // the rest. The server already targets contractor logins (toOrg), so once a
  // device is registered it gets pinged on new messages, tasks, and scope edits.
  const pushOk = notificationsSupported();
  const [pushPerm, setPushPerm] = useState(pushOk ? notificationPermission() : "unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushHide, setPushHide] = useState(() => { try { return localStorage.getItem("ctrPushDismissed") === "1"; } catch { return false; } });
  useEffect(() => { registerServiceWorker(); if (displayName) refreshSubscription(displayName); resumeVideoUploads(); }, [displayName]);
  const turnOnPush = async () => {
    setPushBusy(true); setErr("");
    try { await enablePush(displayName); setPushPerm("granted"); }
    catch (e) { setErr(e.message || "Couldn't enable notifications."); setPushPerm(pushOk ? notificationPermission() : "unsupported"); }
    setPushBusy(false);
  };
  const dismissPush = () => { setPushHide(true); try { localStorage.setItem("ctrPushDismissed", "1"); } catch { /* private mode */ } };
  const pushWanted = pushOk && pushPerm !== "granted";
  const selJob = myJobs.find((j) => String(j.id) === String(selJobId)) || null;
  // Desktop opens straight into the first job, like the main app's lists.
  useEffect(() => { if (!isMobile && !selJobId && myJobs.length) setSelJobId(myJobs[0].id); }, [isMobile, selJobId, myJobs.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // A bid request is messaging-only until Goldstone accepts the price —
  // no overview/tasks tabs, just the scope + bid card and the thread.
  useEffect(() => { if (selJob && selJob.status === "bid" && tab !== "messages") setTab("messages"); }, [selJob?.id, selJob?.status]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const stage = async (file) => {
    if (!file) return null;
    const isVideo = (file.type || "").startsWith("video/");
    if (isVideo) {
      if (file.size > STREAM_VIDEO_CAP) { setErr("Video is too large (max 5 GB) — trim it shorter and try again."); return null; }
      setErr("");
      // Background upload: the message can go out right away with a placeholder
      // that becomes the playable video once the upload lands.
      return startVideoUpload(file, "portal");
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
                <div style={{ fontSize: 11, fontWeight: 800, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", margin: "18px 0 8px" }}>Certificate of Occupancy</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, background: T.bg, borderRadius: 12, padding: "9px 12px" }}>
                  <span style={{ fontSize: 17, flexShrink: 0 }}>🏛</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: T.text }}>CO</span>
                    {byCap(st.coBy) && <span style={{ display: "block", fontSize: 8.5, fontWeight: 700, color: T.textTert }}>{byCap(st.coBy)}</span>}
                  </span>
                  {(() => { const v = st.co || ""; const [fg, bg] = CO_COLOR[v] || [T.textSub, "#fff"]; return (
                    <select value={v} onChange={(e) => writeStatus({ co: e.target.value, coBy: stamp }, e.target.value ? `Certificate of Occupancy — ${(CO_OPTS.find((o) => o[0] === e.target.value) || [])[1]}` : null)}
                      style={{ flex: 1, maxWidth: 200, minWidth: 0, padding: "7px 4px", borderRadius: 10, border: `1px solid ${v ? fg : T.border}`, background: bg, color: v ? fg : T.textTert, fontWeight: 700, fontSize: 11, fontFamily: "inherit", cursor: "pointer" }}>
                      {CO_OPTS.map(([ov, ol]) => <option key={ov} value={ov}>{ol}</option>)}
                    </select>
                  ); })()}
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
        {/* 📅 Schedule — inspections & walkthroughs land on Goldstone's calendar too. */}
        {(() => {
          const evs = (st.events || []).slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || String(a.time || "").localeCompare(String(b.time || "")));
          const today = new Date(); const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          const upcoming = evs.filter((e) => String(e.date || "") >= todayISO);
          const saveEv = () => {
            if (!evDraft.date) { setErr("Pick a date for the event."); return; }
            if (evDraft.type === "custom" && !evDraft.customLabel.trim()) { setErr("Name the custom inspection."); return; }
            const ev = { id: Date.now(), type: evDraft.type, customLabel: evDraft.type === "custom" ? evDraft.customLabel.trim() : "", trade: ["rough", "final", "custom"].includes(evDraft.type) ? evDraft.trade : "", date: evDraft.date, time: evDraft.time, note: evDraft.note.trim(), by: displayName, orgName: org?.name || "", at: new Date().toISOString() };
            writeStatus({ events: [...(st.events || []), ev] }, `📅 ${eventLabel(ev)} scheduled ${fmtDate(ev.date)}${ev.time ? ` · ${fmtClock(ev.time)}` : ""}${ev.note ? ` — ${ev.note}` : ""}`);
            setEvOpen(false); setEvDraft({ type: "rough", trade: "", date: "", time: "", note: "", customLabel: "" });
          };
          const removeEv = (ev) => writeStatus({ events: (st.events || []).filter((x) => x.id !== ev.id) }, `📅 Cancelled: ${eventLabel(ev)} ${fmtDate(ev.date)}`);
          const selS = { padding: "8px 10px", borderRadius: 10, border: `1px solid ${T.border}`, background: "#fff", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
          return (
            <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, padding: "12px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>📅</span>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 800, color: T.text }}>Schedule</span>
                <button onClick={() => setEvOpen((v) => !v)} style={{ padding: "6px 13px", borderRadius: 16, border: `1px solid ${T.gold}`, background: evOpen ? "#fff" : T.goldLight, color: "#8a6d1f", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{evOpen ? "Cancel" : "+ Add event"}</button>
              </div>
              <div style={{ fontSize: 11, color: T.textSub, marginTop: 2 }}>Inspections, walkthroughs, deliveries — Goldstone sees these on their calendar.</div>
              {evOpen && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, background: T.bg, borderRadius: 12, padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <select value={evDraft.type} onChange={(e) => setEvDraft((d) => ({ ...d, type: e.target.value }))} style={{ ...selS, flex: 1, minWidth: 150 }}>
                      {EVENT_TYPES.map(([v, ic, l]) => <option key={v} value={v}>{ic} {l}</option>)}
                    </select>
                    {evDraft.type === "custom" && (
                      <input value={evDraft.customLabel} onChange={(e) => setEvDraft((d) => ({ ...d, customLabel: e.target.value }))} placeholder="Inspection name — e.g. Fire marshal" style={{ ...selS, flex: 2, minWidth: 170 }} />
                    )}
                    {(evDraft.type === "rough" || evDraft.type === "final" || evDraft.type === "custom") && (
                      <select value={evDraft.trade} onChange={(e) => setEvDraft((d) => ({ ...d, trade: e.target.value }))} style={{ ...selS, flex: 1, minWidth: 120 }}>
                        <option value="">Which trade?</option>
                        {EVENT_TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input type="date" value={evDraft.date} onChange={(e) => setEvDraft((d) => ({ ...d, date: e.target.value }))} style={{ ...selS, flex: 1, minWidth: 130 }} />
                    <input type="time" value={evDraft.time} onChange={(e) => setEvDraft((d) => ({ ...d, time: e.target.value }))} style={{ ...selS, flex: 1, minWidth: 100 }} />
                  </div>
                  <input value={evDraft.note} onChange={(e) => setEvDraft((d) => ({ ...d, note: e.target.value }))} placeholder="Note (optional) — e.g. inspector arriving between 9–11" style={selS} />
                  <button onClick={saveEv} disabled={!evDraft.date} style={{ padding: "9px", borderRadius: 10, border: "none", background: evDraft.date ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 13, cursor: evDraft.date ? "pointer" : "default", fontFamily: "inherit" }}>Add to schedule</button>
                </div>
              )}
              {upcoming.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                  {upcoming.map((ev) => (
                    <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 9, background: T.bg, borderRadius: 10, padding: "8px 11px" }}>
                      <span style={{ fontSize: 15, flexShrink: 0 }}>{eventIcon(ev)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>{eventLabel(ev)}{ev.note ? <span style={{ fontWeight: 400, color: T.textSub }}> — {ev.note}</span> : null}</div>
                        <div style={{ fontSize: 10.5, color: T.textTert }}>{fmtDate(ev.date)}{ev.time ? ` · ${fmtClock(ev.time)}` : ""} · {ev.by ? ev.by.split(" ")[0] : ev.orgName}</div>
                      </div>
                      {ev.orgName === (org?.name || "") && <button onClick={() => removeEv(ev)} title="Cancel this event" style={{ background: "none", border: "none", color: T.textTert, fontSize: 15, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
        <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, padding: "14px 16px" }}>
          {/* Bid request: no money yet — review the scope, send one number. */}
          {j.status === "bid" && (() => {
            const a = Number(String(bidAmt).replace(/[^0-9.]/g, ""));
            const sendBid = async () => {
              if (!a) return;
              try {
                await qbAuthFetch("/api/contractors/co-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: j.id, bidAmount: a }) });
                notify(null, { toAdmins: true, title: `Bid from ${org?.name || displayName}`, body: `${j.propertyAddress || ""}${j.title ? ` — ${j.title}` : ""} · ${money(a)}` });
                setBidAmt("");
              } catch (ex) { setErr(ex.message || "Couldn't send the bid."); }
            };
            return (
              <div style={{ background: T.goldLight, border: `1.5px dashed ${T.gold}`, borderRadius: 12, padding: "11px 13px", marginBottom: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>🧾 Bid request from Goldstone</div>
                {j.bidAmount
                  ? <div style={{ fontSize: 12, color: "#8a6d1f", marginTop: 3 }}>You bid <b>{money(j.bidAmount)}</b>{j.bidAt ? ` on ${fmtDate(j.bidAt)}` : ""} — waiting on Goldstone. You can send an updated number below.</div>
                  : <div style={{ fontSize: 12, color: "#8a6d1f", marginTop: 3 }}>Review the scope of work below and send your price for the whole job.</div>}
                <div style={{ display: "flex", gap: 7, marginTop: 8 }}>
                  <input value={bidAmt} onChange={(e) => setBidAmt(e.target.value)} inputMode="decimal" placeholder="$ your price for this job" style={{ flex: 1, minWidth: 0, padding: "9px 11px", borderRadius: 9, border: `1px solid ${T.border}`, background: "#fff", fontSize: 13.5, fontFamily: "inherit", outline: "none" }} />
                  <button onClick={sendBid} disabled={!a} style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: a ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 13, cursor: a ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}>Send bid</button>
                </div>
              </div>
            );
          })()}
          {j.status !== "bid" && (<>
          <div style={{ display: "flex", gap: 8 }}>
            {[["Contract", money(total)], ["Paid", money(paid)], ["Remaining", money(left)], ["Days", j.status === "complete" ? "Done" : (days == null ? "—" : days)]].map(([l, v], i) => {
              const priceClick = l === "Contract" && (j.changeOrders || []).length > 0;
              return (
                <div key={l} onClick={priceClick ? () => setPricePop(true) : undefined} title={priceClick ? "See the original price + change orders" : undefined} style={{ flex: 1, background: T.bg, borderRadius: 10, padding: "9px 6px", textAlign: "center", cursor: priceClick ? "pointer" : "default" }}>
                  <div style={{ fontSize: 9.5, fontWeight: 800, color: T.textTert, textTransform: "uppercase" }}>{l}</div>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: i === 2 ? (left > 0 ? T.gold : T.green) : T.text, textDecoration: priceClick ? "underline dotted" : "none", textUnderlineOffset: 3 }}>{v}</div>
                </div>
              );
            })}
          </div>
          <div style={{ height: 6, background: T.bg, borderRadius: 4, marginTop: 10, overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: T.green, borderRadius: 4 }} /></div>
          <div style={{ fontSize: 11, color: T.textTert, marginTop: 4 }}>{pct}% paid{j.startDate ? ` · started ${fmtDate(j.startDate)}` : ""}</div>
          {pricePop && (
            <div onClick={() => setPricePop(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 430, backdropFilter: "blur(6px)", padding: 16, boxSizing: "border-box" }}>
              <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 18, width: "min(400px,94vw)", boxShadow: "0 8px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}>
                <div style={{ padding: "13px 17px", borderBottom: `1px solid ${T.border}`, background: T.goldLight, display: "flex", alignItems: "center" }}>
                  <div style={{ flex: 1, fontSize: 14, fontWeight: 800, color: T.text }}>Contract price breakdown</div>
                  <button onClick={() => setPricePop(false)} style={{ background: "none", border: "none", fontSize: 20, color: T.textTert, cursor: "pointer", lineHeight: 1 }}>×</button>
                </div>
                <div style={{ padding: "14px 17px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "6px 0", borderBottom: `1px solid ${T.border}` }}><span style={{ color: T.textSub }}>Original contract</span><b>{money(j.price)}</b></div>
                  {(j.changeOrders || []).map((c) => (
                    <div key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${T.border}` }}>
                      <span style={{ color: T.textSub, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>+ {c.label || "Change order"}{c.date ? ` · ${fmtDate(c.date)}` : ""}</span><b style={{ flexShrink: 0 }}>{money(c.amount)}</b>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5, padding: "9px 0 2px" }}><b>Total</b><b style={{ color: T.gold }}>{money(total)}</b></div>
                </div>
              </div>
            </div>
          )}
          {(() => {
            const reqs = (j.coRequests || []).filter((r) => r.status !== "approved").slice().sort((a, b) => b.id - a.id);
            const amt = Number(String(coReq.amount).replace(/[^0-9.]/g, ""));
            const sendReq = async () => {
              if (!coReq.label.trim() || !amt) return;
              try {
                await qbAuthFetch("/api/contractors/co-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: j.id, label: coReq.label.trim(), amount: amt }) });
                notify(null, { toAdmins: true, title: `Change order request — ${org?.name || displayName}`, body: `${coReq.label.trim()} — ${money(amt)} · ${j.propertyAddress || ""}` });
                setCoReqOpen(false); setCoReq({ label: "", amount: "" });
              } catch (ex) { setErr(ex.message || "Couldn't send the request."); }
            };
            return (<>
              {sec("Change orders")}
              {(j.changeOrders || []).map((c) => (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "5px 0", borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.textSub }}>{c.label || "Change order"}</span>
                  <span style={{ color: T.textTert, fontSize: 11 }}>{c.date ? fmtDate(c.date) : ""}</span><b>{money(c.amount)}</b>
                </div>
              ))}
              {reqs.filter((r) => r.status === "awaiting_price").map((r) => {
                const a = Number(String(prAmt[r.id] || "").replace(/[^0-9.]/g, ""));
                const sendPrice = async () => {
                  if (!a) return;
                  try {
                    await qbAuthFetch("/api/contractors/co-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: j.id, requestId: r.id, amount: a }) });
                    notify(null, { toAdmins: true, title: `${org?.name || displayName} priced a change order`, body: `${r.label} — ${money(a)} · ${j.propertyAddress || ""}` });
                    setPrAmt((p) => ({ ...p, [r.id]: "" }));
                  } catch (ex) { setErr(ex.message || "Couldn't send the price."); }
                };
                return (
                  <div key={r.id} style={{ background: T.goldLight, border: `1.5px dashed ${T.gold}`, borderRadius: 10, padding: "9px 11px", margin: "7px 0" }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text }}>🧾 Goldstone requested: {r.label}</div>
                    <div style={{ fontSize: 10.5, color: "#8a6d1f", marginTop: 1 }}>Asked by {r.askedBy || "Goldstone"}{r.at ? ` · ${fmtDate(r.at)}` : ""} — send your price and they'll approve it.</div>
                    <div style={{ display: "flex", gap: 7, marginTop: 7 }}>
                      <input value={prAmt[r.id] || ""} onChange={(e) => setPrAmt((p) => ({ ...p, [r.id]: e.target.value }))} inputMode="decimal" placeholder="$ your price" style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 9, border: `1px solid ${T.border}`, background: "#fff", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                      <button onClick={sendPrice} disabled={!a} style={{ padding: "8px 15px", borderRadius: 9, border: "none", background: a ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: a ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}>Send price</button>
                    </div>
                  </div>
                );
              })}
              {reqs.filter((r) => r.status !== "awaiting_price").map((r) => {
                const [txt, fg, bg] = r.status === "pending" ? ["Pending approval", "#B45309", "#FDE9C8"] : ["Denied", "#B42318", "#FFE1DE"];
                return (
                  <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "5px 0", borderBottom: `1px solid ${T.border}`, opacity: r.status === "denied" ? 0.65 : 1 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.textSub }}>{r.label}</span>
                    <b>{money(r.amount)}</b>
                    <span style={{ fontSize: 10, fontWeight: 800, color: fg, background: bg, borderRadius: 12, padding: "2px 8px", flexShrink: 0 }}>{txt}</span>
                    <button onClick={() => { setMsgTarget({ id: `co:${r.id}`, text: `🧾 ${r.label}` }); setTab("messages"); }} title="Message Goldstone about this change order" style={{ background: "#fff", border: `1px solid ${T.gold}`, borderRadius: 12, color: "#8a6d1f", cursor: "pointer", fontSize: 12, padding: "3px 8px", flexShrink: 0, fontFamily: "inherit" }}>💬</button>
                  </div>
                );
              })}
              {coReqOpen ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8, background: T.bg, borderRadius: 10, padding: "9px 11px" }}>
                  <input value={coReq.label} onChange={(e) => setCoReq((d) => ({ ...d, label: e.target.value }))} placeholder="What's the extra work? e.g. Replace rotted subfloor" style={{ padding: "8px 10px", borderRadius: 9, border: `1px solid ${T.border}`, background: "#fff", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                  <div style={{ display: "flex", gap: 7 }}>
                    <input value={coReq.amount} onChange={(e) => setCoReq((d) => ({ ...d, amount: e.target.value }))} inputMode="decimal" placeholder="$ amount" style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 9, border: `1px solid ${T.border}`, background: "#fff", fontSize: 13, fontFamily: "inherit", outline: "none" }} />
                    <button onClick={sendReq} disabled={!coReq.label.trim() || !amt} style={{ padding: "8px 16px", borderRadius: 9, border: "none", background: coReq.label.trim() && amt ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Send request</button>
                    <button onClick={() => setCoReqOpen(false)} style={{ padding: "8px 12px", borderRadius: 9, border: `1px solid ${T.border}`, background: "#fff", color: T.textSub, fontWeight: 700, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Cancel</button>
                  </div>
                  <div style={{ fontSize: 10.5, color: T.textTert }}>Goldstone approves or denies it — approval updates the contract price automatically.</div>
                </div>
              ) : (
                <button onClick={() => setCoReqOpen(true)} style={{ marginTop: 8, padding: "8px 14px", borderRadius: 16, border: `1.5px dashed ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>＋ Request a change order</button>
              )}
            </>);
          })()}

          {(j.payments || []).length > 0 && (<>
            {sec("Payments received")}
            {(j.payments || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "4px 0", borderBottom: `1px solid ${T.border}` }}>
                <span style={{ color: T.textSub, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fmtDate(p.date)}{p.note ? ` · ${p.note}` : ""}</span>
                <b style={{ color: T.green, flexShrink: 0 }}>{money(p.amount)}</b>
              </div>
            ))}
          </>)}
          </>)}

          {sec("Scope of work")}
          {(j.scope || j.sowPdfUrl)
            ? <button onClick={() => openScopePdf(j)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 15px", borderRadius: 12, border: `1px solid ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                📄 Open to view scope of work (PDF)
                {scopeUpdatedRecently(j) && <span style={{ fontSize: 9, fontWeight: 800, color: "#fff", background: T.red, borderRadius: 10, padding: "2px 7px", letterSpacing: "0.04em" }}>UPDATED</span>}
              </button>
            : <div style={{ fontSize: 13, color: T.textTert, lineHeight: 1.5 }}>No written scope yet — upload your SOW below or ask Goldstone.</div>}

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
    // Completed tasks are tucked into the ✓ popup instead of cluttering the lists.
    const done = jt.filter((t) => t.status === "Completed").sort((a, b) => String(b.doneAt || "").localeCompare(String(a.doneAt || "")));
    const forUs = jt.filter((t) => t.direction !== "to_team" && t.status !== "Completed").sort((a, b) => taskClosed(a.status) - taskClosed(b.status) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const toTeam = jt.filter((t) => t.direction === "to_team" && t.status !== "Completed").sort((a, b) => taskClosed(a.status) - taskClosed(b.status) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    return (
      <div style={{ padding: 14 }}>
        {done.length > 0 && (
          <button onClick={() => setDoneOpen(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "11px 14px", marginBottom: 12, borderRadius: T.radius, border: `1.5px solid ${T.green}`, background: "#EDFBF1", cursor: "pointer", fontFamily: "inherit", boxShadow: T.shadow, textAlign: "left", boxSizing: "border-box" }}>
            <span style={{ fontSize: 17, flexShrink: 0 }}>✓</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: T.text }}>Completed tasks</span>
              <span style={{ display: "block", fontSize: 11, color: "#15803D" }}>{done.length} done on this job — tap to review</span>
            </span>
            <span style={{ fontSize: 14, color: "#15803D", flexShrink: 0 }}>›</span>
          </button>
        )}
        {doneOpen && (
          <div onClick={() => setDoneOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 430, backdropFilter: "blur(6px)", padding: 16, boxSizing: "border-box" }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 20, width: "min(520px,94vw)", maxHeight: "84vh", display: "flex", flexDirection: "column", boxShadow: "0 8px 40px rgba(0,0,0,0.2)", overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10, background: "#EDFBF1", flexShrink: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>✓ Completed tasks</div>
                  <div style={{ fontSize: 11.5, color: "#15803D" }}>{j.propertyAddress || ""}</div>
                </div>
                <button onClick={() => setDoneOpen(false)} style={{ background: "none", border: "none", fontSize: 22, color: T.textTert, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {done.length === 0 && <div style={{ padding: "26px 16px", textAlign: "center", color: T.textTert, fontSize: 13 }}>Nothing completed yet.</div>}
                {done.map((t) => (
                  <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "11px 16px", borderBottom: `1px solid ${T.border}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.4 }}>{t.text}</div>
                      <div style={{ fontSize: 11, color: T.textSub, marginTop: 2 }}>
                        {t.direction === "to_team" ? "Your request to Goldstone" : `From ${t.createdBy ? t.createdBy.split(" ")[0] : "Goldstone"}`}
                        {t.createdAt ? ` · ${fmtDate(t.createdAt)}` : ""}
                        {(t.doneBy || t.statusBy) ? ` · ✓ ${(t.doneBy || t.statusBy).split(" ")[0]}${t.doneAt ? ` ${fmtDate(t.doneAt)}` : ""}` : ""}
                      </div>
                    </div>
                    <button onClick={() => setTaskStatus(t, "Not Started")} title="Put it back on the list" style={{ padding: "6px 12px", borderRadius: 16, border: `1px solid ${T.gold}`, background: T.goldLight, color: "#8a6d1f", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>↩ Restore</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div style={{ background: T.card, borderRadius: T.radius, boxShadow: T.shadow, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ padding: "11px 14px", fontSize: 12, fontWeight: 800, color: T.gold, textTransform: "uppercase", letterSpacing: "0.05em" }}>Your tasks from Goldstone</div>
          {forUs.length === 0 && <div style={{ padding: "6px 14px 16px", fontSize: 13, color: T.textTert }}>Nothing assigned on this job right now.</div>}
          {forUs.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "11px 14px", borderTop: `1px solid ${T.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.45, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: taskClosed(t.status) ? 0.6 : 1 }}>{t.text}</div>
                <div style={{ fontSize: 11, color: T.textTert, marginTop: 2 }}>{t.createdBy ? `from ${t.createdBy.split(" ")[0]} · ` : ""}{t.createdAt ? fmtDate(t.createdAt) : ""}{(t.statusBy || t.doneBy) ? ` · ${t.status === "Completed" ? "✓ " : ""}${(t.statusBy || t.doneBy).split(" ")[0]}` : ""}</div>
              </div>
              <button onClick={() => { setMsgTarget({ id: t.id, text: t.text }); setTab("messages"); }} title="Message Goldstone about this task" style={{ background: "#fff", border: `1px solid ${T.gold}`, borderRadius: 12, color: "#8a6d1f", cursor: "pointer", fontSize: 12, padding: "4px 9px", flexShrink: 0, fontFamily: "inherit" }}>💬</button>
              <StatusPill t={t} onSet={setTaskStatus} />
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
            <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "11px 14px", borderTop: `1px solid ${T.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: T.text, lineHeight: 1.45, textDecoration: t.status === "Completed" ? "line-through" : "none", opacity: taskClosed(t.status) ? 0.6 : 1 }}>{t.text}</div>
                <div style={{ fontSize: 11, color: T.textTert, marginTop: 2 }}>{t.createdAt ? fmtDate(t.createdAt) : ""}{(t.statusBy || t.doneBy) ? ` · ${t.status === "Completed" ? "✓ " : ""}${(t.statusBy || t.doneBy).split(" ")[0]}` : ""}</div>
              </div>
              <button onClick={() => { setMsgTarget({ id: t.id, text: t.text }); setTab("messages"); }} title="Message Goldstone about this request" style={{ background: "#fff", border: `1px solid ${T.gold}`, borderRadius: 12, color: "#8a6d1f", cursor: "pointer", fontSize: 12, padding: "4px 9px", flexShrink: 0, fontFamily: "inherit" }}>💬</button>
              <StatusPill t={t} onSet={setTaskStatus} />
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
  const [replyTo, setReplyTo] = useState(null); // {id,author,text} → quote-reply to a message
  const [msgTags, setMsgTags] = useState([]); // Goldstone names to tag ([] = everyone)
  const [tagOpen, setTagOpen] = useState(false);
  const [contactShare, setContactShare] = useState(false); // 👤 share a contact card
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
    if (pending && pending.uploadId && videoUploadState(pending.uploadId)?.status === "failed") { setErr("The video didn't upload — remove it (×) and try again."); return; }
    const msg = { id: Date.now(), jobId: selJob.id, orgId: contractorOrgId, author: displayName, side: "contractor", text: txt, at: new Date().toISOString(), readBy: [displayName] };
    if (pending) msg.attachment = resolveVideoAttachment(pending);
    if (msgTarget) { msg.taskRefId = msgTarget.id; msg.taskRefText = msgTarget.text; }
    if (replyTo) msg.replyTo = { id: replyTo.id, author: replyTo.author, text: (replyTo.text || (replyTo.attachment ? "📎 attachment" : "")).slice(0, 140) };
    if (msgTags.length) msg.mentions = msgTags;
    setDraft(""); setPending(null); setReplyTo(null); setMsgTags([]); setTagOpen(false);
    await save("contractor_messages", msg);
    if (msg.attachment && msg.attachment.pending && msg.attachment.uploadId) bindCtrVideoMessage(msg.attachment.uploadId, msg.id);
    // Tagged specific Goldstone people → alert just them; otherwise the admins.
    const title = `${org?.name || displayName} — ${msgTarget ? msgTarget.text : selJob.propertyAddress}`;
    const body = txt || "(attachment)";
    if (msgTags.length) notify(msgTags, { title, body });
    else notify(null, { toAdmins: true, title, body });
  };

  // ── Layout ──────────────────────────────────────────────────────────────────
  const showList = !isMobile || !selJob;
  const showDetail = !isMobile || !!selJob;
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: T.bg, fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif" }}>
      <input ref={sowRef} type="file" accept="application/pdf,image/*" onChange={uploadDoc} style={{ display: "none" }} />
      {/* Header */}
      <div style={{ background: T.card, borderBottom: `1px solid ${T.border}`, padding: "max(10px,env(safe-area-inset-top)) 16px 10px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <img src="/logo.png" alt="Goldstone Properties" style={{ height: 42, width: "auto", display: "block", filter: "contrast(1.15) saturate(1.1)", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{org?.name || "Contractor Portal"}</div>
          <div style={{ fontSize: 11, color: T.textSub }}>Goldstone Properties · {displayName}</div>
        </div>
        {pushWanted && <button onClick={turnOnPush} disabled={pushBusy} title="Turn on notifications" style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 8, color: T.textSub, cursor: "pointer", fontFamily: "inherit", fontSize: 15, padding: "5px 9px", flexShrink: 0, opacity: pushBusy ? 0.5 : 1 }}>{pushBusy ? "⏳" : "🔔"}</button>}
        <button onClick={signOut} style={{ background: "none", border: `1px solid ${T.border}`, borderRadius: 8, color: T.textSub, cursor: "pointer", fontFamily: "inherit", fontSize: 12, padding: "6px 10px", flexShrink: 0 }}>Sign out</button>
      </div>
      {pushWanted && !pushHide && (
        <div style={{ background: T.goldLight, borderBottom: `1px solid ${T.gold}`, padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>🔔</span>
          <div style={{ flex: 1, fontSize: 12.5, color: T.text, fontWeight: 600 }}>Get notified when Goldstone messages you or sends a task.</div>
          <button onClick={turnOnPush} disabled={pushBusy} style={{ background: T.gold, border: "none", borderRadius: 8, color: "#1a1a1e", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 800, padding: "6px 12px", flexShrink: 0, opacity: pushBusy ? 0.6 : 1 }}>{pushBusy ? "…" : "Turn on"}</button>
          <button onClick={dismissPush} title="Dismiss" style={{ background: "none", border: "none", color: T.textSub, cursor: "pointer", fontFamily: "inherit", fontSize: 15, padding: "2px 4px", flexShrink: 0 }}>×</button>
        </div>
      )}
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
                  <div key={j.id} onClick={() => { setSelJobId(j.id); setTab("overview"); setMsgTarget(null); setReplyTo(null); setMsgTags([]); setTagOpen(false); setStatusOpen(false); setEvOpen(false); setCoReqOpen(false); setPricePop(false); setDoneOpen(false); setBidAmt(""); }} style={{ padding: "12px 14px", borderBottom: `1px solid ${T.border}`, cursor: "pointer", background: on && !isMobile ? T.goldLight : "transparent", opacity: j.status === "complete" ? 0.6 : 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.propertyAddress || j.title || "Job"}</div>
                        <div style={{ fontSize: 11.5, color: T.textSub, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.status === "bid" ? `🧾 Bid request${j.bidAmount ? ` — you bid ${money(j.bidAmount)}` : " — send your price"}` : `${j.status === "complete" ? "Complete" : days != null ? `Day ${days}` : "Active"} · ${money(jobLeft(j))} left${openT ? ` · ${openT} task${openT !== 1 ? "s" : ""}` : ""}`}</div>
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
                      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                        <span style={{ fontSize: 15.5, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selJob.propertyAddress || selJob.title}</span>
                        {selJob.propertyAddress && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selJob.propertyAddress)}`} target="_blank" rel="noreferrer" title="Open in Google Maps" style={{ fontSize: 13, textDecoration: "none", flexShrink: 0 }}>📍</a>}
                      </div>
                      {selJob.title && selJob.propertyAddress && <div style={{ fontSize: 11.5, color: T.textSub }}>{selJob.title}</div>}
                    </div>
                    {selJob.status === "complete"
                      ? <span style={{ fontSize: 10, fontWeight: 800, background: T.bg, color: T.textSub, borderRadius: 20, padding: "3px 10px", flexShrink: 0 }}>COMPLETE</span>
                      : jobDays(selJob) != null && <span style={{ fontSize: 10, fontWeight: 800, background: T.goldLight, color: "#8a6d1f", borderRadius: 20, padding: "3px 10px", flexShrink: 0 }}>DAY {jobDays(selJob)}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 2, marginTop: 8 }}>
                    {(selJob.status === "bid" ? [["messages", "Messages"]] : [["overview", "Overview"], ["tasks", "Tasks"], ["messages", "Messages"]]).map(([k, l]) => (
                      <button key={k} onClick={() => setTab(k)} style={{ padding: "8px 16px", border: "none", borderBottom: tab === k ? `2.5px solid ${T.gold}` : "2.5px solid transparent", background: "none", color: tab === k ? T.gold : T.textSub, fontWeight: tab === k ? 800 : 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                        {l}{k === "messages" && unreadFor(selJob.id) > 0 ? ` (${unreadFor(selJob.id)})` : ""}
                      </button>
                    ))}
                  </div>
                </div>
                <div ref={tab === "messages" ? scrollRef : undefined} style={{ flex: 1, overflowY: "auto", display: tab === "messages" ? "flex" : "block", flexDirection: "column" }}>
                  {tab === "overview" && overview(selJob)}
                  {tab === "tasks" && tasksTab(selJob)}
                  {tab === "messages" && (() => {
                    // Same look as the Goldstone side: each conversation (general
                    // thread / task / change order) gets its own card, with a header
                    // tag, ↩ Reply under every message, and read receipts.
                    const groups = [];
                    const byKey = new Map();
                    thread.forEach((m) => {
                      const k = m.taskRefId ? String(m.taskRefId) : "general";
                      if (!byKey.has(k)) { const g = { key: k, label: m.taskRefText || null, msgs: [] }; byKey.set(k, g); groups.push(g); }
                      const g = byKey.get(k);
                      if (m.taskRefText && !g.label) g.label = m.taskRefText;
                      g.msgs.push(m);
                    });
                    groups.sort((a, b) => String(a.msgs[a.msgs.length - 1].at || "").localeCompare(String(b.msgs[b.msgs.length - 1].at || "")));
                    return (
                      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                        {/* Bid request: everything they need lives right here — the
                            scope (printable), address/maps/lockbox, and the bid box. */}
                        {selJob.status === "bid" && (() => {
                          const stRow2 = (siteStatus || []).find((s) => String(s.id) === String(selJob.propertyId)) || null;
                          const a = Number(String(bidAmt).replace(/[^0-9.]/g, ""));
                          const sendBid = async () => {
                            if (!a) return;
                            try {
                              await qbAuthFetch("/api/contractors/co-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: selJob.id, bidAmount: a }) });
                              notify(null, { toAdmins: true, title: `Bid from ${org?.name || displayName}`, body: `${selJob.propertyAddress || ""}${selJob.title ? ` — ${selJob.title}` : ""} · ${money(a)}` });
                              setBidAmt("");
                            } catch (ex) { setErr(ex.message || "Couldn't send the bid."); }
                          };
                          return (
                            <div style={{ background: T.card, borderRadius: 16, boxShadow: T.shadow, border: `1.5px dashed ${T.gold}`, padding: "12px 14px" }}>
                              <div style={{ fontSize: 14, fontWeight: 800, color: T.text }}>🧾 Bid request from Goldstone{selJob.title ? ` — ${selJob.title}` : ""}</div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 7 }}>
                                <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selJob.propertyAddress || "")}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: T.blue, borderRadius: 14, padding: "4px 10px", textDecoration: "none" }}>📍 {selJob.propertyAddress || "Google Maps"}</a>
                                {stRow2?.info?.lockbox && <span style={{ fontSize: 11, fontWeight: 700, color: T.text, background: T.bg, borderRadius: 14, padding: "4px 10px" }}>🔒 Lockbox: {stRow2.info.lockbox}</span>}
                              </div>
                              {(selJob.scope || selJob.sowPdfUrl) && (
                                <div onClick={() => openScopePdf(selJob)} style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 9, padding: "11px 13px", borderRadius: 12, border: `1px solid ${T.gold}`, background: T.bg, cursor: "pointer" }}>
                                  <span style={{ fontSize: 20, flexShrink: 0 }}>📄</span>
                                  <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: T.text }}>Open to view Scope of Work (PDF){scopeUpdatedRecently(selJob) && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "#fff", background: T.red, borderRadius: 10, padding: "2px 7px", letterSpacing: "0.04em", verticalAlign: "middle" }}>UPDATED</span>}</span>
                                    <span style={{ display: "block", fontSize: 11, color: T.textSub }}>{scopeUpdatedRecently(selJob) ? "The scope changed — highlighted lines are new" : "Everything to price is in here"}</span>
                                  </span>
                                  <span style={{ fontSize: 14, color: T.gold, flexShrink: 0 }}>›</span>
                                </div>
                              )}
                              {selJob.bidAmount
                                ? <div style={{ fontSize: 12, color: "#8a6d1f", marginTop: 8 }}>You bid <b>{money(selJob.bidAmount)}</b>{selJob.bidAt ? ` on ${fmtDate(selJob.bidAt)}` : ""} — waiting on Goldstone. You can send an updated number below.</div>
                                : <div style={{ fontSize: 12, color: "#8a6d1f", marginTop: 8 }}>Review the scope and send your price for the whole job — once Goldstone accepts, the full job (tasks, payments, status board) opens up here.</div>}
                              <div style={{ display: "flex", gap: 7, marginTop: 7 }}>
                                <input value={bidAmt} onChange={(e) => setBidAmt(e.target.value)} inputMode="decimal" placeholder="$ your price for this job" style={{ flex: 1, minWidth: 0, padding: "9px 11px", borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, fontSize: 13.5, fontFamily: "inherit", outline: "none" }} />
                                <button onClick={sendBid} disabled={!a} style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: a ? T.gold : T.border, color: "#fff", fontWeight: 700, fontSize: 13, cursor: a ? "pointer" : "default", fontFamily: "inherit", flexShrink: 0 }}>Send bid</button>
                              </div>
                            </div>
                          );
                        })()}
                        {thread.length === 0 && selJob.status !== "bid" && <div style={{ textAlign: "center", color: T.textTert, fontSize: 13, padding: "40px 0" }}>No messages yet on this job. Say hello below.</div>}
                        {groups.map((g) => (
                          <div key={g.key} style={{ background: T.card, borderRadius: 16, boxShadow: T.shadow, padding: "10px 12px" }}>
                            <div style={{ marginBottom: 9 }}>
                              {g.key === "general"
                                ? <span style={{ fontSize: 9, fontWeight: 700, color: T.textSub, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 20, padding: "2px 8px", textTransform: "uppercase", letterSpacing: "0.04em" }}>💬 General thread</span>
                                : <span style={{ fontSize: 9.5, fontWeight: 800, color: "#8a6d1f", background: T.goldLight, border: `1px solid ${T.gold}`, borderRadius: 20, padding: "2px 8px", maxWidth: "94%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block" }}>↳ {g.label || "Task"}</span>}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                              {g.msgs.map((m) => {
                                const mine = m.side === "contractor";
                                const readers = (m.readBy || []).filter((n) => n && n !== m.author).map((n) => String(n).split(" ")[0]);
                                return (
                                  <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "88%", display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                                    <div style={{ fontSize: 10, color: T.textTert, marginBottom: 2 }}>
                                      {m.author || (mine ? "You" : "Goldstone")}{m.mentions && m.mentions.length ? ` → ${m.mentions.map((n) => n.split(" ")[0]).join(", ")}` : ""} · {fmtWhen(m.at)}
                                    </div>
                                    <div style={{ background: mine ? T.gold : T.bg, color: mine ? "#fff" : T.text, borderRadius: 14, padding: "9px 13px", fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", border: mine ? "none" : `1px solid ${T.border}` }}>
                                      {m.replyTo && <div style={{ fontSize: 11.5, marginBottom: 5, padding: "5px 9px", borderLeft: `3px solid ${mine ? "rgba(255,255,255,0.6)" : T.gold}`, borderRadius: 6, background: mine ? "rgba(255,255,255,0.15)" : "#fff", color: mine ? "rgba(255,255,255,0.92)" : T.textSub, overflow: "hidden" }}><b>{(m.replyTo.author || "").split(" ")[0]}</b>: {m.replyTo.text}</div>}
                                      {m.text}
                                      <Att att={m.attachment} />
                                    </div>
                                    <button onClick={() => setReplyTo(m)} style={{ background: "none", border: "none", color: replyTo && replyTo.id === m.id ? T.gold : T.textTert, cursor: "pointer", fontSize: 11, fontFamily: "inherit", padding: "3px 2px 0", fontWeight: 600 }}>↩ Reply</button>
                                    {mine && (
                                      <div title={readers.length ? `Read by ${readers.join(", ")}` : "Delivered — not read yet"} style={{ fontSize: 10, fontWeight: 600, color: readers.length ? T.blue : T.textTert, marginTop: 1 }}>
                                        {readers.length === 0 ? "✓ Sent" : `✓✓ Read${readers.length <= 2 ? " by " + readers.join(", ") : ` by ${readers.length}`}`}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
                {tab === "messages" && (() => {
                  const openTasks = (tasks || []).filter((t) => String(t.jobId) === String(selJob.id) && !taskClosed(t.status));
                  // Change orders are message targets too — tag a message to one.
                  const openCos = (selJob.coRequests || []).filter((r) => r.status === "pending" || r.status === "awaiting_price").map((r) => ({ id: `co:${r.id}`, text: `🧾 ${r.label}` }));
                  const targets = [...openTasks.map((t) => ({ id: t.id, text: t.text, label: `↳ ${t.text}` })), ...openCos.map((c) => ({ id: c.id, text: c.text, label: c.text }))];
                  return (
                  <div style={{ background: T.card, borderTop: `1px solid ${T.border}`, padding: "10px 12px max(10px,env(safe-area-inset-bottom))", flexShrink: 0 }}>
                    {targets.length > 0 && (
                      <div style={{ display: "flex", gap: 6, alignItems: "center", overflowX: "auto", marginBottom: 8, paddingBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.textTert, flexShrink: 0 }}>Posting to:</span>
                        <button onClick={() => setMsgTarget(null)} style={{ flexShrink: 0, padding: "4px 11px", borderRadius: 14, border: `1px solid ${!msgTarget ? T.gold : T.border}`, background: !msgTarget ? T.goldLight : T.bg, color: !msgTarget ? "#8a6d1f" : T.textSub, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>💬 General</button>
                        {targets.map((t) => { const on = msgTarget && String(msgTarget.id) === String(t.id); return (
                          <button key={t.id} onClick={() => setMsgTarget(on ? null : { id: t.id, text: t.text })} title={t.text} style={{ flexShrink: 0, padding: "4px 11px", borderRadius: 14, border: `1px solid ${on ? T.gold : T.border}`, background: on ? T.goldLight : T.bg, color: on ? "#8a6d1f" : T.textSub, fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</button>
                        ); })}
                      </div>
                    )}
                    {replyTo && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.bg, borderLeft: `3px solid ${T.gold}`, borderRadius: 8, marginBottom: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↩ Replying to <b>{(replyTo.author || "").split(" ")[0]}</b>: {replyTo.text || (replyTo.attachment ? "📎 attachment" : "")}</span>
                        <button onClick={() => setReplyTo(null)} style={{ background: "none", border: "none", color: T.textTert, fontSize: 16, cursor: "pointer", lineHeight: 1 }}>×</button>
                      </div>
                    )}
                    {tagOpen && roster.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.textTert }}>Notify:</span>
                        <button onClick={() => setMsgTags([])} style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 16, border: `1px solid ${msgTags.length === 0 ? T.gold : T.border}`, background: msgTags.length === 0 ? T.goldLight : "#fff", color: msgTags.length === 0 ? "#8a6d1f" : T.textSub, cursor: "pointer", fontFamily: "inherit" }}>{msgTags.length === 0 ? "✓ " : ""}Everyone</button>
                        {roster.map((n) => { const on = msgTags.includes(n); return (
                          <button key={n} onClick={() => setMsgTags((p) => on ? p.filter((x) => x !== n) : [...p, n])} style={{ fontSize: 11.5, fontWeight: on ? 700 : 600, padding: "4px 11px", borderRadius: 16, border: `1px solid ${on ? T.gold : T.border}`, background: on ? T.goldLight : "#fff", color: on ? "#8a6d1f" : T.textSub, cursor: "pointer", fontFamily: "inherit" }}>{on ? "✓ " : ""}{n.split(" ")[0]}</button>
                        ); })}
                      </div>
                    )}
                    {pending && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: T.goldLight, border: `1px solid ${T.gold}`, borderRadius: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 13 }}>{pending.kind === "image" ? "🖼️" : pending.kind === "video" ? "🎬" : pending.kind === "audio" ? "🎤" : pending.kind === "contact" ? "👤" : "📄"}</span>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pending.name}{pending.pending ? " — uploading in background, OK to send" : ""}</span>
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
                      {roster.length > 0 && <button onClick={() => setTagOpen((v) => !v)} disabled={busy} title="Tag specific Goldstone people" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", border: `1px solid ${msgTags.length ? T.gold : T.border}`, background: msgTags.length ? T.goldLight : T.bg, fontSize: 17, cursor: "pointer" }}>👥</button>}
                      <button onClick={() => setContactShare(true)} disabled={busy} title="Share a contact card" style={{ width: 40, height: 40, flexShrink: 0, borderRadius: "50%", border: `1px solid ${T.border}`, background: T.bg, fontSize: 17, cursor: "pointer" }}>👤</button>
                      <textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }} placeholder={busy ? "Uploading…" : msgTarget ? "Reply about this task…" : "Message Goldstone…"} disabled={busy}
                        style={{ flex: 1, minWidth: 0, padding: "11px 14px", borderRadius: 18, border: `1px solid ${msgTarget ? T.gold : T.border}`, background: T.bg, fontSize: 15, outline: "none", fontFamily: "inherit", resize: "none", lineHeight: 1.4, maxHeight: 120, overflowY: "auto", boxSizing: "border-box" }} />
                      <button onClick={sendMsg} disabled={(!draft.trim() && !pending) || busy} style={{ padding: "10px 18px", borderRadius: 22, background: (draft.trim() || pending) && !busy ? T.gold : T.border, border: "none", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Send</button>
                    </div>
                    )}
                    {contactShare && <ContactShareModal onPick={(c) => { setPending({ kind: "contact", url: "contact:", name: c.name, mime: "text/vcard", contact: c }); setContactShare(false); }} onClose={() => setContactShare(false)} />}
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
