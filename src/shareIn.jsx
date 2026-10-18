// 📤 Share → Goldstone (Elie approved 10/18/26). Photos / videos / PDFs shared
// from any app (Photos, WhatsApp, Files…) through the phone's share sheet land
// here. Team: pick a property → 🎥 Make a punch list (videos, same engine as
// Walkthrough) / 🖼 Add to Media / 💬 Send in a chat (the property's team chat,
// or a contractor's job chat). Contractors: pick one of THEIR jobs → it posts in
// that job's chat. Native side: ios/App/ShareExtension (App Group
// group.com.gpflips.app) + Android intent filters, read by
// @capgo/capacitor-share-target. Old app builds never see any of this.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { isNative } from "./native";
import { T } from "./theme";
import { notify } from "./net";
import { startMediaUpload, bindCtrVideoMessage } from "./videoUpload";
import { uploadToMedia } from "./mediaStore";
import { startWalkClips } from "./walkthrough";
import { useData } from "./data/DataProvider";

// ── Incoming shares (module store — a share can arrive before React mounts) ──
let incoming = null; // { id, raw: [{uri,name,mimeType}], texts, files: File[]|null, loading, error }
const subs = new Set();
const emit = () => subs.forEach((fn) => fn(incoming));
let started = false;

const plugin = (name) => { try { const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]; return P ? { P } : null; } catch { return null; } };

export function startShareIn() {
  if (started || !isNative()) return;
  const st = plugin("CapacitorShareTarget");
  if (!st) return; // older app build
  started = true;
  try {
    st.P.addListener("shareReceived", (ev) => {
      const raw = ((ev && ev.files) || []).filter((f) => f && f.uri);
      if (!raw.length) return; // text-only shares aren't used yet
      incoming = { id: Date.now(), raw, texts: (ev && ev.texts) || [], files: null, loading: true, error: "" };
      emit();
      loadFiles(incoming);
    });
  } catch { started = false; }
}

const b64ToBytes = (b64) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
// Read a shared file in 3 MB pieces (a big video never sits in memory as one
// giant string), then delete the copy the share left behind.
async function readOne(fs, f) {
  const path = /^\//.test(f.uri) ? "file://" + f.uri : f.uri;
  const parts = [];
  await new Promise((resolve, reject) => {
    fs.readFileInChunks({ path, chunkSize: 3 * 1024 * 1024 }, (chunk, err) => {
      if (err) { reject(err); return; }
      const d = chunk && chunk.data;
      if (!d) { resolve(); return; } // "" = end of file
      try { parts.push(typeof d === "string" ? b64ToBytes(d) : d); } catch (e) { reject(e); }
    }).catch(reject);
  });
  try { await fs.deleteFile({ path }); } catch { /* the OS cleans it later */ }
  const type = f.mimeType || "application/octet-stream";
  const name = f.name || (type.startsWith("video/") ? "video.mp4" : type.startsWith("image/") ? "photo.jpg" : "file");
  return new File(parts, name, { type });
}
async function loadFiles(item) {
  try {
    const { Filesystem } = await import("@capacitor/filesystem");
    const files = [];
    for (const f of item.raw) files.push(await readOne(Filesystem, f));
    if (incoming && incoming.id === item.id) { incoming = { ...incoming, files, loading: false }; emit(); }
  } catch (e) {
    if (incoming && incoming.id === item.id) { incoming = { ...incoming, loading: false, error: "Couldn't open what you shared — try sharing it again." }; emit(); }
  }
}
function useIncoming() {
  const [v, setV] = useState(incoming);
  useEffect(() => { subs.add(setV); setV(incoming); return () => subs.delete(setV); }, []);
  return [v, () => { incoming = null; emit(); }];
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const isVideo = (f) => (f.type || "").startsWith("video/");
const isImage = (f) => (f.type || "").startsWith("image/");
const countLabel = (raw) => {
  const v = raw.filter((f) => (f.mimeType || "").startsWith("video/")).length;
  const p = raw.filter((f) => (f.mimeType || "").startsWith("image/")).length;
  const o = raw.length - v - p;
  return [v && `${v} video${v > 1 ? "s" : ""}`, p && `${p} photo${p > 1 ? "s" : ""}`, o && `${o} file${o > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
};
// Chat messages: all the photos together as one grid, each video / file on its own.
async function chatAttachments(files) {
  const photos = files.filter(isImage);
  const rest = files.filter((f) => !isImage(f));
  const out = [];
  if (photos.length) out.push(await startMediaUpload(photos, "chat"));
  for (const f of rest) out.push(await startMediaUpload([f], "chat"));
  return out.filter(Boolean);
}
const RECENT_KEY = "gs_share_recent";
const recentIds = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } };
const pushRecent = (id) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([String(id), ...recentIds().filter((x) => x !== String(id))].slice(0, 4))); } catch { /* ignore */ } };

// ── Shared sheet chrome ──────────────────────────────────────────────────────
const GOLD = "#B8953F";
function Sheet({ children, onClose }) {
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.32)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(560px,100%)", height: "min(92dvh, 860px)", background: "#fff", borderRadius: "22px 22px 0 0", boxShadow: "0 -6px 30px rgba(0,0,0,0.14)", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "inherit", color: T.text, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {children}
      </div>
    </div>,
    document.body
  );
}
function Head({ title, back, onBack, onClose, item }) {
  return (
    <div style={{ padding: "10px 18px 6px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 36 }}>
        {back ? <button onClick={onBack} style={{ background: "none", border: "none", color: GOLD, fontSize: 16, fontWeight: 600, padding: "8px 0", cursor: "pointer", fontFamily: "inherit", minHeight: 44 }}>‹ {back}</button> : <span style={{ width: 36 }} />}
        <span style={{ width: 36, height: 5, borderRadius: 3, background: "#D1D1D6" }} />
        <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, borderRadius: 16, border: "none", background: "rgba(118,118,128,0.12)", color: T.textSub, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3, marginTop: 4 }}>{title}</div>
      {item && <Thumbs item={item} />}
    </div>
  );
}
function Thumbs({ item }) {
  const urls = useMemo(() => (item.files || []).map((f) => (isImage(f) || isVideo(f) ? URL.createObjectURL(f) : "")), [item.files]);
  useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  const raw = item.raw.slice(0, 6);
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
      {raw.map((r, i) => {
        const f = item.files && item.files[i];
        const u = urls[i];
        return (
          <div key={i} style={{ width: 54, height: 54, borderRadius: 10, overflow: "hidden", background: "rgba(118,118,128,0.14)", position: "relative", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            {f && isImage(f) && u ? <img src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : f && isVideo(f) && u ? <video src={u} muted playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span>{(r.mimeType || "").startsWith("video/") ? "🎥" : (r.mimeType || "").startsWith("image/") ? "🖼" : "📄"}</span>}
            {(r.mimeType || "").startsWith("video/") && <span style={{ position: "absolute", left: 4, bottom: 2, color: "#fff", fontSize: 11, fontWeight: 700, textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>▶</span>}
          </div>
        );
      })}
      {item.raw.length > 6 && <span style={{ fontSize: 13, color: T.textSub, fontWeight: 600 }}>+{item.raw.length - 6}</span>}
      {item.loading && <span style={{ fontSize: 13, color: T.textSub, marginLeft: 6 }}>Getting them ready…</span>}
    </div>
  );
}
const rowBtn = { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 18px", minHeight: 58, background: "#fff", border: "none", borderBottom: "0.5px solid rgba(60,60,67,0.12)", textAlign: "left", cursor: "pointer", fontFamily: "inherit", color: T.text };
const secHd = { fontSize: 12, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.04em", padding: "12px 18px 6px" };
function Option({ icon, title, desc, onClick, primary, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ margin: "8px 16px 0", width: "calc(100% - 32px)", borderRadius: 16, border: primary ? `1.5px solid ${GOLD}` : "1px solid rgba(60,60,67,0.14)", background: primary ? "#FFFCF5" : "#fff", padding: 16, display: "flex", gap: 14, alignItems: "flex-start", textAlign: "left", cursor: disabled ? "default" : "pointer", fontFamily: "inherit", color: T.text, opacity: disabled ? 0.45 : 1 }}>
      <span style={{ width: 46, height: 46, borderRadius: 12, background: "#F8F1E0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0 }}>{icon}</span>
      <span><span style={{ display: "block", fontSize: 17, fontWeight: 700 }}>{title}</span><span style={{ display: "block", fontSize: 13.5, color: T.textSub, marginTop: 3, lineHeight: 1.4 }}>{desc}</span></span>
    </button>
  );
}
function Caption({ value, onChange }) {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="Add a message (optional)" rows={2}
    style={{ margin: "10px 16px 0", width: "calc(100% - 32px)", boxSizing: "border-box", minHeight: 52, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(60,60,67,0.16)", background: "rgba(118,118,128,0.06)", fontSize: 16, fontFamily: "inherit", resize: "none", outline: "none", color: T.text }} />;
}
function Toast({ text, onOpen, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 4500); return () => clearTimeout(t); }, [onDone]);
  return createPortal(
    <div style={{ position: "fixed", left: 16, right: 16, bottom: "calc(26px + env(safe-area-inset-bottom))", zIndex: 3001, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ pointerEvents: "auto", maxWidth: 520, width: "100%", background: "#1C1C1E", color: "#fff", borderRadius: 16, padding: "12px 14px 12px 16px", display: "flex", alignItems: "center", gap: 10, fontSize: 14.5, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
        <span>✓</span><span style={{ flex: 1, lineHeight: 1.35 }}>{text}</span>
        {onOpen && <button onClick={() => { onOpen(); onDone(); }} style={{ background: "none", border: "none", color: "#E8C979", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", minHeight: 40, padding: "0 6px" }}>Open</button>}
      </div>
    </div>,
    document.body
  );
}

// ── Team (mounted in the shell) ──────────────────────────────────────────────
// props: properties, setSharedProps, flushProps, currentUser, ctrJobs, ctrOrgs,
// ctrSave, statusColor(status), onOpen(kind, property) — kind media|chat|walk
export function ShareInTeam({ properties, setSharedProps, flushProps, currentUser, ctrJobs, ctrOrgs, ctrSave, statusColor, onOpen }) {
  const [item, clear] = useIncoming();
  const [step, setStep] = useState("pick");
  const [prop, setProp] = useState(null);
  const [q, setQ] = useState("");
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);
  useEffect(() => { if (item) { setStep("pick"); setProp(null); setQ(""); setCaption(""); setErr(""); } }, [item && item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = (properties || []).filter((p) => p && !p.archived);
  const rec = recentIds().map((id) => live.find((p) => String(p.id) === id)).filter(Boolean);
  const ql = q.trim().toLowerCase();
  const all = live.filter((p) => !ql || `${p.address || ""} ${p.city || ""}`.toLowerCase().includes(ql)).sort((a, b) => String(a.address || "").localeCompare(String(b.address || "")));
  const jobsHere = prop ? (ctrJobs || []).filter((j) => String(j.propertyId) === String(prop.id) && j.status !== "complete") : [];
  const orgName = (id) => ((ctrOrgs || []).find((o) => String(o.id) === String(id)) || {}).name || "Contractor";

  const close = () => { clear(); };
  const finish = (text, kind) => { const p = prop; pushRecent(p.id); setToast({ text, open: onOpen ? () => onOpen(kind, p) : null }); clear(); };
  const files = (item && item.files) || [];
  const videos = files.filter(isVideo);
  const ready = item && !item.loading && !item.error && files.length > 0;

  const updateProp = (id, key, val) => { setSharedProps((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: val } : p))); if (flushProps) setTimeout(flushProps, 0); };
  const latest = () => (properties || []).find((p) => p.id === prop.id) || prop;
  const toMedia = (list) => uploadToMedia(prop, list, { updateProp, getLatest: latest, by: currentUser, src: "upload" }).catch(() => {});

  const doWalk = () => {
    if (!ready || !videos.length) return;
    startWalkClips(prop, videos);
    const photos = files.filter((f) => !isVideo(f));
    if (photos.length) toMedia(photos);
    finish(`Making the punch list for ${prop.address} — it keeps going in the background`, "walk");
  };
  const doMedia = () => {
    if (!ready) return;
    toMedia(files.filter((f) => isImage(f) || isVideo(f)));
    finish(`Adding to ${prop.address} · Media — uploading in the background`, "media");
  };
  const sendTeam = async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      const atts = await chatAttachments(files);
      const t = caption.trim();
      const base = Date.now();
      const msgs = atts.map((att, i) => ({ id: base + i, author: currentUser, text: i === atts.length - 1 ? t : "", at: new Date().toISOString(), readBy: [currentUser], attachment: att }));
      setSharedProps((prev) => prev.map((p) => (p.id !== prop.id ? p : { ...p, messages: [...(p.messages || []), ...msgs] })));
      if (flushProps) setTimeout(flushProps, 0);
      finish(`Sent to the ${prop.address} team chat`, "chat");
    } catch (e) { setErr((e && e.message) || "Couldn't send."); }
    setBusy(false);
  };
  const sendCtr = async (job) => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    try {
      const atts = await chatAttachments(files);
      const t = caption.trim();
      const base = Date.now();
      for (let i = 0; i < atts.length; i++) {
        const att = atts[i];
        const msg = { id: base + i, jobId: job.id, orgId: job.orgId, author: currentUser, side: "team", text: i === atts.length - 1 ? t : "", at: new Date().toISOString(), readBy: [currentUser], attachment: att };
        await ctrSave("contractor_messages", msg);
        if (att && att.pending && att.uploadId) bindCtrVideoMessage(att.uploadId, msg.id);
      }
      notify(null, { toOrg: job.orgId, title: `Goldstone — ${job.propertyAddress || prop.address}`, att: atts[0], body: t || `${currentUser} sent ${countLabel(item.raw)}`, url: `/?goto=job:${job.id}` });
      finish(`Sent to ${orgName(job.orgId)} — ${prop.address}`, "chat");
    } catch (e) { setErr((e && e.message) || "Couldn't send."); }
    setBusy(false);
  };

  const toastEl = toast && <Toast text={toast.text} onOpen={toast.open} onDone={() => setToast(null)} />;
  if (!item) return toastEl || null;
  // 👤 A contact shared from the phone's Contacts app → Add to Contacts.
  if (isContactShare(item)) return <>{toastEl}<ContactShare item={item} clear={clear} currentUser={currentUser} onSaved={(text) => setToast({ text, open: onOpen ? () => onOpen("contacts", null) : null })} /></>;
  const propRow = (p) => (
    <button key={p.id} onClick={() => { setProp(p); setStep("do"); }} style={rowBtn}>
      <span style={{ width: 9, height: 9, borderRadius: 5, background: (statusColor && statusColor(p.status)) || GOLD, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.address}</span>
        <span style={{ display: "block", fontSize: 13, color: T.textSub, marginTop: 1 }}>{[p.city, p.status].filter(Boolean).join(" · ")}</span>
      </span>
      <span style={{ color: "#C7C7CC", fontSize: 18 }}>›</span>
    </button>
  );
  return (
    <>
      {toastEl}
      <Sheet onClose={close}>
        {step === "pick" && <>
          <Head title="Add to a property" item={item} onClose={close} />
          {item.error && <div style={{ padding: "4px 18px", color: T.red, fontSize: 14 }}>{item.error}</div>}
          <div style={{ margin: "8px 18px 4px", flexShrink: 0 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search properties" style={{ width: "100%", boxSizing: "border-box", height: 40, borderRadius: 12, border: "none", background: "rgba(118,118,128,0.12)", padding: "0 12px", fontSize: 16, fontFamily: "inherit", outline: "none", color: T.text }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
            {!ql && rec.length > 0 && <><div style={secHd}>Recent</div>{rec.map(propRow)}</>}
            <div style={secHd}>{ql ? "Results" : "All properties"}</div>
            {all.map(propRow)}
            {!all.length && <div style={{ padding: "18px", color: T.textSub, fontSize: 14 }}>No property matches “{q}”.</div>}
          </div>
        </>}
        {step === "do" && prop && <>
          <Head title="What should we do?" back="Properties" onBack={() => setStep("pick")} onClose={close} />
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
            <PropChip prop={prop} item={item} statusColor={statusColor} />
            <Option primary icon="🎥" title="Make a punch list" disabled={!ready || !videos.length}
              desc={videos.length ? "The AI listens to what you say in the video and lists every item room by room, with a picture of each — same as 🎥 Walkthrough." : "Punch lists are made from videos where you talk through the job — share a video to use this."}
              onClick={doWalk} />
            <Option icon="🖼" title="Just add to Media" disabled={!ready} desc="Saves the photos and videos to this property's gallery." onClick={doMedia} />
            <Option icon="💬" title="Send in a chat" disabled={!ready} desc="Post it in this property's team chat, or to the contractor on the job." onClick={() => setStep("chat")} />
            {item.loading && <div style={{ padding: "12px 22px 0", fontSize: 13, color: T.textSub }}>Getting your {countLabel(item.raw)} ready…</div>}
            {item.error && <div style={{ padding: "12px 22px 0", fontSize: 13, color: T.red }}>{item.error}</div>}
          </div>
        </>}
        {step === "chat" && prop && <>
          <Head title="Send to…" back="Back" onBack={() => setStep("do")} onClose={close} />
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
            <PropChip prop={prop} item={item} statusColor={statusColor} />
            <Caption value={caption} onChange={setCaption} />
            <div style={secHd}>Internal</div>
            <button onClick={sendTeam} disabled={busy || !ready} style={rowBtn}>
              <span style={{ fontSize: 22, width: 30, textAlign: "center" }}>👥</span>
              <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 16, fontWeight: 600 }}>Team chat</span><span style={{ display: "block", fontSize: 13, color: T.textSub }}>Only the Goldstone team sees it</span></span>
              <span style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>{busy ? "…" : "Send"}</span>
            </button>
            <div style={secHd}>Contractor</div>
            {jobsHere.map((j) => (
              <button key={j.id} onClick={() => sendCtr(j)} disabled={busy || !ready} style={rowBtn}>
                <span style={{ fontSize: 22, width: 30, textAlign: "center" }}>👷</span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 16, fontWeight: 600 }}>{orgName(j.orgId)}</span><span style={{ display: "block", fontSize: 13, color: T.textSub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.title || (j.status === "bid" ? "Bid request" : "Job chat")} · they'll see it</span></span>
                <span style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>{busy ? "…" : "Send"}</span>
              </button>
            ))}
            {!jobsHere.length && <div style={{ padding: "6px 18px 0", fontSize: 14, color: T.textSub }}>No contractor has a job on this property yet.</div>}
            {err && <div style={{ padding: "10px 18px 0", fontSize: 14, color: T.red }}>{err}</div>}
          </div>
        </>}
      </Sheet>
    </>
  );
}
// ── 👤 Share a contact → company Contacts (Elie 10/18/26) ────────────────────
// iPhone Contacts → Share Contact → Goldstone (a .vcf). Matching rule = the
// connector's save_contact: same phone number first, then exact name; new
// numbers/emails are added, a fuller name replaces a shorter one, never a
// different one.
const isContactShare = (item) => item && item.raw.length > 0 && item.raw.every((r) => /vcard/i.test(r.mimeType || "") || /\.vcf$/i.test(r.name || ""));
const vUnesc = (v) => String(v || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
function parseVcards(text) {
  const out = [];
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  let c = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^BEGIN:VCARD/i.test(line)) { c = { name: "", first: "", last: "", company: "", role: "", phones: [], emails: [], address: "", notes: "" }; continue; }
    if (/^END:VCARD/i.test(line)) { if (c) { if (!c.name) c.name = [c.first, c.last].filter(Boolean).join(" ") || c.company; if (c.name || c.phones.length) out.push(c); } c = null; continue; }
    if (!c) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const head = line.slice(0, i), val = line.slice(i + 1);
    const key = head.split(";")[0].replace(/^item\d+\./i, "").toUpperCase();
    const params = head.toUpperCase();
    if (key === "FN") c.name = vUnesc(val);
    else if (key === "N") { const [last, first] = val.split(";"); c.first = vUnesc(first); c.last = vUnesc(last); }
    else if (key === "ORG") c.company = vUnesc(val.split(";")[0]);
    else if (key === "TITLE") c.role = vUnesc(val);
    else if (key === "TEL") {
      const label = /CELL|IPHONE|MOBILE/.test(params) ? "Mobile" : /WORK/.test(params) ? "Work" : /HOME/.test(params) ? "Home" : /FAX/.test(params) ? "Fax" : /MAIN/.test(params) ? "Main" : "Mobile";
      const number = vUnesc(val).replace(/^tel:/i, "");
      if (number.replace(/\D/g, "").length >= 7) c.phones.push({ label, number });
    } else if (key === "EMAIL") { const e = vUnesc(val); if (e) c.emails.push(e); }
    else if (key === "ADR" && !c.address) { const parts = val.split(";").map(vUnesc).filter(Boolean); c.address = parts.join(", "); }
    else if (key === "NOTE") c.notes = vUnesc(val);
  }
  return out;
}
const digits10 = (x) => String(x || "").replace(/\D/g, "").slice(-10);
const normName = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TRADES = ["Contractor", "Plumber", "Electrician", "HVAC", "Roofer", "Agent", "Lender", "Title", "Inspector", "Attorney"];
function findMatch(contacts, card) {
  const nums = new Set(card.phones.map((p) => digits10(p.number)));
  const numsOf = (x) => [...(x.phones || []).map((p) => p.number), x.phone].map(digits10).filter((d) => d.length >= 7);
  const byPhone = (contacts || []).filter((x) => x && numsOf(x).some((d) => nums.has(d)));
  if (byPhone.length) return byPhone[0];
  return (contacts || []).find((x) => x && normName(x.name) && normName(x.name) === normName(card.name)) || null;
}
function ContactShare({ item, clear, currentUser, onSaved }) {
  const { contacts, setContacts, flushContacts } = useData() || {};
  const [cards, setCards] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!item.files) return;
    let live = true;
    Promise.all(item.files.map((f) => f.text())).then((texts) => {
      const all = texts.flatMap(parseVcards).slice(0, 20).map((c) => ({ ...c, tag: "", note: "" }));
      if (live) { setCards(all); if (!all.length) setErr("Couldn't read that contact — try sharing it again."); }
    }).catch(() => live && setErr("Couldn't read that contact — try sharing it again."));
    return () => { live = false; };
  }, [item.files]);
  const upd = (i, patch) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const save = () => {
    if (!cards || !cards.length || busy || !setContacts) return;
    setBusy(true);
    const now = new Date().toISOString();
    let added = 0, updated = 0;
    setContacts((prev) => {
      let next = [...(prev || [])];
      cards.forEach((card, idx) => {
        const name = card.name.trim(); if (!name && !card.phones.length) return;
        const hit = findMatch(next, card);
        const tags = [card.tag].filter(Boolean);
        if (hit) {
          const have = new Set([...(hit.phones || []).map((p) => p.number), hit.phone].map(digits10));
          const add = card.phones.filter((p) => !have.has(digits10(p.number)));
          const n = { ...hit };
          if (add.length) n.phones = [...(hit.phones || (hit.phone ? [{ label: "Mobile", number: hit.phone }] : [])), ...add];
          if (name && normName(name) !== normName(hit.name) && normName(name).includes(normName(hit.name))) n.name = name;
          if (!n.company && card.company) n.company = card.company;
          if (!n.role && card.role) n.role = card.role;
          if (!n.email && card.emails[0]) n.email = card.emails[0];
          if (!n.address && card.address) n.address = card.address;
          const newTags = tags.filter((t) => !(n.tags || []).some((o) => normName(o) === normName(t)));
          if (newTags.length) n.tags = [...(n.tags || []), ...newTags];
          const note = [card.notes, card.note].filter(Boolean).join("\n");
          if (note && !String(n.notes || "").includes(note)) n.notes = [n.notes, note].filter(Boolean).join("\n");
          n.phone = (n.phones && n.phones[0] && n.phones[0].number) || n.phone || "";
          n.updatedBy = currentUser; n.updatedAt = now;
          next = next.map((x) => (x === hit ? n : x));
          updated++;
        } else {
          next.push({ id: Date.now() + idx, name: name || card.phones[0].number, company: card.company, role: card.role || card.tag, email: card.emails[0] || "", address: card.address, notes: [card.notes, card.note].filter(Boolean).join("\n"), phones: card.phones, phone: card.phones[0] ? card.phones[0].number : "", tags, createdBy: currentUser, createdAt: now, src: "share" });
          added++;
        }
      });
      return next;
    });
    if (flushContacts) setTimeout(flushContacts, 0);
    const first = cards[0] && cards[0].name;
    const text = cards.length === 1 ? `${updated ? "Updated" : "Saved"} ${first || "the contact"} in Contacts` : `${added + updated} contacts saved to Contacts`;
    setTimeout(() => onSaved(text), 0);
    clear();
  };
  return (
    <Sheet onClose={clear}>
      <Head title={cards && cards.length > 1 ? `Add ${cards.length} contacts` : "Add to Contacts"} onClose={clear} />
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
        {!cards && !err && <div style={{ padding: 18, color: T.textSub, fontSize: 14 }}>Reading the contact…</div>}
        {err && <div style={{ padding: "6px 18px", color: T.red, fontSize: 14 }}>{err}</div>}
        {(cards || []).map((c, i) => {
          const hit = findMatch(contacts, c);
          return (
            <div key={i} style={{ margin: "8px 16px 0", border: "1px solid rgba(60,60,67,0.14)", borderRadius: 16, padding: 14 }}>
              <input value={c.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Name"
                style={{ width: "100%", boxSizing: "border-box", border: "none", outline: "none", fontSize: 19, fontWeight: 700, color: T.text, fontFamily: "inherit", padding: 0, background: "transparent" }} />
              {(c.company || c.role) && <div style={{ fontSize: 13.5, color: T.textSub, marginTop: 2 }}>{[c.role, c.company].filter(Boolean).join(" · ")}</div>}
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                {c.phones.map((p, j) => <div key={j} style={{ fontSize: 14.5, color: T.text }}><span style={{ color: T.textSub, fontSize: 12.5, marginRight: 6 }}>{p.label}</span>{p.number}</div>)}
                {c.emails.map((e, j) => <div key={"e" + j} style={{ fontSize: 14.5, color: T.text }}><span style={{ color: T.textSub, fontSize: 12.5, marginRight: 6 }}>Email</span>{e}</div>)}
                {c.address && <div style={{ fontSize: 13.5, color: T.textSub }}>{c.address}</div>}
              </div>
              {hit && <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 10, background: "#F8F1E0", color: "#7A5A12", fontSize: 13, lineHeight: 1.4 }}>Already in Contacts as <b>{hit.name}</b> — new numbers and details get added to it.</div>}
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSub, textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 12 }}>What do they do?</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                {TRADES.map((t) => (
                  <button key={t} onClick={() => upd(i, { tag: c.tag === t ? "" : t })} style={{ minHeight: 34, padding: "0 12px", borderRadius: 17, border: c.tag === t ? `1.5px solid ${GOLD}` : "1px solid rgba(60,60,67,0.16)", background: c.tag === t ? "#F8F1E0" : "#fff", color: c.tag === t ? "#7A5A12" : T.text, fontSize: 13.5, fontWeight: c.tag === t ? 700 : 500, fontFamily: "inherit", cursor: "pointer" }}>{t}</button>
                ))}
              </div>
              <textarea value={c.note} onChange={(e) => upd(i, { note: e.target.value })} placeholder="Note (optional) — e.g. did the roof at 48 Willow" rows={2}
                style={{ marginTop: 10, width: "100%", boxSizing: "border-box", minHeight: 48, padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(60,60,67,0.16)", background: "rgba(118,118,128,0.06)", fontSize: 16, fontFamily: "inherit", resize: "none", outline: "none", color: T.text }} />
            </div>
          );
        })}
        {cards && cards.length > 0 && (
          <button onClick={save} disabled={busy} style={{ margin: "14px 16px 0", width: "calc(100% - 32px)", minHeight: 50, borderRadius: 14, border: "none", background: GOLD, color: "#fff", fontWeight: 700, fontSize: 16, fontFamily: "inherit", cursor: "pointer" }}>
            {cards.length > 1 ? `Save ${cards.length} to Contacts` : findMatch(contacts, cards[0]) ? "Update in Contacts" : "Save to Contacts"}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function PropChip({ prop, item, statusColor }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 16px 4px", padding: "12px 14px", borderRadius: 14, background: T.bg }}>
      <span style={{ width: 9, height: 9, borderRadius: 5, background: (statusColor && statusColor(prop.status)) || GOLD }} />
      <span><span style={{ display: "block", fontSize: 16, fontWeight: 600 }}>{prop.address}</span><span style={{ display: "block", fontSize: 13, color: T.textSub }}>{countLabel(item.raw)}</span></span>
    </div>
  );
}

// ── Contractors (mounted in the portal) — only their own jobs ────────────────
export function ShareInPortal({ jobs, orgId, orgName, displayName, save, onOpenJob }) {
  const [item, clear] = useIncoming();
  const [job, setJob] = useState(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);
  useEffect(() => { if (item) { setJob(null); setCaption(""); setErr(""); } }, [item && item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = (jobs || []).filter((j) => String(j.orgId) === String(orgId) && j.status !== "complete");
  const files = (item && item.files) || [];
  const ready = item && !item.loading && !item.error && files.length > 0;
  const send = async () => {
    if (!ready || busy || !job) return;
    setBusy(true); setErr("");
    try {
      const atts = await chatAttachments(files);
      const t = caption.trim();
      const base = Date.now();
      for (let i = 0; i < atts.length; i++) {
        const att = atts[i];
        const msg = { id: base + i, jobId: job.id, orgId, author: displayName, side: "contractor", text: i === atts.length - 1 ? t : "", at: new Date().toISOString(), readBy: [displayName], attachment: att };
        await save("contractor_messages", msg);
        if (att && att.pending && att.uploadId) bindCtrVideoMessage(att.uploadId, msg.id);
      }
      const body = `${(displayName || "").split(" ")[0]}: ${t || `sent ${countLabel(item.raw)}`}`;
      notify(null, { toTeam: true, att: atts[0], title: `${orgName || displayName} — ${job.propertyAddress || ""}`, body, url: `/?goto=chat:${job.propertyId || ""}` });
      notify(null, { toOrg: orgId, att: atts[0], title: `${displayName} — ${job.propertyAddress || ""}`, body: t || `sent ${countLabel(item.raw)}`, url: `/?goto=job:${job.id}` });
      const j = job;
      setToast({ text: `Sent to ${j.propertyAddress || "the job"}`, open: onOpenJob ? () => onOpenJob(j) : null });
      clear();
    } catch (e) { setErr((e && e.message) || "Couldn't send."); }
    setBusy(false);
  };
  const toastEl = toast && <Toast text={toast.text} onOpen={toast.open} onDone={() => setToast(null)} />;
  if (!item) return toastEl || null;
  return (
    <>
      {toastEl}
      <Sheet onClose={clear}>
        {!job ? <>
          <Head title="Send to a job" item={item} onClose={clear} />
          {item.error && <div style={{ padding: "4px 18px", color: T.red, fontSize: 14 }}>{item.error}</div>}
          <div style={{ flex: 1, overflowY: "auto" }}>
            <div style={secHd}>Your jobs</div>
            {mine.map((j) => (
              <button key={j.id} onClick={() => setJob(j)} style={rowBtn}>
                <span style={{ fontSize: 20, width: 28, textAlign: "center" }}>🏠</span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.propertyAddress || j.title}</span>{j.title && j.propertyAddress && <span style={{ display: "block", fontSize: 13, color: T.textSub }}>{j.title}</span>}</span>
                <span style={{ color: "#C7C7CC", fontSize: 18 }}>›</span>
              </button>
            ))}
            {!mine.length && <div style={{ padding: 18, fontSize: 14, color: T.textSub }}>You don't have an open job right now.</div>}
          </div>
        </> : <>
          <Head title="Send to the job chat" back="Jobs" onBack={() => setJob(null)} onClose={clear} item={item} />
          <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
            <div style={{ margin: "6px 16px 4px", padding: "12px 14px", borderRadius: 14, background: T.bg }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{job.propertyAddress || job.title}</div>
              <div style={{ fontSize: 13, color: T.textSub }}>{countLabel(item.raw)} · Goldstone sees it</div>
            </div>
            <Caption value={caption} onChange={setCaption} />
            <button onClick={send} disabled={!ready || busy} style={{ margin: "14px 16px 0", width: "calc(100% - 32px)", minHeight: 50, borderRadius: 14, border: "none", background: GOLD, color: "#fff", fontWeight: 700, fontSize: 16, fontFamily: "inherit", cursor: "pointer", opacity: !ready || busy ? 0.6 : 1 }}>
              {busy ? "Sending…" : item.loading ? "Getting them ready…" : "Send"}
            </button>
            {err && <div style={{ padding: "10px 18px 0", fontSize: 14, color: T.red }}>{err}</div>}
          </div>
        </>}
      </Sheet>
    </>
  );
}

// Preview harness only: pretend something was shared.
export function _testShare(files) {
  incoming = { id: Date.now(), raw: files.map((f) => ({ uri: "test", name: f.name, mimeType: f.type })), texts: [], files, loading: false, error: "" };
  emit();
}
