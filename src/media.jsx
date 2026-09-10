// ── 🎞 Media — every property's photos and videos, one folder each ───────────
// Approved from a mockup 9/10 (Elie): folder rows → a property's grid grouped
// by day, Record (in-app, small files) + Upload, All/Photos/Videos, and a
// sheet per item with Make punch list / Save / Delete. Contractor and team
// chat attachments file themselves in (see mediaStore.js).
import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "./theme";
import { useData } from "./data/DataProvider";
import { useAuth } from "./auth/AuthProvider";
import { useContractorData } from "./contractors/data";
import { mediaOf, mediaCounts, uploadToMedia, fmtMB, fmtDur } from "./mediaStore";
import { WalkthroughModal, startWalkFromCloud, useWalkJob } from "./walkthrough";

const ET = (t, o) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", ...o });
const dayKey = (t) => ET(t, { year: "numeric", month: "2-digit", day: "2-digit" });
const dayLabel = (t) => {
  const k = dayKey(t), today = dayKey(Date.now()), yest = dayKey(Date.now() - 86400000);
  return k === today ? "Today" : k === yest ? "Yesterday" : ET(t, { month: "short", day: "numeric", ...(new Date(t).getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
};
const whenLabel = (t) => ET(t, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const first = (n) => String(n || "").split(" ")[0];
const isPhoneWidth = () => typeof window !== "undefined" && window.innerWidth < 768;

// Segmented capsule (same idiom as the rest of the app).
const SEG = { display: "flex", alignItems: "center", borderRadius: 18, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)", padding: 3, gap: 2, width: "fit-content", maxWidth: "100%" };
const seg = (on) => ({ padding: "7px 14px", minHeight: 32, borderRadius: 15, border: "none", background: on ? "#fff" : "transparent", color: on ? T.gold : T.textSub, fontWeight: on ? 700 : 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? "0 1px 3px rgba(0,0,0,0.08)" : "none", whiteSpace: "nowrap" });
const btn = (bg, fg, extra = {}) => ({ padding: "13px 14px", minHeight: 44, borderRadius: 14, border: bg === T.card ? `1px solid ${T.border}` : "none", background: bg, color: fg, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, ...extra });

// A four-tile collage for the folder row.
function Collage({ list }) {
  const th = list.filter((m) => m.thumb).slice(0, 4);
  if (!th.length) return <div style={{ width: 64, height: 64, borderRadius: 12, background: "#E9E9EE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>📁</div>;
  return (
    <div style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", display: "grid", gridTemplateColumns: th.length > 1 ? "1fr 1fr" : "1fr", gridTemplateRows: th.length > 2 ? "1fr 1fr" : "1fr", gap: 2, flexShrink: 0, background: "#E9E9EE" }}>
      {th.map((m) => <img key={m.id} src={m.thumb} alt="" onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />)}
    </div>
  );
}

function Tile({ m, onOpen }) {
  const video = m.kind === "video";
  return (
    <button onClick={() => onOpen(m)} title={m.name} style={{ position: "relative", aspectRatio: "1", borderRadius: 10, overflow: "hidden", border: "none", padding: 0, background: "linear-gradient(135deg,#9aa4ae,#6b7580)", cursor: "pointer", minHeight: 44 }}>
      {m.thumb && <img src={m.thumb} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      {video && <span style={{ position: "absolute", right: 6, top: 6, width: 22, height: 22, borderRadius: 11, background: "rgba(0,0,0,0.55)", color: "#fff", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</span>}
      {video && m.punchAt && <span style={{ position: "absolute", left: 6, top: 6, background: "#0F9D58", color: "#fff", fontSize: 9.5, fontWeight: 800, borderRadius: 6, padding: "2px 6px", letterSpacing: "0.03em" }}>✓ PUNCH LIST</span>}
      {video && m.dur > 0 && <span style={{ position: "absolute", left: 6, bottom: 6, background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "2px 6px", fontVariantNumeric: "tabular-nums" }}>{fmtDur(m.dur)}</span>}
      {(m.src === "contractor" || m.src === "chat") && m.by && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "linear-gradient(transparent,rgba(0,0,0,0.6))", color: "#fff", fontSize: 9.5, fontWeight: 700, padding: "14px 6px 5px", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.src === "contractor" ? m.by : first(m.by)}</span>}
    </button>
  );
}

// In-app recorder: the same MediaRecorder the walkthrough uses (1280 wide,
// ~2 Mbps) - about an eighth of the camera roll's size for the same minutes.
function RecorderSheet({ onDone, onClose }) {
  const liveRef = useRef(null), mrRef = useRef(null), streamRef = useRef(null), chunks = useRef([]), timer = useRef(null);
  const [sec, setSec] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: true });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (liveRef.current) { liveRef.current.srcObject = stream; liveRef.current.play().catch(() => {}); }
        const mime = ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
        const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2000000, audioBitsPerSecond: 64000 });
        chunks.current = [];
        mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.current.push(e.data); };
        mr.onstop = () => {
          try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
          clearInterval(timer.current);
          const type = mime || "video/webm";
          const blob = new Blob(chunks.current, { type });
          const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
          onDone(new File([blob], `Recording ${stamp}.${type.includes("mp4") ? "mp4" : "webm"}`, { type }));
        };
        mrRef.current = mr; mr.start(1000);
        timer.current = setInterval(() => setSec((s) => s + 1), 1000);
      } catch (e) { setErr("Camera/microphone permission is needed to record. (" + (e.message || e.name) + ")"); }
    })();
    return () => { dead = true; clearInterval(timer.current); try { streamRef.current && streamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const stop = () => { try { mrRef.current && mrRef.current.state !== "inactive" && mrRef.current.stop(); } catch { /* ignore */ } };
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 480, display: "flex", flexDirection: "column" }}>
      <video ref={liveRef} muted playsInline style={{ flex: 1, minHeight: 0, width: "100%", objectFit: "cover", display: "block" }} />
      <div style={{ position: "absolute", top: "max(14px, env(safe-area-inset-top))", left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: 5, background: "#FF3B30", boxShadow: "0 0 8px #FF3B30" }} />
        <span style={{ color: "#fff", fontWeight: 800, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>REC {fmtDur(sec)}</span>
      </div>
      {err && <div style={{ position: "absolute", top: 60, left: 16, right: 16, background: "#FFF0EF", color: T.red, borderRadius: 12, padding: "10px 12px", fontSize: 13 }}>{err}</div>}
      <div style={{ padding: "14px 16px max(20px, env(safe-area-inset-bottom))", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontWeight: 700, fontSize: 14, padding: "10px 16px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit", minHeight: 44 }}>Cancel</button>
        <button onClick={stop} aria-label="Stop recording" style={{ width: 68, height: 68, borderRadius: 34, border: "4px solid #fff", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: 28, height: 28, borderRadius: 7, background: "#FF3B30" }} /></button>
        <span style={{ width: 84 }} />
      </div>
    </div>
  );
}

function ItemSheet({ property, m, onClose, onDelete, onPunch, isMobile }) {
  const video = m.kind === "video";
  const job = useWalkJob(property.id);
  const busy = job && job.status === "proc";
  const saveHref = video && m.uid ? `/api/stream/file?uid=${encodeURIComponent(m.uid)}&name=${encodeURIComponent((m.name || "video").replace(/\.[a-z0-9]+$/i, ""))}` : (m.url || "#");
  const row = (icon, label, onClick, color, right, href) => {
    const inner = <><span style={{ width: 30, textAlign: "center", fontSize: 17 }}>{icon}</span><span style={{ flex: 1 }}>{label}</span>{right && <span style={{ fontSize: 11, color: "#8a6d1f", fontWeight: 600 }}>{right}</span>}</>;
    const st = { display: "flex", alignItems: "center", gap: 12, padding: "13px 4px", minHeight: 48, borderTop: "1px solid #F0F0F3", fontSize: 15, fontWeight: color === T.gold ? 800 : 600, color: color || T.text, background: "none", border: "none", borderTopWidth: 1, width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", textDecoration: "none" };
    return href ? <a href={href} download target="_blank" rel="noreferrer" style={st}>{inner}</a> : <button onClick={onClick} style={st}>{inner}</button>;
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 470, display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: isMobile ? "22px 22px 0 0" : 20, width: isMobile ? "100%" : "min(640px,94vw)", maxHeight: "94vh", overflowY: "auto", padding: isMobile ? "10px 16px max(20px, env(safe-area-inset-bottom))" : "16px 18px 18px", boxShadow: "0 -10px 40px rgba(0,0,0,0.25)" }}>
        {isMobile && <div style={{ width: 36, height: 5, borderRadius: 3, background: "#D1D1D6", margin: "0 auto 12px" }} />}
        {video
          ? (m.url ? <iframe src={m.url} allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title={m.name} style={{ width: "100%", aspectRatio: "16/9", border: "none", borderRadius: 14, background: "#000", display: "block" }} />
            : <div style={{ aspectRatio: "16/9", borderRadius: 14, background: "#222", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>Still processing…</div>)
          : <img src={m.url} alt={m.name} style={{ width: "100%", maxHeight: "60vh", objectFit: "contain", borderRadius: 14, background: "#000", display: "block" }} />}
        <div style={{ fontWeight: 800, fontSize: 16, marginTop: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name || (video ? "Video" : "Photo")}</div>
        <div style={{ fontSize: 12, color: T.textSub, margin: "6px 0 4px" }}>
          {m.src === "contractor" ? `Sent by ${m.by} in the portal chat` : m.src === "chat" ? `Sent by ${m.by} in chat${m.note ? ` · ${m.note}` : ""}` : m.src === "record" ? "Recorded in the app" : "Uploaded"} · {whenLabel(m.at)}{m.size ? ` · ${fmtMB(m.size)}` : ""}{m.by && m.src !== "contractor" && m.src !== "chat" ? ` · by ${first(m.by)}` : ""}
          {video && m.punchAt ? ` · ✓ punch list made ${whenLabel(m.punchAt)}` : ""}
        </div>
        {video && m.uid && row("📋", busy ? "Punch list in progress…" : m.punchAt ? "Make punch list again" : "Make punch list", () => !busy && onPunch(m), T.gold, "any device")}
        {row("⬇", isMobile ? "Save to phone" : "Save to computer", undefined, undefined, undefined, saveHref)}
        {row("🗑", "Delete from Media", () => { if (window.confirm(m.src === "contractor" || m.src === "chat" ? "Take this out of Media? The chat message keeps it." : "Delete this from Media? This can't be undone.")) onDelete(m); }, T.red)}
      </div>
    </div>
  );
}

export function MediaPage({ isMobile, onOpenProperty }) {
  const { sharedProps, setSharedProps, flushProps } = useData();
  const { displayName } = useAuth();
  const { jobs: ctrJobs, messages: ctrMessages } = useContractorData();
  const [selId, setSelId] = useState(null);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("active"); // active | sold | all
  const [kind, setKind] = useState("all");      // all | photo | video
  const [open, setOpen] = useState(null);       // item in the sheet
  const [rec, setRec] = useState(false);
  const [up, setUp] = useState(null);           // {i,n,pct,name}
  const [err, setErr] = useState("");
  const [walk, setWalk] = useState(false);      // walkthrough popup after Make punch list
  const latest = useRef(sharedProps); latest.current = sharedProps;
  const updateProp = (id, key, val) => { setSharedProps((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: val } : p))); if (flushProps) setTimeout(flushProps, 0); };
  const getLatest = (id) => () => (latest.current || []).find((p) => p.id === id);

  const props = useMemo(() => (sharedProps || []).filter((p) => !p.archived && p.status !== "New Leads"), [sharedProps]);
  const folders = useMemo(() => props.map((p) => { const list = mediaOf(p, ctrJobs, ctrMessages); const c = mediaCounts(list); const fresh = list.filter((m) => m.src === "contractor" && m.at > Date.now() - 2 * 86400000); return { p, list, ...c, freshFrom: fresh.length ? { n: fresh.length, who: fresh[0].by } : null }; })
    .filter(({ p }) => scope === "all" || (scope === "sold" ? p.status === "Sold" : p.status !== "Sold"))
    .filter(({ p }) => !q.trim() || `${p.address} ${p.city || ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (b.last || 0) - (a.last || 0) || String(a.p.address).localeCompare(String(b.p.address))), [props, ctrJobs, ctrMessages, scope, q]);
  const sel = selId != null ? props.find((p) => p.id === selId) : null;
  const list = useMemo(() => (sel ? mediaOf(sel, ctrJobs, ctrMessages) : []), [sel, ctrJobs, ctrMessages]);
  const shown = list.filter((m) => kind === "all" || m.kind === kind);
  const groups = useMemo(() => { const g = []; shown.forEach((m) => { const k = dayKey(m.at); const last = g[g.length - 1]; if (last && last.k === k) last.items.push(m); else g.push({ k, label: dayLabel(m.at), items: [m] }); }); return g; }, [shown]);

  const addFiles = async (files, src) => {
    if (!sel || !files || !files.length) return;
    setErr("");
    let lock = null; try { lock = await navigator.wakeLock?.request?.("screen"); } catch { /* ignore */ }
    try { await uploadToMedia(sel, files, { updateProp, getLatest: getLatest(sel.id), by: displayName, src, onProgress: setUp }); }
    catch (e) { setErr(e.message || "Upload failed — check your connection and try again."); }
    finally { setUp(null); try { lock && lock.release(); } catch { /* ignore */ } }
  };
  const del = (m) => {
    const cur = getLatest(sel.id)() || sel;
    if (m.src === "app" || m.src === "upload" || m.src === "record") updateProp(sel.id, "media", (cur.media || []).filter((x) => x.id !== m.id));
    else updateProp(sel.id, "mediaHidden", [...(cur.mediaHidden || []), m.id]);
    setOpen(null);
  };
  const punch = (m) => {
    setOpen(null); setWalk(true);
    startWalkFromCloud(sel, { uid: m.uid, name: m.name, size: m.size }, updateProp, getLatest(sel.id), {
      onDone: (p) => updateProp(sel.id, "mediaPunch", { ...((p && p.mediaPunch) || {}), [m.id]: Date.now() }),
    });
  };

  const h1 = { fontSize: isMobile ? 26 : 24, fontWeight: 800, color: T.text, margin: 0, display: "flex", alignItems: "center", gap: 10, minWidth: 0 };
  const priv = <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", background: T.gold, color: "#fff", borderRadius: 10, padding: "3px 9px" }}>PRIVATE</span>;

  // ── Folder list ────────────────────────────────────────────────────────────
  if (!sel) return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: isMobile ? "10px 16px 6px" : "18px 24px 8px", flexShrink: 0 }}>
        <h1 style={h1}>Media {priv}</h1>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search properties…" style={{ width: "100%", boxSizing: "border-box", marginTop: 10, padding: "10px 12px", borderRadius: 12, border: "none", background: "#E9E9EE", fontSize: 14, outline: "none", fontFamily: "inherit", color: T.text }} />
        <div style={{ ...SEG, marginTop: 8 }}>{[["active", "Active"], ["sold", "Sold"], ["all", "All"]].map(([k, l]) => <button key={k} onClick={() => setScope(k)} style={seg(scope === k)}>{l}</button>)}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isMobile ? "4px 16px 100px" : "4px 24px 24px" }}>
        {folders.length === 0 && <div style={{ padding: 24, textAlign: "center", color: T.textTert, fontSize: 13 }}>No properties match.</div>}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))", gap: 10 }}>
          {folders.map(({ p, list, photos, videos, last, freshFrom }) => (
            <button key={p.id} onClick={() => { setSelId(p.id); setKind("all"); }} style={{ background: T.card, border: "1px solid rgba(0,0,0,0.04)", borderRadius: 16, padding: 12, display: "flex", gap: 12, alignItems: "center", cursor: "pointer", textAlign: "left", fontFamily: "inherit", minHeight: 44, opacity: list.length ? 1 : 0.8 }}>
              <Collage list={list} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.address}</div>
                <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>{list.length ? `${photos} photo${photos !== 1 ? "s" : ""}${videos ? ` · ${videos} video${videos !== 1 ? "s" : ""}` : ""} · ${dayLabel(last).toLowerCase() === "today" ? "updated today" : dayLabel(last)}` : "Nothing yet — tap to add"}</div>
                {freshFrom && <span style={{ display: "inline-block", marginTop: 5, fontSize: 11, fontWeight: 700, color: "#8a6d1f", background: T.goldLight, borderRadius: 9, padding: "2px 8px" }}>📥 {freshFrom.n} new from {freshFrom.who}</span>}
              </div>
              <span style={{ color: "#C7C7CC", fontSize: 18 }}>›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── One property's folder ─────────────────────────────────────────────────
  const c = mediaCounts(list);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: isMobile ? "8px 16px 6px" : "16px 24px 8px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button onClick={() => { setSelId(null); setOpen(null); }} aria-label="Back to all properties" style={{ width: 32, height: 32, minHeight: 32, borderRadius: 16, border: "1px solid rgba(0,0,0,0.05)", background: "rgba(118,118,128,0.08)", color: "#8a6d1f", fontWeight: 700, fontSize: 17, lineHeight: 1, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, padding: 0 }}>‹</button>
          <h1 style={{ ...h1, fontSize: isMobile ? 22 : 24, flex: 1 }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sel.address}</span></h1>
          {onOpenProperty && !isMobile && <button onClick={() => onOpenProperty(sel.id)} style={{ ...btn(T.card, T.textSub), padding: "8px 12px", minHeight: 36, fontSize: 12.5 }}>Property page ›</button>}
        </div>
        <div style={{ fontSize: 12, color: T.textSub, margin: "2px 0 8px 40px" }}>{list.length ? `${c.photos} photo${c.photos !== 1 ? "s" : ""}${c.videos ? ` · ${c.videos} video${c.videos !== 1 ? "s" : ""}` : ""} · ` : ""}everything here is in the cloud, on every device</div>
        {err && <div style={{ margin: "0 0 8px", padding: "9px 12px", background: "#FFF0EF", border: `1px solid ${T.red}`, borderRadius: 10, color: T.red, fontSize: 12.5 }}>{err}</div>}
        {up ? (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: T.text }}>📤 Uploading{up.n > 1 ? ` ${up.i} of ${up.n}` : ""}… {up.pct}%</div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(118,118,128,0.14)", overflow: "hidden", margin: "8px 0 6px" }}><div style={{ width: `${up.pct}%`, height: "100%", background: T.gold, transition: "width 0.3s" }} /></div>
            <div style={{ fontSize: 11.5, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{up.name}{isMobile ? " · keep the app on screen until this finishes" : ""}</div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginBottom: 8, maxWidth: isMobile ? "100%" : 420 }}>
            {(isPhoneWidth() || (typeof navigator !== "undefined" && navigator.mediaDevices)) && <button onClick={() => setRec(true)} style={{ ...btn(T.gold, "#fff", { flex: 1, boxShadow: `0 2px 10px ${T.gold}55` }) }}>🎥 Record</button>}
            <label style={{ ...btn(T.card, T.text, { flex: 1 }) }}>📤 Upload<input type="file" accept="image/*,video/*" multiple style={{ display: "none" }} onChange={(e) => { const fl = Array.from(e.target.files || []); if (fl.length) addFiles(fl, "upload"); e.target.value = ""; }} /></label>
          </div>
        )}
        <div style={SEG}>{[["all", "All"], ["photo", "Photos"], ["video", "Videos"]].map(([k, l]) => <button key={k} onClick={() => setKind(k)} style={seg(kind === k)}>{l}</button>)}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: isMobile ? "0 16px 100px" : "0 24px 24px" }}>
        {shown.length === 0 && <div style={{ padding: "28px 16px", textAlign: "center", color: T.textTert, fontSize: 13, lineHeight: 1.6 }}>Nothing here yet.<br />Record a walkthrough, upload from the camera roll, or just send photos in this property's chat — they file themselves here.</div>}
        {groups.map((g) => (
          <div key={g.k}>
            <div style={{ fontSize: 11, fontWeight: 800, color: T.textTert, letterSpacing: "0.05em", margin: "8px 0 6px", textTransform: "uppercase" }}>{g.label}</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : "repeat(auto-fill, minmax(150px, 1fr))", gap: 4, marginBottom: 8 }}>
              {g.items.map((m) => <Tile key={m.id} m={m} onOpen={setOpen} />)}
            </div>
          </div>
        ))}
      </div>
      {open && <ItemSheet property={sel} m={open} isMobile={isMobile} onClose={() => setOpen(null)} onDelete={del} onPunch={punch} />}
      {rec && <RecorderSheet onClose={() => setRec(false)} onDone={(file) => { setRec(false); addFiles([file], "record"); }} />}
      {walk && <WalkthroughModal property={sel} onUpdate={updateProp} onClose={() => setWalk(false)} />}
    </div>
  );
}
