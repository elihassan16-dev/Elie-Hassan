// 📣 Social posts — Facebook flyers made from a property, approved by Elie,
// posted by his Cowork (approved 9/28/26). Three templates in the Goldstone
// flyer style: Just purchased (town only — an empty house never gets its
// street address posted — plus the "before" pictures), Just listed, and Sold
// (before / after with a SOLD stamp).
//
// Flow: a property moving to Purchased / On Market / Sold drops a draft here
// and pings the admins; nothing is ever posted without Elie's Approve. Facebook
// lets no website post to a personal profile, so an approved post waits in
// "Ready to post" until his Cowork (Chrome, signed in as him) opens
// /?goto=posts, downloads the picture, posts it on Facebook and taps
// Mark posted. Zillow blocks websites from reading its pages, so "Get Zillow
// photos" is a request Cowork picks up too: it opens the listing in his
// browser and pastes the photo links back here, and api/spec/img copies each
// picture into the property's Media.
//
// Everything lives in ONE app_settings row ("social_posts"): items[] (one per
// property + template, id "<propId>:<kind>") and seen{} (the last status this
// page saw per property, so a status change is noticed on whatever device is
// open — even one that didn't make the change). The flyer is drawn on a
// <canvas> (fonts from /public/fonts) so it looks the same on every device.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "./theme";
import { useData } from "./data/DataProvider";
import { useAuth } from "./auth/AuthProvider";
import { useContractorData } from "./contractors/data";
import { mediaOf, uploadToMedia } from "./mediaStore";
import { qbAuthFetch, notify } from "./net";
import { supabase } from "./supabaseClient";

const ROW = "social_posts";
export const POST_KINDS = [
  { key: "purchased", label: "Just purchased" },
  { key: "listed", label: "Just listed" },
  { key: "sold", label: "Sold" },
];
const KIND_LABEL = Object.fromEntries(POST_KINDS.map((k) => [k.key, k.label]));
// Which template a property status calls for (Under Construction still shows
// the purchase; In Closing is still a listing).
export const kindForStatus = (s) => (s === "Purchased" || s === "Under Construction" ? "purchased" : s === "On Market" || s === "In Closing" ? "listed" : s === "Sold" ? "sold" : "");
const AUTO = { Purchased: "purchased", "On Market": "listed", Sold: "sold" };
const KICKERS = {
  purchased: ["JUST ACQUIRED", "JUST PURCHASED", "NEW PROJECT"],
  listed: ["JUST LISTED", "NOW AVAILABLE", "COMING SOON", "OPEN HOUSE", "PRICE IMPROVED"],
  sold: ["SOLD", "UNDER CONTRACT", "JUST SOLD"],
};
const STATES = { NJ: "New Jersey", NY: "New York", PA: "Pennsylvania", CT: "Connecticut", DE: "Delaware", MD: "Maryland", FL: "Florida", OH: "Ohio", MA: "Massachusetts", VA: "Virginia", NC: "North Carolina", GA: "Georgia", TX: "Texas" };
const stateFull = (s) => STATES[String(s || "").toUpperCase()] || s || "";

// ── the approved-look numbers (1080×1350 canvas, same as the Cowork skill) ──
const W = 1080, H = 1350, L = 78, IW = W - 2 * L;
const C = { bg: "#F7F2E7", ink: "#15171B", sub: "#5B5347", gold: "#B8953F", kicker: "#A8832F", label: "#8A7443", goldLt: "#E9CF8A", cream: "#F3EBDA", dark: "#15171B" };

let fontsP = null;
function loadFonts() {
  if (fontsP) return fontsP;
  const f = (fam, file, desc) => new FontFace(fam, `url(/fonts/${file}) format("woff2")`, desc).load().then((ff) => { document.fonts.add(ff); });
  fontsP = Promise.all([
    f("GSCorm", "flyer-cormorant.woff2", { weight: "300 700", style: "normal" }),
    f("GSCorm", "flyer-cormorant-italic.woff2", { weight: "300 700", style: "italic" }),
    f("GSInt", "flyer-inter.woff2", { weight: "100 900", style: "normal" }),
  ]).catch(() => {}); // fall back to system fonts rather than never drawing
  return fontsP;
}
const imgCache = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) imgCache.set(src, new Promise((res) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  }));
  return imgCache.get(src);
}

function rr(ctx, x, y, w, h, r) {
  const [a, b, c, d] = Array.isArray(r) ? r : [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.quadraticCurveTo(x + w, y, x + w, y + b);
  ctx.lineTo(x + w, y + h - c); ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  ctx.lineTo(x + d, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - d);
  ctx.lineTo(x, y + a); ctx.quadraticCurveTo(x, y, x + a, y); ctx.closePath();
}
// Letter-spaced text (canvas letterSpacing isn't everywhere yet).
function spacedWidth(ctx, s, sp) { let w = 0; for (const ch of s) w += ctx.measureText(ch).width + sp; return s ? w - sp : 0; }
function drawSpaced(ctx, s, x, y, sp, align = "left") {
  let cx = align === "center" ? x - spacedWidth(ctx, s, sp) / 2 : align === "right" ? x - spacedWidth(ctx, s, sp) : x;
  const prev = ctx.textAlign; ctx.textAlign = "left";
  for (const ch of s) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
  ctx.textAlign = prev;
}
// Shrink a one-line text until it fits.
function fitFont(ctx, text, maxW, size, make, min = 12) {
  let s = size; ctx.font = make(s);
  while (s > min && ctx.measureText(text).width > maxW) { s -= 1; ctx.font = make(s); }
  return s;
}
function photo(ctx, im, x, y, w, h, r) {
  ctx.save();
  ctx.shadowColor = "rgba(30,25,15,0.16)"; ctx.shadowBlur = 28; ctx.shadowOffsetY = 12;
  rr(ctx, x, y, w, h, r); ctx.fillStyle = "#D9CFBC"; ctx.fill();
  ctx.restore();
  ctx.save(); rr(ctx, x, y, w, h, r); ctx.clip();
  if (im) {
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, "#E4DCCB"); g.addColorStop(1, "#D3C8B2");
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#8A7B5E"; ctx.font = `700 ${h > 300 ? 17 : 13}px GSInt, sans-serif`; ctx.textBaseline = "middle";
    drawSpaced(ctx, "ADD A PHOTO", x + w / 2, y + h / 2, h > 300 ? 3 : 2, "center");
  }
  ctx.restore();
}
function tag(ctx, text, x, y, gold) {
  ctx.font = "800 15px GSInt, sans-serif"; ctx.textBaseline = "middle";
  const w = spacedWidth(ctx, text, 3.9) + 28;
  rr(ctx, x, y, w, 36, 10); ctx.fillStyle = "rgba(21,23,27,0.82)"; ctx.fill();
  ctx.fillStyle = gold ? C.goldLt : C.cream; drawSpaced(ctx, text, x + 14, y + 19, 3.9);
}
const GOLD_BITS = ["before & after", "pricing", "private showing", "Message us today", "message us today"];
function ctaSegments(text) {
  const t = String(text || "");
  const hits = [];
  GOLD_BITS.forEach((b) => { let i = t.indexOf(b); while (i >= 0) { hits.push([i, i + b.length]); i = t.indexOf(b, i + b.length); } });
  const re = /\$[\d,.]+[kKmM]?/g; let m; while ((m = re.exec(t))) hits.push([m.index, m.index + m[0].length]);
  hits.sort((a, b) => a[0] - b[0]);
  const out = []; let at = 0;
  hits.forEach(([a, b]) => { if (a < at) return; if (a > at) out.push([t.slice(at, a), false]); out.push([t.slice(a, b), true]); at = b; });
  if (at < t.length) out.push([t.slice(at), false]);
  return out;
}

// Draw a whole flyer. d = flyer fields; ims = loaded photos in order; logo = Image.
export function drawFlyer(ctx, d, ims, logo) {
  const kind = d.kind;
  ctx.save();
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(184,149,63,0.55)"; rr(ctx, 26, 26, W - 52, H - 52, 6); ctx.stroke();

  // Header: logo + kicker / headline / second line
  if (logo) { ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.drawImage(logo, L, 57, 132, 132); ctx.restore(); }
  const tx = L + 132 + 26, tw = W - L - tx;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillStyle = C.kicker; ctx.font = "700 16px GSInt, sans-serif"; drawSpaced(ctx, String(d.kicker || "").toUpperCase(), tx, 62, 5.1);
  ctx.fillStyle = C.ink; fitFont(ctx, d.title || "", tw, 76, (s) => `600 ${s}px GSCorm, serif`, 36); ctx.fillText(d.title || "", tx, 118);
  ctx.fillStyle = C.sub; fitFont(ctx, d.sub || "", tw, 31, (s) => `italic 500 ${s}px GSCorm, serif`, 18); ctx.fillText(d.sub || "", tx, 176);

  // Photos
  const n = ims.length;
  // Sold is before / after unless Elie picked "After only" (Elie 9/29/26).
  const pair = kind === "sold" && d.beforeAfter !== false;
  const small = pair ? ims.slice(2, 5) : ims.slice(1, 4);
  const heroH = small.length || n === 0 ? 560 : 782;
  const stamp = (cx, cy, k) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(-8 * Math.PI / 180); ctx.scale(k, k);
    ctx.font = "700 96px GSCorm, serif"; const sw = spacedWidth(ctx, d.stamp || "SOLD", 13.4) + 82, sh = 112;
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 34; ctx.shadowOffsetY = 14;
    rr(ctx, -sw / 2, -sh / 2, sw, sh, 8); ctx.fillStyle = "rgba(21,23,27,0.92)"; ctx.fill(); ctx.shadowColor = "transparent";
    ctx.lineWidth = 5; ctx.strokeStyle = C.goldLt; ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(233,207,138,0.6)"; rr(ctx, -sw / 2 - 9, -sh / 2 - 9, sw + 18, sh + 18, 12); ctx.stroke();
    ctx.fillStyle = C.goldLt; ctx.textBaseline = "middle"; drawSpaced(ctx, d.stamp || "SOLD", 7, 6, 13.4, "center");
    ctx.restore();
  };
  if (kind === "sold" && !pair) {
    // One big "after" photo, the stamp tucked into its top-right corner.
    photo(ctx, ims[0], L, 236, IW, heroH, 20);
    stamp(L + IW - 190, 236 + 96, 0.78);
  } else if (kind === "sold") {
    const hw = (IW - 22) / 2;
    photo(ctx, ims[0], L, 236, hw, heroH, [20, 0, 0, 20]);
    photo(ctx, ims[1], L + hw + 22, 236, hw, heroH, [0, 20, 20, 0]);
    tag(ctx, "BEFORE", L + 22, 258, false);
    tag(ctx, "AFTER", L + hw + 44, 258, true);
    stamp(W / 2, 236 + heroH * 0.46, 1); // across the seam
  } else {
    photo(ctx, ims[0], L, 236, IW, heroH, 20);
    if (d.badgeBig) {
      ctx.font = "600 52px GSCorm, serif"; const bw1 = ctx.measureText(d.badgeBig).width;
      ctx.font = "700 14px GSInt, sans-serif"; const bw2 = d.badgeSmall ? spacedWidth(ctx, d.badgeSmall, 3.1) : 0;
      const bw = 40 + bw1 + (bw2 ? 12 + bw2 : 0), bh = 80, bx = L + 24, by = 236 + heroH - 24 - bh;
      rr(ctx, bx, by, bw, bh, 14); ctx.fillStyle = "rgba(21,23,27,0.86)"; ctx.fill();
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = C.goldLt; ctx.font = "600 52px GSCorm, serif"; ctx.fillText(d.badgeBig, bx + 20, by + 58);
      if (bw2) { ctx.fillStyle = C.cream; ctx.font = "700 14px GSInt, sans-serif"; drawSpaced(ctx, d.badgeSmall, bx + 32 + bw1, by + 56, 3.1); }
      ctx.textBaseline = "middle";
    }
  }
  if (small.length) {
    const g = 22, w = (IW - g * (small.length - 1)) / small.length;
    small.forEach((im, i) => photo(ctx, im, L + i * (w + g), 818, w, 200, 20));
  }

  // Stats row — or the Purchased → Sold progress track on a purchase
  if (kind === "purchased") {
    const x0 = 183, x3 = 897, step = (x3 - x0) / 3, y = 1066;
    ctx.save(); ctx.strokeStyle = "rgba(184,149,63,0.55)"; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(x0 + 24, y); ctx.lineTo(x3 - 24, y); ctx.stroke(); ctx.restore();
    ["PURCHASED", "RENOVATION", "LISTED", "SOLD"].forEach((s, i) => {
      const x = x0 + i * step, on = i === 0;
      if (on) { ctx.beginPath(); ctx.arc(x, y, 23, 0, Math.PI * 2); ctx.fillStyle = "rgba(184,149,63,0.2)"; ctx.fill(); }
      ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2); ctx.fillStyle = on ? C.gold : C.bg; ctx.fill();
      ctx.lineWidth = 2.5; ctx.strokeStyle = C.gold; ctx.stroke();
      ctx.font = "700 14px GSInt, sans-serif"; ctx.fillStyle = on ? C.ink : "#A89A7A"; ctx.textBaseline = "middle";
      drawSpaced(ctx, s, x, 1106, 2.5, "center");
    });
  } else {
    const stats = (d.stats || []).filter((s) => s && s[0]).slice(0, 4);
    if (stats.length) {
      const y0 = 1044, hgt = 102, cw = IW / stats.length;
      ctx.fillStyle = "rgba(184,149,63,0.5)"; ctx.fillRect(L, y0, IW, 1.5); ctx.fillRect(L, y0 + hgt, IW, 1.5);
      stats.forEach(([v, l], i) => {
        const cx = L + cw * i + cw / 2;
        if (i) { ctx.fillStyle = "rgba(184,149,63,0.35)"; ctx.fillRect(L + cw * i, y0 + 1.5, 1, hgt - 1.5); }
        ctx.fillStyle = C.ink; ctx.textAlign = "center"; fitFont(ctx, String(v), cw - 16, 44, (s) => `600 ${s}px GSCorm, serif`, 20); ctx.fillText(String(v), cx, y0 + 40);
        ctx.fillStyle = C.label; ctx.font = "700 13px GSInt, sans-serif"; ctx.textAlign = "left"; drawSpaced(ctx, String(l).toUpperCase(), cx, y0 + 80, 2.6, "center");
      });
    }
  }
  // Italic line
  if (d.note) { ctx.fillStyle = C.sub; ctx.textAlign = "center"; fitFont(ctx, d.note, IW, 29, (s) => `italic 500 ${s}px GSCorm, serif`, 16); ctx.fillText(d.note, W / 2, 1190); ctx.textAlign = "left"; }

  // Dark bar
  const by = H - 104;
  ctx.fillStyle = C.dark; ctx.fillRect(0, by, W, 104);
  const right = d.phone ? d.phone : "GOLDSTONE PROPERTIES";
  ctx.font = d.phone ? "700 24px GSInt, sans-serif" : "800 16px GSInt, sans-serif";
  const rsp = d.phone ? 1 : 5.1, rw = spacedWidth(ctx, right, rsp);
  const segs = ctaSegments(d.cta);
  let fs = 26; const segW = (s) => segs.reduce((w, [t, g]) => { ctx.font = `${g ? 700 : 600} ${s}px GSInt, sans-serif`; return w + ctx.measureText(t).width; }, 0);
  const room = W - 120 - rw - 54;
  while (fs > 14 && segW(fs) > room) fs -= 1;
  const tw2 = segW(fs), total = tw2 + 54 + rw; let x = (W - total) / 2; const cy = by + 52;
  ctx.textBaseline = "middle";
  segs.forEach(([t, g]) => { ctx.font = `${g ? 700 : 600} ${fs}px GSInt, sans-serif`; ctx.fillStyle = g ? C.goldLt : C.cream; ctx.fillText(t, x, cy); x += ctx.measureText(t).width; });
  x += 26; ctx.fillStyle = "rgba(233,207,138,0.5)"; ctx.fillRect(x, cy - 19, 1.5, 38); x += 27.5;
  ctx.font = d.phone ? "700 24px GSInt, sans-serif" : "800 16px GSInt, sans-serif"; ctx.fillStyle = C.goldLt; drawSpaced(ctx, right, x, cy, rsp);
  ctx.restore();
}

// ── Flyer fields from a property (the editor starts from these) ──
const num = (v) => { const n = parseFloat(String(v || "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };
const acres = (lot) => {
  const s = String(lot || "").toLowerCase(); const n = num(s);
  if (!n) return "";
  if (/sq|sf|ft/.test(s) || n > 20) return (n / 43560).toFixed(2);
  return String(+n.toFixed(2));
};
const commas = (v) => { const n = num(v); return n ? Math.round(n).toLocaleString("en-US") : ""; };
export function defaultFields(property, kind) {
  const pi = property.propertyInfo || {};
  const city = property.city || "", st = stateFull(property.state);
  const addr = property.address || "";
  const sqft = commas(pi.sqft), beds = String(pi.beds || ""), baths = String(pi.baths || ""), lot = acres(pi.lot), year = String(pi.yearBuilt || "");
  const base = { kind, beds, baths, sqft, lot, year, days: "", price: "", showPrice: false, phone: "" };
  if (kind === "purchased") return {
    ...base, kicker: "JUST ACQUIRED", title: city || "New Jersey", sub: `${st || "New Jersey"}  ·  our newest project`,
    note: "The transformation starts now — follow along for the after", cta: "Follow along for the before & after",
    caption: `🏡 Just picked up our newest project in ${city || "town"}! Here's day one — stay tuned for the transformation. #GoldstoneProperties #BeforeAndAfter`,
  };
  if (kind === "sold") return {
    ...base, kicker: "SOLD", title: addr, sub: [city, st].filter(Boolean).join(", "),
    note: "Another Goldstone transformation — from dated to move-in ready", cta: "Thinking of selling? Message us today",
    caption: `🎉 SOLD! ${addr}${city ? `, ${city}` : ""} — another Goldstone transformation. Thinking of selling? Message us today. #GoldstoneProperties #Sold`,
  };
  const facts = [beds && `${beds} bed`, baths && `${baths} bath`, sqft && `${sqft} sq ft`].filter(Boolean).join(" · ");
  return {
    ...base, kicker: "JUST LISTED", title: addr, sub: [city, st].filter(Boolean).join(", "),
    note: lot ? "Fully renovated on an oversized lot — move-in ready" : "Fully renovated and move-in ready", cta: "",
    caption: `✨ Just listed: ${addr}${city ? `, ${city}` : ""}.${facts ? ` ${facts}.` : ""} Message us for pricing & a private showing! #GoldstoneProperties #JustListed`,
  };
}
// Editor fields → what drawFlyer needs.
export function flyerSpec(f) {
  const kind = f.kind;
  const stats = kind === "sold"
    ? [[f.days, "DAYS TO SELL"], [f.beds, "BEDS"], [f.baths, "BATHS"], [f.sqft, "SQ FT"], [f.lot, "ACRE LOT"]]
    : [[f.beds, "BEDS"], [f.baths, "BATHS"], [f.lot, "ACRE LOT"], [f.year, "BUILT"]];
  const priceTxt = f.showPrice && f.price ? (String(f.price).trim().startsWith("$") ? String(f.price).trim() : `$${commas(f.price) || String(f.price).trim()}`) : "";
  let cta = f.cta;
  if (!cta) cta = kind === "listed" ? (priceTxt ? `Offered at ${priceTxt} · message us for a private showing` : "Message us for pricing & a private showing") : "";
  if (kind === "sold" && priceTxt && !f.cta) cta = `Sold for ${priceTxt} · thinking of selling? Message us today`;
  return {
    kind, kicker: f.kicker, title: f.title, sub: f.sub, note: f.note, cta, phone: f.phone || "",
    badgeBig: kind === "purchased" ? "Before" : kind === "listed" && f.sqft ? f.sqft : "",
    badgeSmall: kind === "purchased" ? "DAY ONE" : "SQ FT",
    stats: stats.filter((s) => s[0]),
    stamp: (f.kicker || "SOLD").toUpperCase() === "UNDER CONTRACT" ? "PENDING" : "SOLD",
    beforeAfter: f.beforeAfter !== false,
  };
}

// Canvas that redraws whenever the fields or photos change.
function FlyerCanvas({ fields, photos, style, canvasRef }) {
  const ref = useRef(null);
  const [ver, setVer] = useState(0);
  useEffect(() => {
    let dead = false;
    (async () => {
      await loadFonts();
      const [logo, ...ims] = await Promise.all([loadImg("/logo.png"), ...photos.map(loadImg)]);
      if (dead || !ref.current) return;
      const ctx = ref.current.getContext("2d");
      drawFlyer(ctx, flyerSpec(fields), ims, logo);
    })();
    return () => { dead = true; };
  }, [fields, photos, ver]);
  useEffect(() => { if (document.fonts) document.fonts.ready.then(() => setVer((v) => v + 1)); }, []);
  return <canvas ref={(el) => { ref.current = el; if (canvasRef) canvasRef.current = el; }} width={W} height={H} style={{ width: "100%", height: "auto", display: "block", borderRadius: 6, boxShadow: "0 6px 20px rgba(0,0,0,0.16)", ...style }} />;
}

// Full-size (2×) JPEG of a flyer for Facebook.
async function renderBlob(fields, photos) {
  await loadFonts();
  const [logo, ...ims] = await Promise.all([loadImg("/logo.png"), ...photos.map(loadImg)]);
  const cv = document.createElement("canvas"); cv.width = W * 2; cv.height = H * 2;
  const ctx = cv.getContext("2d"); ctx.scale(2, 2);
  drawFlyer(ctx, flyerSpec(fields), ims, logo);
  return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture — a photo may not allow copying."))), "image/jpeg", 0.92));
}
const slug = (s) => String(s || "flyer").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "flyer";
function saveBlob(blob, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
async function downloadUrl(url, name) {
  try { const r = await fetch(url); saveBlob(await r.blob(), name); } catch { window.open(url, "_blank"); }
}

// ── the shared store ──
export function usePosts() {
  const { appSettings, setAppSettings } = useData() || {};
  const row = (appSettings || []).find((x) => x.id === ROW) || null;
  const items = (row && row.items) || [];
  const latest = useRef(); latest.current = { appSettings, row };
  const write = (fn) => {
    const cur = latest.current.row || { id: ROW, items: [], seen: {} };
    const next = { ...cur, ...fn(cur) };
    next.items = (next.items || []).slice(-200);
    setAppSettings([...(latest.current.appSettings || []).filter((x) => x.id !== ROW), next]);
  };
  const upsert = (it) => write((cur) => ({ items: [...(cur.items || []).filter((x) => x.id !== it.id), { ...(cur.items || []).find((x) => x.id === it.id), ...it, updatedAt: new Date().toISOString() }] }));
  const remove = (id) => write((cur) => ({ items: (cur.items || []).filter((x) => x.id !== id) }));
  return { row, items, upsert, remove, write, loaded: !!appSettings };
}

// Notices a property moving to Purchased / On Market / Sold — on whichever
// team device is open — and drops a draft for Elie. The very first run only
// records where everything stands (no flood of drafts for old deals).
export function PostWatcher({ ready }) {
  const { sharedProps } = useData() || {};
  const { fresh: dbFresh } = useData() || {};
  const { row, write, loaded } = usePosts();
  const busy = useRef(false);
  useEffect(() => {
    if (!ready || !dbFresh || !loaded || busy.current || !(sharedProps || []).length) return;
    const seen = (row && row.seen) || null;
    const live = (sharedProps || []).filter((p) => p && !p.archived);
    const nextSeen = { ...(seen || {}) };
    const moved = [];
    let changed = !seen;
    live.forEach((p) => {
      const k = String(p.id), s = p.status || "";
      if (nextSeen[k] === s) return;
      if (seen && seen[k] !== undefined && AUTO[s]) moved.push(p);
      nextSeen[k] = s; changed = true;
    });
    if (!changed) return;
    busy.current = true;
    const items = (row && row.items) || [];
    const made = [];
    moved.forEach((p) => {
      const kind = AUTO[p.status], id = `${p.id}:${kind}`;
      const had = items.find((x) => x.id === id);
      if (had && had.status !== "dismissed") return; // already drafted / posted
      made.push({ id, propId: p.id, kind, status: "draft", auto: true, createdAt: new Date().toISOString(), fields: null, photos: null });
    });
    write((cur) => ({ seen: nextSeen, items: [...(cur.items || []).filter((x) => !made.some((m) => m.id === x.id)), ...made] }));
    made.forEach((m) => {
      const p = live.find((x) => x.id === m.propId);
      notify([], { toAdmins: true, title: `📣 Ready to post: ${KIND_LABEL[m.kind]}`, body: `${p.address}${p.city ? `, ${p.city}` : ""} — tap to review the Facebook flyer.`, url: "/?goto=posts", tag: `post-${m.id}` });
    });
    setTimeout(() => { busy.current = false; }, 1500);
  }, [ready, dbFresh, loaded, sharedProps, row]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

// Photos in a property's Media, oldest first.
function photosOf(property, ctrJobs, ctrMessages) {
  return mediaOf(property, ctrJobs, ctrMessages).filter((m) => m.kind === "photo" && m.url).sort((a, b) => (a.at || 0) - (b.at || 0));
}
function defaultPicks(list, kind, fields) {
  const urls = list.map((m) => m.url);
  const newest = [...list].reverse();
  const zillow = newest.filter((m) => m.src === "zillow").map((m) => m.url);
  if (kind === "purchased") return urls.slice(0, 4);
  if (kind === "listed") return [...new Set([...zillow, ...newest.map((m) => m.url)])].slice(0, 4);
  if (fields && fields.beforeAfter === false) return [...new Set([...zillow, ...newest.map((m) => m.url)])].slice(0, 4);
  const before = urls[0], after = zillow[0] || newest[0]?.url;
  const rest = [...new Set([...zillow, ...newest.map((m) => m.url)])].filter((u) => u !== before && u !== after);
  return [before, after, ...rest].filter(Boolean).slice(0, 5);
}

// Copy picture links (Zillow photos Cowork found) into a property's Media.
export async function addPhotoLinks(property, text, { setSharedProps, flushProps, getLatest, by }) {
  const links = [...new Set(String(text || "").split(/[\s,]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s) || s.startsWith("//")))].slice(0, 40);
  if (!links.length) return { added: 0, failed: 0 };
  const got = [];
  let failed = 0;
  for (let i = 0; i < links.length; i++) {
    try {
      const r = await qbAuthFetch(`/api/spec/img?folder=media&url=${encodeURIComponent(links[i])}`);
      if (r && r.mirrored && r.url) got.push({ id: `z:${Date.now()}:${i}`, kind: "photo", url: r.url, thumb: r.url, name: "Zillow photo", mime: "image/jpeg", at: Date.now() + i, by: by || "", src: "zillow", from: links[i] });
      else failed++;
    } catch { failed++; }
  }
  if (got.length) {
    const cur = (getLatest && getLatest()) || property;
    setSharedProps((prev) => prev.map((p) => (p.id === property.id ? { ...p, media: [...(cur.media || []), ...got] } : p)));
    if (flushProps) setTimeout(flushProps, 0);
  }
  return { added: got.length, failed };
}

// ── iOS pieces (same capsule look as the rest of the app) ──
const SEG = { display: "flex", borderRadius: 18, background: "rgba(118,118,128,0.08)", border: "1px solid rgba(0,0,0,0.05)", padding: 3, gap: 2 };
const segBtn = (on) => ({ flex: 1, minHeight: 34, border: "none", borderRadius: 14, background: on ? "#fff" : "transparent", color: on ? T.text : T.textSub, fontWeight: on ? 650 : 450, fontSize: 13, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.14)" : "none", whiteSpace: "nowrap", padding: "0 8px" });
const chip = (on) => ({ minHeight: 32, padding: "0 12px", borderRadius: 16, border: "1px solid rgba(0,0,0,0.05)", background: on ? "#fff" : "rgba(118,118,128,0.08)", color: on ? T.gold : T.textSub, fontWeight: on ? 650 : 500, fontSize: 12, cursor: "pointer", fontFamily: "inherit", boxShadow: on ? "0 1px 4px rgba(0,0,0,0.12)" : "none", whiteSpace: "nowrap" });
const LAB = { fontSize: 12, fontWeight: 600, color: T.textSub, letterSpacing: "0.02em", margin: "16px 4px 6px", textTransform: "uppercase" };
const INPUT = { width: "100%", boxSizing: "border-box", minHeight: 44, border: "none", borderRadius: 12, background: "#fff", padding: "10px 12px", fontSize: 15, color: T.text, fontFamily: "inherit", outline: "none" };
const BTN_P = { minHeight: 50, borderRadius: 25, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 16, cursor: "pointer", fontFamily: "inherit", width: "100%" };
const BTN_S = { minHeight: 44, borderRadius: 22, border: "none", background: "rgba(118,118,128,0.12)", color: T.text, fontWeight: 600, fontSize: 15, cursor: "pointer", fontFamily: "inherit", width: "100%" };

function Sheet({ onClose, isMobile, children, footer }) {
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.32)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.bg, width: isMobile ? "100%" : 520, maxHeight: isMobile ? "94vh" : "92vh", borderRadius: isMobile ? "28px 28px 0 0" : 24, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {isMobile && <div style={{ width: 36, height: 5, borderRadius: 3, background: "rgba(60,60,67,0.3)", margin: "8px auto 0", flexShrink: 0 }} />}
        <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "10px 16px 16px" }}>{children}</div>
        {footer && <div style={{ flexShrink: 0, padding: "10px 16px calc(12px + env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, background: T.bg, display: "flex", flexDirection: "column", gap: 8 }}>{footer}</div>}
      </div>
    </div>, document.body);
}

// ── The approve screen ──
export function PostEditor({ property, kind: kind0, item: item0, onClose, isMobile }) {
  const { sharedProps, setSharedProps, flushProps } = useData() || {};
  const { displayName } = useAuth() || {};
  const { jobs: ctrJobs, messages: ctrMessages } = useContractorData() || {};
  const { items, upsert } = usePosts();
  const live = (sharedProps || []).find((p) => p.id === property.id) || property;
  const latest = useRef(live); latest.current = live;
  const all = useMemo(() => photosOf(live, ctrJobs, ctrMessages), [live, ctrJobs, ctrMessages]);
  const [kind, setKind] = useState(kind0 || (item0 && item0.kind) || kindForStatus(property.status) || "listed");
  const itemId = `${property.id}:${kind}`;
  const saved = items.find((x) => x.id === itemId);
  const [fields, setFields] = useState(() => (saved && saved.fields) || defaultFields(live, kind));
  const [picks, setPicks] = useState(() => (saved && saved.photos && saved.photos.length ? saved.photos : defaultPicks(all, kind, saved && saved.fields)));
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [zUrl, setZUrl] = useState(live.zillowUrl || (saved && saved.zillowUrl) || "");
  const [linksOpen, setLinksOpen] = useState(false);
  const [links, setLinks] = useState("");
  const fileRef = useRef(null);
  const dirty = useRef(false);
  // Switching template loads that template's own saved draft (or fresh defaults).
  const switchKind = (k) => {
    if (k === kind) return;
    saveDraft();
    const s = items.find((x) => x.id === `${property.id}:${k}`);
    setKind(k); setFields((s && s.fields) || defaultFields(live, k)); setPicks(s && s.photos && s.photos.length ? s.photos : defaultPicks(all, k, s && s.fields)); dirty.current = false;
  };
  // Media photos may arrive after open (first load / Zillow copy) — fill empty picks.
  useEffect(() => { if (!picks.length && all.length) setPicks(defaultPicks(all, kind, fields)); }, [all.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => { dirty.current = true; setFields((f) => ({ ...f, [k]: v })); };
  const toggle = (url) => { dirty.current = true; setPicks((p) => (p.includes(url) ? p.filter((u) => u !== url) : [...p, url].slice(0, kind === "sold" ? 5 : 4))); };
  const cur = saved || { id: itemId, propId: property.id, kind, status: "draft" };
  const saveDraft = (extra = {}) => {
    if (!dirty.current && !Object.keys(extra).length) return;
    // An approved post that changed goes back to review, so Cowork never posts
    // an old picture; a posted one stays posted.
    upsert({ ...cur, id: itemId, propId: property.id, kind, fields, photos: picks, status: cur.status === "posted" ? "posted" : cur.status === "approved" && !dirty.current ? "approved" : "draft", ...extra });
    dirty.current = false;
  };
  const close = () => { saveDraft(); onClose(); };
  const pair = kind === "sold" && fields.beforeAfter !== false;
  const maxPicks = pair ? 5 : 4;
  const pickLabel = (i) => (pair ? (i === 0 ? "BEFORE" : i === 1 ? "AFTER" : String(i + 1)) : String(i + 1));
  // Sold: drop the before picture (or bring the oldest photo back as it).
  const setPair = (on) => {
    if (on === pair) return;
    set("beforeAfter", on);
    setPicks((p) => (on ? [all[0] && !p.includes(all[0].url) ? all[0].url : null, ...p].filter(Boolean).slice(0, 5) : p.slice(1)));
  };

  const addFiles = async (files) => {
    if (!files || !files.length) return;
    setBusy("Adding photos…"); setErr("");
    try {
      const got = await uploadToMedia(live, files, { updateProp: (id, key, val) => { setSharedProps((prev) => prev.map((p) => (p.id === id ? { ...p, [key]: val } : p))); if (flushProps) setTimeout(flushProps, 0); }, getLatest: () => latest.current, by: displayName, src: "upload" });
      dirty.current = true;
      setPicks((p) => [...p, ...got.filter((g) => g.kind === "photo").map((g) => g.url)].slice(0, maxPicks));
    } catch (e) { setErr(e.message || "Couldn't add those photos."); }
    setBusy("");
  };
  const askZillow = () => {
    const u = zUrl.trim();
    if (!/zillow\.com|redfin\.com|realtor\.com|homes\.com/i.test(u)) { setErr("Paste the Zillow (or Redfin / Realtor.com) link first."); return; }
    setErr("");
    setSharedProps((prev) => prev.map((p) => (p.id === property.id ? { ...p, zillowUrl: u } : p))); if (flushProps) setTimeout(flushProps, 0);
    dirty.current = true;
    saveDraft({ zillowUrl: u, zillowWanted: new Date().toISOString() });
  };
  const addLinks = async () => {
    setBusy("Copying photos…"); setErr("");
    const r = await addPhotoLinks(live, links, { setSharedProps, flushProps, getLatest: () => latest.current, by: displayName });
    setBusy("");
    if (!r.added) { setErr(r.failed ? "Those pictures wouldn't copy — save them to the phone/computer and use ＋ Add photos." : "No picture links found."); return; }
    setLinks(""); setLinksOpen(false);
    if (cur.zillowWanted) { dirty.current = true; saveDraft({ zillowWanted: null, zillowDoneAt: new Date().toISOString() }); }
    if (r.failed) setErr(`${r.added} added, ${r.failed} wouldn't copy.`);
  };
  const approve = async () => {
    if (!picks.length) { setErr("Pick at least one photo — the front of the house first."); return; }
    setBusy("Making the picture…"); setErr("");
    try {
      const blob = await renderBlob(fields, picks);
      const path = `posts/${slug(property.address)}-${kind}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("attachments").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("attachments").getPublicUrl(path);
      upsert({ ...cur, id: itemId, propId: property.id, kind, fields, photos: picks, status: "approved", imageUrl: data.publicUrl, caption: fields.caption, approvedAt: new Date().toISOString(), approvedBy: displayName || "" });
      dirty.current = false;
      setBusy(""); onClose();
    } catch (e) { setBusy(""); setErr(e.message || "Couldn't save the picture."); }
  };
  const savePic = async () => {
    setBusy("Making the picture…"); setErr("");
    try { saveBlob(await renderBlob(fields, picks), `${slug(property.address)}-${kind}.jpg`); } catch (e) { setErr(e.message || "Couldn't make the picture."); }
    setBusy("");
  };
  const status = cur.status;
  const addr = `${live.address}${live.city ? ` · ${live.city}` : ""}`;

  const footer = <>
    {err && <div style={{ color: T.red, fontSize: 13, fontWeight: 600, textAlign: "center" }}>{err}</div>}
    {status === "approved" && <div style={{ fontSize: 13, color: T.textSub, textAlign: "center" }}>✓ Approved — in Ready to post. It goes on Facebook when you tell Cowork “post my approved flyers” (or your scheduled task runs).</div>}
    {status === "posted" && <div style={{ fontSize: 13, color: T.green, textAlign: "center", fontWeight: 600 }}>✓ Posted {cur.postedAt ? new Date(cur.postedAt).toLocaleDateString() : ""}</div>}
    <button disabled={!!busy} onClick={approve} style={{ ...BTN_P, opacity: busy ? 0.6 : 1 }}>{busy || (status === "approved" ? "✓ Re-approve with changes" : status === "posted" ? "✓ Approve again (post again)" : "✓ Approve — ready to post")}</button>
    <button disabled={!!busy} onClick={savePic} style={BTN_S}>Save picture</button>
  </>;

  return (
    <Sheet onClose={close} isMobile={isMobile} footer={footer}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>Facebook post</div>
          <div style={{ fontSize: 13, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{addr}</div>
        </div>
        <button onClick={close} aria-label="Close" style={{ width: 44, height: 44, borderRadius: 22, border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <span style={{ width: 30, height: 30, borderRadius: 15, background: "rgba(118,118,128,0.12)", color: T.textSub, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✕</span>
        </button>
      </div>
      <div style={{ ...SEG, margin: "12px 0" }}>{POST_KINDS.map((k) => <button key={k.key} onClick={() => switchKind(k.key)} style={segBtn(kind === k.key)}>{k.label}</button>)}</div>
      <div style={{ maxWidth: isMobile ? 300 : 340, margin: "0 auto" }}><FlyerCanvas fields={fields} photos={picks} /></div>

      {kind === "sold" && <div style={{ ...SEG, marginTop: 14 }}>
        <button onClick={() => setPair(true)} style={segBtn(pair)}>Before &amp; after</button>
        <button onClick={() => setPair(false)} style={segBtn(!pair)}>After only</button>
      </div>}
      <div style={LAB}>Photos · tap in order — {pair ? "#1 before, #2 after" : "#1 is the big one"}</div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, scrollbarWidth: "none" }}>
        <button onClick={() => fileRef.current && fileRef.current.click()} style={{ flex: "0 0 72px", height: 72, borderRadius: 12, border: `1.5px dashed ${T.gold}`, background: "#fff", color: T.gold, fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.2 }}>＋<br />Add photos</button>
        <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        {/* picked ones first, in order; then everything else, newest first */}
        {[...picks.map((u) => all.find((m) => m.url === u) || { url: u }), ...[...all].reverse().filter((m) => !picks.includes(m.url))].map((m) => {
          const i = picks.indexOf(m.url);
          return (
            <button key={m.url} onClick={() => toggle(m.url)} style={{ flex: "0 0 72px", height: 72, borderRadius: 12, border: "none", padding: 0, cursor: "pointer", position: "relative", background: `#ddd url("${m.url}") center/cover`, boxShadow: i >= 0 ? `0 0 0 2.5px ${T.gold}` : "none", opacity: i >= 0 || picks.length < maxPicks ? 1 : 0.55 }}>
              {i >= 0 && <span style={{ position: "absolute", top: 4, left: 4, minWidth: 20, height: 20, padding: "0 5px", boxSizing: "border-box", borderRadius: 10, background: T.gold, color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 2px #fff" }}>{pickLabel(i)}</span>}
              {m.src === "zillow" && <span style={{ position: "absolute", bottom: 3, right: 4, fontSize: 10, fontWeight: 700, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.6)" }}>Zillow</span>}
            </button>
          );
        })}
        {!all.length && <div style={{ fontSize: 13, color: T.textSub, alignSelf: "center" }}>No photos in this property's Media yet.</div>}
      </div>

      <div style={LAB}>Zillow photos</div>
      <div style={{ background: "#fff", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <input value={zUrl} onChange={(e) => setZUrl(e.target.value)} placeholder="Paste the Zillow link" style={{ ...INPUT, background: T.bg }} />
        <button onClick={askZillow} style={{ ...BTN_S, background: T.goldLight, color: T.gold }}>{cur.zillowWanted ? "⏳ Waiting for Cowork — tap to ask again" : "Get Zillow photos (Cowork)"}</button>
        <div style={{ fontSize: 12, color: T.textSub, lineHeight: 1.4 }}>Your Cowork opens the link in your Chrome and copies the photos into this property's Media (computer must be on). Or save photos from the Zillow app and use ＋ Add photos.</div>
        {!linksOpen ? <button onClick={() => setLinksOpen(true)} style={{ ...chip(false), alignSelf: "flex-start" }}>Paste photo links</button> : <>
          <textarea value={links} onChange={(e) => setLinks(e.target.value)} placeholder="Photo links, one per line" rows={3} data-role="photo-links" style={{ ...INPUT, background: T.bg, minHeight: 80, resize: "vertical" }} />
          <button disabled={!!busy} onClick={addLinks} style={BTN_S}>Add these photos</button>
        </>}
      </div>

      <div style={LAB}>Top line</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{KICKERS[kind].map((k) => <button key={k} onClick={() => set("kicker", k)} style={chip(fields.kicker === k)}>{k}</button>)}</div>
      <div style={LAB}>Words</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <input value={fields.title} onChange={(e) => set("title", e.target.value)} placeholder={kind === "purchased" ? "Town" : "Address"} aria-label="Headline" style={INPUT} />
        <input value={fields.sub} onChange={(e) => set("sub", e.target.value)} placeholder="Second line" aria-label="Second line" style={INPUT} />
        <input value={fields.note} onChange={(e) => set("note", e.target.value)} placeholder="Italic line (optional)" aria-label="Italic line" style={INPUT} />
        <input value={fields.cta} onChange={(e) => set("cta", e.target.value)} placeholder={kind === "listed" ? "Message us for pricing & a private showing" : "Bottom bar"} aria-label="Bottom bar" style={INPUT} />
        <input value={fields.phone} onChange={(e) => set("phone", e.target.value)} placeholder="Phone for the bottom bar (optional)" aria-label="Phone" inputMode="tel" style={INPUT} />
      </div>
      {kind === "purchased" && <div style={{ fontSize: 12, color: T.textSub, margin: "6px 4px 0" }}>Town only — the street address is never shown on a purchase.</div>}
      {kind !== "purchased" && <>
        <div style={LAB}>Details</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
          {[...(kind === "sold" ? [["days", "Days to sell"]] : []), ["beds", "Beds"], ["baths", "Baths"], ["sqft", "Sq ft"], ["lot", "Lot (acres)"], ...(kind === "sold" ? [] : [["year", "Year built"]])].map(([k, l]) => (
            <label key={k} style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: T.textSub, fontWeight: 600 }}>{l}<input value={fields[k] || ""} onChange={(e) => set(k, e.target.value)} inputMode="decimal" style={{ ...INPUT, minHeight: 40, padding: "8px 10px" }} /></label>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <button onClick={() => set("showPrice", !fields.showPrice)} style={chip(!!fields.showPrice)}>{fields.showPrice ? "✓ Show price" : "Show price"}</button>
          {fields.showPrice && <input value={fields.price} onChange={(e) => set("price", e.target.value)} placeholder="$549,000" inputMode="decimal" style={{ ...INPUT, flex: 1 }} />}
        </div>
      </>}
      <div style={LAB}>Caption</div>
      <textarea value={fields.caption || ""} onChange={(e) => set("caption", e.target.value)} rows={4} style={{ ...INPUT, minHeight: 96, resize: "vertical", lineHeight: 1.4 }} />
    </Sheet>
  );
}

// ── 📣 button on a property page (admins) ──
export function PostButton({ property, isMobile }) {
  const { isAdmin } = useAuth() || {};
  const [open, setOpen] = useState(false);
  if (!isAdmin || !property || property.status === "New Leads") return null;
  return <>
    <button onClick={() => setOpen(true)} title="Make a Facebook post for this property" style={{ minHeight: 32, padding: "0 12px", borderRadius: 16, border: "1px solid rgba(0,0,0,0.05)", background: "rgba(118,118,128,0.08)", color: T.text, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>📣 Post</button>
    {open && <PostEditor property={property} onClose={() => setOpen(false)} isMobile={isMobile} />}
  </>;
}

// ── "Ready to post" card (dashboard / properties) ──
export function PostsNudge({ onOpen }) {
  const { isAdmin } = useAuth() || {};
  const { sharedProps } = useData() || {};
  const { items } = usePosts();
  const drafts = items.filter((x) => x.status === "draft" && x.auto && (sharedProps || []).some((p) => p.id === x.propId && !p.archived));
  if (!isAdmin || !drafts.length) return null;
  const p = (sharedProps || []).find((x) => x.id === drafts[0].propId) || {};
  return (
    <div style={{ margin: "8px 12px 0", background: "#fff", borderRadius: 16, padding: "10px 12px", display: "flex", alignItems: "center", gap: 12, boxShadow: T.shadow, flexShrink: 0 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: T.goldLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>📣</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 15, fontWeight: 650, color: T.text }}>{drafts.length === 1 ? "Ready to post" : `${drafts.length} posts ready`}</div>
        <div style={{ fontSize: 13, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{KIND_LABEL[drafts[0].kind]} · {p.address || ""}{drafts.length > 1 ? ` +${drafts.length - 1} more` : ""}</div>
      </div>
      <button onClick={onOpen} style={{ minHeight: 36, padding: "0 16px", borderRadius: 18, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 14, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>Review</button>
    </div>
  );
}

// ── 📣 Social Posts page (also what Cowork opens: /?goto=posts) ──
export function PostsPage({ isMobile }) {
  const { sharedProps, setSharedProps, flushProps } = useData() || {};
  const { displayName } = useAuth() || {};
  const { items, upsert, remove } = usePosts();
  const [tab, setTab] = useState("review");
  const [edit, setEdit] = useState(null); // {property, kind}
  const [pickNew, setPickNew] = useState(false);
  const [q, setQ] = useState("");
  const [links, setLinks] = useState({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const propOf = (id) => (sharedProps || []).find((p) => p.id === id);
  const live = items.filter((x) => propOf(x.propId));
  const by = (s) => live.filter((x) => x.status === s).sort((a, b) => String(b.approvedAt || b.updatedAt || b.createdAt || "").localeCompare(String(a.approvedAt || a.updatedAt || a.createdAt || "")));
  const review = by("draft"), ready = by("approved"), posted = by("posted");
  const zillow = live.filter((x) => x.zillowWanted);
  const list = tab === "review" ? review : tab === "ready" ? ready : posted;
  const markPosted = (it) => upsert({ ...it, status: "posted", postedAt: new Date().toISOString() });
  const copy = async (t) => { try { await navigator.clipboard.writeText(t || ""); setMsg("Caption copied"); } catch { setMsg("Couldn't copy — select the text instead"); } setTimeout(() => setMsg(""), 2000); };
  const addLinks = async (it) => {
    const p = propOf(it.propId); if (!p) return;
    setBusy(it.id);
    const r = await addPhotoLinks(p, links[it.id], { setSharedProps, flushProps, getLatest: () => propOf(it.propId), by: displayName || "Cowork" });
    setBusy("");
    if (r.added) { upsert({ ...it, zillowWanted: null, zillowDoneAt: new Date().toISOString() }); setLinks((l) => ({ ...l, [it.id]: "" })); setMsg(`${r.added} photo${r.added === 1 ? "" : "s"} added${r.failed ? `, ${r.failed} wouldn't copy` : ""}`); }
    else setMsg(r.failed ? "Those pictures wouldn't copy — download them and use ＋ Add photos on the post." : "No picture links found.");
    setTimeout(() => setMsg(""), 4000);
  };
  const cands = (sharedProps || []).filter((p) => !p.archived && p.status !== "New Leads" && (!q.trim() || `${p.address} ${p.city || ""}`.toLowerCase().includes(q.trim().toLowerCase())));
  const thumbOf = (it) => { const p = propOf(it.propId); const ph = p ? (p.media || []).find((m) => m && m.kind === "photo" && m.url) : null; return it.imageUrl || (it.photos && it.photos[0]) || (ph && ph.url) || ""; };

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "12px 12px 90px" : "20px 28px 40px" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: isMobile ? 24 : 28, fontWeight: 700, color: T.text, letterSpacing: "-0.4px" }}>Social Posts</div>
            <div style={{ fontSize: 13, color: T.textSub }}>You approve · then say “post my approved flyers” in Cowork</div>
          </div>
          <button onClick={() => setPickNew(true)} style={{ minHeight: 40, padding: "0 16px", borderRadius: 20, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>＋ New post</button>
        </div>
        <div style={{ ...SEG, marginBottom: 12 }}>
          <button onClick={() => setTab("review")} style={segBtn(tab === "review")}>To review{review.length ? ` (${review.length})` : ""}</button>
          <button onClick={() => setTab("ready")} style={segBtn(tab === "ready")} data-role="ready-tab">Ready to post{ready.length ? ` (${ready.length})` : ""}</button>
          <button onClick={() => setTab("posted")} style={segBtn(tab === "posted")}>Posted</button>
        </div>
        {msg && <div style={{ position: "fixed", left: "50%", bottom: 100, transform: "translateX(-50%)", background: "rgba(28,28,30,0.9)", color: "#fff", borderRadius: 18, padding: "8px 16px", fontSize: 13, fontWeight: 600, zIndex: 50 }}>{msg}</div>}

        {zillow.length > 0 && <div data-role="zillow-requests" style={{ background: "#fff", borderRadius: 16, padding: 14, marginBottom: 14, boxShadow: T.shadow }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>⏳ Zillow photos requested</div>
          <div style={{ fontSize: 12, color: T.textSub, margin: "2px 0 8px" }}>For Cowork: open each link, copy the full-size photo links, paste them here (one per line) and tap Add photos.</div>
          {zillow.map((it) => { const p = propOf(it.propId); return (
            <div key={it.id} data-post-id={it.id} style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, marginTop: 10 }}>
              <div style={{ fontSize: 14, fontWeight: 650, color: T.text }}>{p.address}{p.city ? `, ${p.city}` : ""}</div>
              <a href={it.zillowUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: T.blue, wordBreak: "break-all" }}>{it.zillowUrl}</a>
              <textarea value={links[it.id] || ""} onChange={(e) => setLinks((l) => ({ ...l, [it.id]: e.target.value }))} placeholder="Photo links, one per line" rows={3} aria-label={`Photo links for ${p.address}`} style={{ ...INPUT, background: T.bg, marginTop: 8, minHeight: 72 }} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button disabled={busy === it.id} onClick={() => addLinks(it)} style={{ ...BTN_S, flex: 1, background: T.goldLight, color: T.gold }}>{busy === it.id ? "Copying…" : "Add photos"}</button>
                <button onClick={() => upsert({ ...it, zillowWanted: null })} style={{ ...BTN_S, flex: "0 0 auto", width: "auto", padding: "0 16px" }}>Cancel</button>
              </div>
            </div>); })}
        </div>}

        {!list.length && <div style={{ textAlign: "center", color: T.textSub, fontSize: 14, padding: "40px 12px" }}>
          {tab === "review" ? "Nothing to review. A house moving to Purchased, On Market or Sold puts a post here — or tap ＋ New post." : tab === "ready" ? "Nothing waiting — approved posts show here until Cowork posts them." : "Nothing posted yet."}
        </div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((it) => { const p = propOf(it.propId); const t = thumbOf(it); return (
            <div key={it.id} data-post-id={it.id} data-status={it.status} style={{ background: "#fff", borderRadius: 16, padding: 12, boxShadow: T.shadow }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <div onClick={() => setEdit({ property: p, kind: it.kind })} style={{ width: 64, height: 80, borderRadius: 8, flexShrink: 0, background: t ? `#eee url("${t}") center/cover` : T.goldLight, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, cursor: "pointer" }}>{t ? "" : "📣"}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 650, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.address}</div>
                  <div style={{ fontSize: 13, color: T.textSub }}>{KIND_LABEL[it.kind]}{p.city ? ` · ${p.city}` : ""}</div>
                  <div style={{ fontSize: 12, color: T.textTert, marginTop: 2 }}>{it.status === "posted" ? `Posted ${new Date(it.postedAt).toLocaleDateString()}` : it.status === "approved" ? `Approved ${new Date(it.approvedAt).toLocaleDateString()}` : `Since ${new Date(it.createdAt || it.updatedAt || Date.now()).toLocaleDateString()}`}</div>
                </div>
                {it.status === "draft" && <button onClick={() => setEdit({ property: p, kind: it.kind })} style={{ minHeight: 36, padding: "0 16px", borderRadius: 18, border: "none", background: T.gold, color: "#fff", fontWeight: 650, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>Review</button>}
              </div>
              {it.status === "approved" && <>
                <div style={{ fontSize: 13, color: T.gold, fontWeight: 600, marginTop: 10 }}>⏳ Waiting for Cowork — say “post my approved flyers” in Cowork</div>
                {it.imageUrl && <img src={it.imageUrl} alt="Flyer" data-role="flyer-image" style={{ width: "100%", maxWidth: 360, display: "block", margin: "12px auto 0", borderRadius: 8 }} />}
                <div data-role="caption" style={{ background: T.bg, borderRadius: 12, padding: "10px 12px", marginTop: 10, fontSize: 14, color: T.text, lineHeight: 1.4, whiteSpace: "pre-wrap", userSelect: "text" }}>{it.caption || ""}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                  <button onClick={() => downloadUrl(it.imageUrl, `${slug(p.address)}-${it.kind}.jpg`)} aria-label="Download picture" style={BTN_S}>⬇ Download picture</button>
                  <button onClick={() => copy(it.caption)} aria-label="Copy caption" style={BTN_S}>📋 Copy caption</button>
                  <button onClick={() => setEdit({ property: p, kind: it.kind })} style={BTN_S}>Edit</button>
                  <button onClick={() => markPosted(it)} aria-label="Mark posted" style={{ ...BTN_S, background: T.gold, color: "#fff" }}>✓ Mark posted</button>
                </div>
              </>}
              {it.status === "draft" && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <button onClick={() => upsert({ ...it, status: "dismissed" })} style={{ ...chip(false), background: "transparent" }}>Not this one</button>
              </div>}
              {it.status === "posted" && <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                {it.imageUrl && <button onClick={() => downloadUrl(it.imageUrl, `${slug(p.address)}-${it.kind}.jpg`)} style={{ ...chip(false), background: "transparent" }}>⬇ Picture</button>}
                <button onClick={() => { if (window.confirm("Remove this from the list? (It stays on Facebook.)")) remove(it.id); }} style={{ ...chip(false), background: "transparent" }}>Remove</button>
              </div>}
            </div>); })}
        </div>
      </div>

      {pickNew && <Sheet onClose={() => setPickNew(false)} isMobile={isMobile}>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 10 }}>Which property?</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address" style={{ ...INPUT, marginBottom: 10 }} />
        <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden" }}>
          {cands.slice(0, 60).map((p, i) => (
            <button key={p.id} onClick={() => { setPickNew(false); setEdit({ property: p, kind: kindForStatus(p.status) || "listed" }); }} style={{ width: "100%", minHeight: 52, textAlign: "left", border: "none", borderTop: i ? `1px solid ${T.border}` : "none", background: "#fff", padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text }}>{p.address}</div>
              <div style={{ fontSize: 12, color: T.textSub }}>{[p.city, p.status].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
        </div>
      </Sheet>}
      {edit && edit.property && <PostEditor property={edit.property} kind={edit.kind} onClose={() => setEdit(null)} isMobile={isMobile} />}
    </div>
  );
}
