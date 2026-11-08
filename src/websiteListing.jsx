// 🌐 Website listing sheet (Elie 11/8/26): what the public company website
// (gpflips.com/company → api/site/listings.js) shows for one property —
// price, beds/baths/sq ft, a short description, which photos (in order, first
// = cover) and which walkthrough video. Stored on the property as p.web
// {hide, price, blurb, renovated, photos:[{id,url,w,h}], video:{id,uid,url}|"none"}
// (beds/baths/sqft live in propertyInfo, shared with the Details tab).
// Nothing picked → the site falls back to the Zillow photos + the pitch video.
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { mediaOf } from "./mediaStore";
import { streamThumb } from "./chatMedia";

const SITE_STATUSES = { "On Market": "For Sale", "In Closing": "Under Contract", Sold: "Sold" };
export const siteSlug = (addr) => String(addr || "").split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const HDR = { fontSize: 12, fontWeight: 700, color: T.textSub, letterSpacing: 0.3, textTransform: "uppercase", margin: "18px 0 8px" };
const inp = { width: "100%", boxSizing: "border-box", border: `1px solid ${T.border}`, borderRadius: 10, padding: "11px 12px", fontSize: 16, fontFamily: "inherit", outline: "none", background: "#fff", color: T.text };
const moneyIn = (v) => { const n = Number(String(v || "").replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? n : 0; };
const isHttps = (u) => /^https:\/\//i.test(String(u || ""));

function Switch({ on, onChange, label }) {
  return (
    <button onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label}
      style={{ width: 51, height: 31, borderRadius: 16, border: "none", padding: 2, cursor: "pointer", background: on ? "#34C759" : "rgba(120,120,128,0.16)", transition: "background .2s", flexShrink: 0, display: "flex", justifyContent: on ? "flex-end" : "flex-start" }}>
      <span style={{ width: 27, height: 27, borderRadius: 14, background: "#fff", boxShadow: "0 2px 4px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

export function WebsiteListingSheet({ property, onUpdate, onClose }) {
  const phone = typeof window !== "undefined" && window.innerWidth < 760;
  const web = property.web || {};
  const pi = property.propertyInfo || {};
  const media = useMemo(() => mediaOf(property).filter((m) => !m.pending && (m.kind === "photo" ? isHttps(m.url) : m.kind === "video" && m.uid)), [property]);
  const photos = media.filter((m) => m.kind === "photo");
  const videos = media.filter((m) => m.kind === "video");
  const zillow = photos.filter((m) => m.src === "zillow");
  const [show, setShow] = useState(!web.hide);
  const [price, setPrice] = useState(() => { const n = moneyIn(web.price) || moneyIn(property.rpPrice); return n ? n.toLocaleString("en-US") : ""; });
  const [beds, setBeds] = useState(pi.beds || ""), [baths, setBaths] = useState(pi.baths || ""), [sqft, setSqft] = useState(pi.sqft || "");
  const [blurb, setBlurb] = useState(web.blurb || "");
  const [reno, setReno] = useState(web.renovated !== false);
  const [picked, setPicked] = useState(() => (Array.isArray(web.photos) ? web.photos.map((x) => x.id).filter((id) => photos.some((m) => m.id === id)) : []));
  const defVideo = web.video === "none" ? "none" : (web.video && web.video.id) || (property.rpVideoId && property.rpVideoId !== "none" ? property.rpVideoId : "");
  const [video, setVideo] = useState(videos.some((v) => v.id === defVideo) ? defVideo : defVideo === "none" ? "none" : "");
  const label = SITE_STATUSES[property.status];
  const url = `/company#home/${siteSlug(property.address)}`;

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = () => {
    const vid = videos.find((v) => v.id === video);
    onUpdate(property.id, "web", {
      ...web, hide: !show, price: moneyIn(price) || "", blurb: blurb.trim(), renovated: reno,
      photos: picked.map((id) => photos.find((m) => m.id === id)).filter(Boolean).map((m) => ({ id: m.id, url: m.url, ...(m.w && m.h ? { w: m.w, h: m.h } : {}) })),
      video: video === "none" ? "none" : vid ? { id: vid.id, uid: vid.uid, url: vid.url || vid.watch || "" } : null,
      at: new Date().toISOString(),
    });
    if (beds !== (pi.beds || "") || baths !== (pi.baths || "") || sqft !== (pi.sqft || "")) onUpdate(property.id, "propertyInfo", { ...pi, beds, baths, sqft });
    onClose();
  };

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 420, background: "rgba(0,0,0,0.32)", display: "flex", alignItems: phone ? "flex-end" : "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: phone ? "100%" : "min(600px, 94vw)", maxHeight: phone ? "92vh" : "88vh", borderRadius: phone ? "22px 22px 0 0" : 20, display: "flex", flexDirection: "column", boxShadow: "0 -6px 30px rgba(0,0,0,0.18)", paddingBottom: phone ? "env(safe-area-inset-bottom)" : 0 }}>
        {phone && <div style={{ width: 38, height: 5, borderRadius: 3, background: "#D1D1D6", margin: "8px auto 0" }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 8px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>🌐 Website</div>
            <div style={{ fontSize: 13, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(property.address || "").split(",")[0]}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, margin: -7, borderRadius: 22, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 30, height: 30, borderRadius: 15, background: "#F2F2F7", color: T.textSub, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#F7F7FA", borderRadius: 14, padding: "12px 14px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>Show on the website</div>
              <div style={{ fontSize: 13, color: T.textSub, marginTop: 2, lineHeight: 1.4 }}>
                {label ? <>Shows as <b>{label}</b> while it's {property.status}.</> : <>It appears once it's On Market (For Sale), In Closing (Under Contract) or Sold.</>}
              </div>
            </div>
            <Switch on={show} onChange={setShow} label="Show on the website" />
          </div>

          <div style={HDR}>List price</div>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.textSub, fontSize: 16 }}>$</span>
            <input value={price} inputMode="numeric" onChange={(e) => { const n = moneyIn(e.target.value); setPrice(n ? n.toLocaleString("en-US") : ""); }} placeholder="e.g. 549,000" style={{ ...inp, paddingLeft: 24 }} />
          </div>
          <div style={{ fontSize: 12, color: T.textTert, marginTop: 5 }}>Blank = "Price on request".</div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[["Beds", beds, setBeds, "3"], ["Baths", baths, setBaths, "2.5"], ["Sq ft", sqft, setSqft, "1,800"]].map(([l, v, set, ph]) => (
              <label key={l} style={{ display: "block" }}><div style={HDR}>{l}</div><input value={v} onChange={(e) => set(e.target.value)} placeholder={ph} style={inp} /></label>
            ))}
          </div>

          <div style={HDR}>Description (optional)</div>
          <textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={4} placeholder="Open-concept kitchen with quartz counters, new baths, fenced yard…" style={{ ...inp, resize: "vertical", lineHeight: 1.45 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
            <div style={{ flex: 1, fontSize: 15, color: T.text }}>Say "Fully renovated"</div>
            <Switch on={reno} onChange={setReno} label="Say fully renovated" />
          </div>

          <div style={{ ...HDR, display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ flex: 1 }}>Photos {picked.length ? `· ${picked.length} picked` : ""}</span>
            {picked.length > 0 && <button onClick={() => setPicked([])} style={{ border: "none", background: "none", color: T.gold, fontWeight: 600, fontSize: 13, cursor: "pointer", textTransform: "none", minHeight: 32 }}>Clear</button>}
          </div>
          <div style={{ fontSize: 13, color: T.textSub, marginBottom: 8, lineHeight: 1.4 }}>
            Tap photos in the order you want them — <b>1</b> is the cover. {picked.length ? "" : zillow.length ? `Nothing picked = the ${zillow.length} Zillow photo${zillow.length === 1 ? "" : "s"}.` : "Nothing picked = no photos yet."}
          </div>
          {photos.length ? (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${phone ? 3 : 4}, 1fr)`, gap: 4 }}>
              {photos.map((m) => {
                const i = picked.indexOf(m.id);
                return (
                  <button key={m.id} onClick={() => toggle(m.id)} aria-pressed={i >= 0} aria-label={`Photo ${m.name || ""}`}
                    style={{ position: "relative", aspectRatio: "1", border: "none", padding: 0, borderRadius: 6, cursor: "pointer", background: `#eee url('${String(m.thumb || m.url).replace(/'/g, "%27")}') center/cover`, outline: i >= 0 ? `3px solid ${T.gold}` : "none", outlineOffset: -3 }}>
                    {i >= 0 && <span style={{ position: "absolute", top: 5, right: 5, minWidth: 24, height: 24, borderRadius: 12, background: T.gold, color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>{i + 1}</span>}
                    {m.src === "zillow" && <span style={{ position: "absolute", left: 4, bottom: 4, fontSize: 10, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 4, padding: "2px 5px" }}>Zillow</span>}
                  </button>
                );
              })}
            </div>
          ) : <div style={{ fontSize: 13, color: T.textTert, background: "#F7F7FA", borderRadius: 12, padding: 14 }}>No photos in this property's Media yet — add some in Media, or use 📣 → "Get Zillow photos".</div>}

          <div style={HDR}>Video tour</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            <button onClick={() => setVideo("none")} style={{ flexShrink: 0, width: 96, height: 72, borderRadius: 8, border: `2px solid ${video === "none" ? T.gold : T.border}`, background: "#F7F7FA", color: T.textSub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>No video</button>
            {videos.map((v) => (
              <button key={v.id} onClick={() => setVideo(v.id)} aria-pressed={video === v.id} aria-label={`Video ${v.name || ""}`}
                style={{ flexShrink: 0, width: 96, height: 72, borderRadius: 8, border: `2px solid ${video === v.id ? T.gold : "transparent"}`, background: `#222 url('${String(v.thumb || streamThumb(v)).replace(/'/g, "%27")}') center/cover`, cursor: "pointer", color: "#fff", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</button>
            ))}
          </div>
          {!videos.length && <div style={{ fontSize: 13, color: T.textTert, marginTop: 4 }}>No videos in Media yet.</div>}

          <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: 18, borderRadius: 12, background: "#FBF3DD", color: "#8a6d1f", border: "1px solid #E8D59E", fontWeight: 700, fontSize: 14, textDecoration: "none" }}>🔗 See it on the website</a>
        </div>
        <div style={{ padding: "10px 16px 14px", borderTop: `0.5px solid ${T.border}` }}>
          <button onClick={save} style={{ width: "100%", minHeight: 48, borderRadius: 12, border: "none", background: T.gold, color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Save</button>
        </div>
      </div>
    </div>, document.body);
}
