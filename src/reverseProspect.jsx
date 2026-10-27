// 🎯 Reverse prospecting (Elie approved 10/27/26 mockup). Per property, the
// buyer's agents from MLS reverse-prospecting reports — Elie pulls them from
// many MLSs, so the fastest way in is a SCREENSHOT that Claude reads
// (api/ai/agents.js); a pasted list or CSV works too. Then one personalised
// pitch goes to every agent from the sender's own line, with the property's
// video walkthrough attached automatically when there is one (its cover
// picture + a gpflips.com/v/<uid> link — a whole walkthrough is far too big
// for a picture message). Replies come back into the normal text threads.
// Stored on the property: p.rpAgents[{id,name,cell,officePhone,cellFrom,email,
// office,buyers,note,addedAt,addedBy,source,sentAt,sentBy,followAt,lead}],
// p.rpPrice, p.rpVideoId, p.mlsSource (id in app_settings "mls_sources"),
// p.mlsNumber, p.rpCheckedAt. ONLY a cell is ever texted (Elie 10/27/26: MLS
// lists show office lines) — office numbers are kept apart, and a missing cell
// is filled from numbers the app already knows (ShowingTime, Contacts, other
// listings) or by Cowork reading each agent's MLS business card.
import { useEffect, useMemo, useRef, useState } from "react";
import { T } from "./theme";
import { useData } from "./data/DataProvider";
import { useSmsTexting } from "./sms";
import { qbAuthFetch, uploadAttachment } from "./net";
import { mediaOf, uploadToMedia } from "./mediaStore";

const DAY = 86400000;
const digits = (s) => { const d = String(s || "").replace(/\D/g, ""); return d.length === 11 && d[0] === "1" ? d.slice(1) : d; };
const fmtPhone = (s) => { const d = digits(s); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(s || ""); };
const firstOf = (n) => String(n || "").trim().split(/\s+/)[0] || "there";
const initials = (n) => String(n || "?").trim().split(/\s+/).slice(0, 2).map((x) => x[0] || "").join("").toUpperCase() || "?";
const AV = [["#FDECEA", "#C0392B"], ["#E9F2FB", "#1D6FB8"], ["#EAF7EE", "#1E7B3C"], ["#F3EAFB", "#7B3FB8"], ["#FFF4E5", "#B86E00"], ["#E8F6F8", "#127A8A"]];
const avC = (n) => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV[h % AV.length]; };
const shortDate = (iso) => { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return ""; } };
const money = (v) => { const n = parseFloat(String(v || "").replace(/[^0-9.]/g, "")); return n ? `$${Math.round(n).toLocaleString("en-US")}` : ""; };
const streetOf = (p) => String((p && p.address) || "").split(",")[0].trim();
// Same as api/v.js: "24A Dewey Dr, New Brunswick" → "24a-dewey-dr".
const slugOf = (addr) => String(addr || "").split(",")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const nameKey = (n) => String(n || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
const emailKey = (e) => String(e || "").toLowerCase().trim();

// Cell numbers the app already has for agents: ShowingTime (agents who showed
// our houses), Contacts saved as Mobile/Cell, and other listings' lists.
function knownCells({ showings, contacts, props, skipPropId }) {
  const byEmail = new Map(), byName = new Map();
  const put = (name, email, ph, from) => {
    const d = digits(ph);
    if (d.length !== 10) return;
    if (email && !byEmail.has(emailKey(email))) byEmail.set(emailKey(email), { d, from });
    if (name && nameKey(name).includes(" ") && !byName.has(nameKey(name))) byName.set(nameKey(name), { d, from });
  };
  (props || []).forEach((p) => { if (p && String(p.id) !== String(skipPropId)) (p.rpAgents || []).forEach((a) => { if (a && a.cell) put(a.name, a.email, a.cell, "another listing"); }); });
  (showings || []).forEach((x) => { if (x && x.phone) put(x.agent, x.email, x.phone, "ShowingTime"); });
  (contacts || []).forEach((c) => (c && c.phones || []).forEach((ph) => { if (/mob|cell/i.test(ph.label || "")) put(c.name, c.email, ph.number, "Contacts"); }));
  return (a, office) => {
    const hit = (a.email && byEmail.get(emailKey(a.email))) || byName.get(nameKey(a.name));
    return hit && !(office && office.has(hit.d)) ? hit : null;
  };
}
// Numbers that are office lines: anything filed as an office number, or one
// number shared by two different agents.
function officeSetOf(list) {
  const set = new Set(), seen = new Map();
  (list || []).forEach((a) => {
    const o = digits(a.officePhone); if (o.length === 10) set.add(o);
    [a.cell, a.phone].map(digits).filter((d) => d.length === 10).forEach((d) => { const n = nameKey(a.name); if (seen.has(d) && seen.get(d) !== n) set.add(d); else seen.set(d, n); });
  });
  return set;
}
// Stored agent → working agent: \`phone\` is the CELL we text ("" when unknown).
// Lists saved before 10/27/26 only had \`phone\` (mostly office lines).
function resolveAgent(a, find, office) {
  const raw = "cell" in a ? a : { ...a, cell: "", officePhone: a.officePhone || a.phone || "" };
  let d = digits(raw.cell), from = raw.cellFrom || (d.length === 10 ? "MLS" : "");
  if (d.length !== 10 || office.has(d)) { d = ""; from = ""; const k = find && find(raw, office); if (k) { d = k.d; from = k.from; } }
  return { ...raw, phone: d ? fmtPhone(d) : "", cellFrom: from, officePhone: raw.officePhone || "" };
}

// ── styles ───────────────────────────────────────────────────────────────────
const btn = (kind) => ({
  flex: 1, minHeight: 44, borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "0 12px",
  ...(kind === "gold" ? { background: T.gold, color: "#fff", border: "none" } : kind === "ghost" ? { background: "#FBF3DD", color: "#8a6d1f", border: "1px solid #E8D59E" } : { background: "#fff", color: T.text, border: `1px solid ${T.border}` }),
});
const chip = (on) => ({ fontSize: 12, fontWeight: 650, padding: "6px 11px", minHeight: 32, borderRadius: 100, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit", border: `1px solid ${on ? "#1C1C1E" : "#E5E5EA"}`, background: on ? "#1C1C1E" : "#fff", color: on ? "#fff" : "#3A3A3C", flexShrink: 0 });
// 🚫 Do-not-text list (Elie 10/27/26 — an agent replied "Please remove me from
// your text list"). Anyone who asks is never pitched again, from ANY listing:
// replies like this are caught automatically, and ••• → "Never text again"
// adds someone by hand. Shared by the team: app_settings "sms_optout"
// {phones:{<10 digits>:{at,by,why,name}}}.
export const OPT_OUT_RE = /^\s*stop\s*\.?\s*$|stop (texting|messaging|sending)|unsubscribe|remove me|take me off|off (of )?(your|the|this) (text |texting |mailing )?list|don'?t (text|message|contact) me|do not (text|message|contact)|no more (texts|messages)|opt(ed)?[- ]?out/i;
export function useOptOut() {
  const { appSettings, setAppSettings, flushAppSettings, currentUser } = useData() || {};
  const phones = (((appSettings || []).find((x) => x.id === "sms_optout") || {}).phones) || {};
  const save = (next) => { setAppSettings((prev) => [...(prev || []).filter((x) => x.id !== "sms_optout"), { id: "sms_optout", phones: next }]); if (flushAppSettings) setTimeout(flushAppSettings, 0); };
  return {
    has: (ph) => !!phones[digits(ph)],
    add: (list) => { const n = { ...phones }; let ch = false; list.forEach(({ phone, why, name }) => { const d = digits(phone); if (d.length === 10 && !n[d]) { n[d] = { at: new Date().toISOString(), by: currentUser || "", why: String(why || "").slice(0, 160), name: name || "" }; ch = true; } }); if (ch) save(n); },
    remove: (ph) => { const n = { ...phones }; delete n[digits(ph)]; save(n); },
  };
}
const PILL = {
  new: ["NOT TEXTED", "#FBF3DD", "#8a6d1f"], texted: ["TEXTED", "#F2F2F7", "#6E6E73"], replied: ["REPLIED", "#E9F2FB", "#1D6FB8"],
  hot: ["🔥 INTERESTED", "#FDECEA", "#C0392B"], not: ["NOT INTERESTED", "#F2F2F7", "#AEAEB2"], nophone: ["NEEDS CELL", "#FFF4E5", "#B86E00"],
  optout: ["🚫 DON'T TEXT", "#FDECEA", "#C0392B"],
};
const HDR = { fontSize: 11.5, fontWeight: 700, color: T.textSub, letterSpacing: 0.3, textTransform: "uppercase" };

function Sheet({ title, onClose, children, footer, wide }) {
  const phone = typeof window !== "undefined" && window.innerWidth < 760;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 420, background: "rgba(0,0,0,0.32)", display: "flex", alignItems: phone ? "flex-end" : "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", width: phone ? "100%" : `min(${wide ? 640 : 520}px, 94vw)`, maxHeight: phone ? "92vh" : "88vh", borderRadius: phone ? "22px 22px 0 0" : 20, display: "flex", flexDirection: "column", boxShadow: "0 -6px 30px rgba(0,0,0,0.18)", paddingBottom: phone ? "env(safe-area-inset-bottom)" : 0 }}>
        {phone && <div style={{ width: 38, height: 5, borderRadius: 3, background: "#D1D1D6", margin: "8px auto 0" }} />}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 8px" }}>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: T.text }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ width: 44, height: 44, margin: -7, borderRadius: 22, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ width: 30, height: 30, borderRadius: 15, background: "#F2F2F7", color: T.textSub, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</span>
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 14px" }}>{children}</div>
        {footer && <div style={{ padding: "10px 16px 14px", borderTop: `1px solid ${T.border}` }}>{footer}</div>}
      </div>
    </div>
  );
}

// Screenshots → small JPEGs (the AI reads them fine; keeps the upload light).
async function shrink(file, max = 1800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.86);
  } finally { URL.revokeObjectURL(url); }
}

// ── 1. Add agents: screenshots (main), paste, or CSV ─────────────────────────
function ImportSheet({ property, find, onAdd, onClose }) {
  const [shots, setShots] = useState([]); // [{name,data}]
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [found, setFound] = useState(null); // [{...agent, pick, why}]
  const picRef = useRef(null), csvRef = useRef(null);
  const have = property.rpAgents || [];
  const addFiles = async (files) => {
    const imgs = Array.from(files || []).filter((f) => /^image\//.test(f.type || "")).slice(0, 6);
    const out = [];
    for (const f of imgs) { try { out.push({ name: f.name || "screenshot", data: await shrink(f) }); } catch { /* unreadable picture */ } }
    setShots((s) => [...s, ...out].slice(0, 6));
  };
  const read = async () => {
    setBusy(true); setErr("");
    try {
      const r = await qbAuthFetch("/api/ai/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: shots.map((s) => s.data), text }) });
      // A list Elie pasted or typed himself: an unlabeled number is the cell
      // (only screenshots of MLS rosters default to office lines).
      const typed = !shots.length;
      const got = (r.agents || []).map((a) => ({ ...a, cell: a.cell || (typed ? a.office_phone || "" : ""), officePhone: typed && !a.cell ? "" : a.office_phone || "" }));
      const office = officeSetOf([...have, ...got]);
      const seenPh = new Set(have.map((a) => digits(a.cell)).filter((d) => d.length === 10));
      const seenEm = new Set(have.map((a) => emailKey(a.email)).filter(Boolean));
      const seenNm = new Set(have.map((a) => nameKey(a.name)).filter(Boolean));
      const list = got.map((a) => {
        const w = resolveAgent(a, find, office);
        const d = digits(w.phone);
        const dup = (d && seenPh.has(d)) || (a.email && seenEm.has(emailKey(a.email))) || seenNm.has(nameKey(a.name));
        const why = dup ? "dup" : d ? "new" : "nophone";
        return { ...a, cell: w.phone, cellFrom: w.cellFrom, officePhone: w.officePhone || (digits(a.cell).length === 10 && office.has(digits(a.cell)) ? a.cell : ""), why, pick: !dup };
      });
      if (!list.length) setErr("No agents found — try a clearer screenshot, or paste the list.");
      setFound(list);
    } catch (e) { setErr(e.message || "Couldn't read it."); }
    setBusy(false);
  };
  const picked = (found || []).filter((a) => a.pick);
  const counts = found ? { n: found.filter((a) => a.why === "new").length, d: found.filter((a) => a.why === "dup").length, x: found.filter((a) => a.why === "nophone").length } : null;
  // (why "nophone" = no CELL — office lines are never texted)
  return (
    <Sheet title="Add reverse-prospecting agents" onClose={onClose} wide
      footer={found
        ? <div style={{ display: "flex", gap: 8 }}><button onClick={() => setFound(null)} style={btn()}>‹ Back</button><button disabled={!picked.length} onClick={() => onAdd(picked)} style={{ ...btn("gold"), flex: 2, opacity: picked.length ? 1 : 0.5 }}>Add {picked.length} agent{picked.length === 1 ? "" : "s"}</button></div>
        : <button disabled={busy || (!shots.length && !text.trim())} onClick={read} style={{ ...btn("gold"), width: "100%", opacity: busy || (!shots.length && !text.trim()) ? 0.5 : 1 }}>{busy ? "Reading…" : "Read the agents"}</button>}>
      {!found ? (
        <div onPaste={(e) => { const fs = Array.from(e.clipboardData?.files || []); if (fs.length) { e.preventDefault(); addFiles(fs); } }}>
          <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.5, marginBottom: 10 }}>Screenshot the reverse-prospecting page from any MLS — as many pictures as it takes (up to 6). The app reads the agents' names, phones, emails and offices.</div>
          <input ref={picRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={csvRef} type="file" accept=".csv,.txt,text/csv,text/plain" style={{ display: "none" }} onChange={async (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) setText(await f.text()); }} />
          <button onClick={() => picRef.current && picRef.current.click()} style={{ width: "100%", border: "1.5px dashed #D9C48A", background: "#FFFCF3", borderRadius: 14, padding: "16px 12px", cursor: "pointer", fontFamily: "inherit", textAlign: "center" }}>
            <div style={{ fontSize: 24 }}>📸</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginTop: 2 }}>{shots.length ? "Add more screenshots" : "Choose screenshots"}</div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 3 }}>On a computer you can also paste a screenshot here (Ctrl/⌘ + V)</div>
          </button>
          {shots.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {shots.map((s, i) => (
                <div key={i} style={{ position: "relative", width: 76, height: 96, borderRadius: 10, overflow: "hidden", border: `1px solid ${T.border}` }}>
                  <img src={s.data} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => setShots((x) => x.filter((_, j) => j !== i))} aria-label="Remove" style={{ position: "absolute", top: 2, right: 2, width: 26, height: 26, borderRadius: 13, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 12, cursor: "pointer" }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ ...HDR, marginTop: 16 }}>Or paste the list</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste names and phone numbers, or a whole report…" rows={4} style={{ width: "100%", boxSizing: "border-box", marginTop: 6, border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px", fontSize: 14, fontFamily: "inherit", resize: "vertical", outline: "none" }} />
          <button onClick={() => csvRef.current && csvRef.current.click()} style={{ marginTop: 6, background: "none", border: "none", color: T.gold, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", padding: "8px 0", minHeight: 44 }}>📄 Or open a CSV file</button>
          {err && <div style={{ color: T.red, fontSize: 13, fontWeight: 600, marginTop: 6 }}>{err}</div>}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 100, background: "#EAF7EE", color: "#1E7B3C" }}>{counts.n} with a cell</span>
            {counts.d > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 100, background: "#F2F2F7", color: T.textSub }}>{counts.d} already on the list</span>}
            {counts.x > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 100, background: "#FDECEA", color: "#C0392B" }}>{counts.x} need a cell</span>}
          </div>
          <div style={{ marginTop: 8, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
            {found.map((a, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i ? `1px solid ${T.border}` : "none", cursor: "pointer", background: a.pick ? "#fff" : "#FAFAFA" }}>
                <input type="checkbox" checked={!!a.pick} onChange={() => setFound((f) => f.map((x, j) => (j === i ? { ...x, pick: !x.pick } : x)))} style={{ width: 20, height: 20, accentColor: T.gold, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: a.pick ? T.text : T.textTert }}>{a.name || "(no name)"}{a.buyers > 1 && <span style={{ fontSize: 11.5, fontWeight: 600, color: T.textSub }}> · {a.buyers} buyers</span>}</div>
                  <div style={{ fontSize: 12, color: a.why === "nophone" ? "#C0392B" : T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.why === "dup" ? "Already on the list" : a.why === "nophone" ? `Needs a cell${a.officePhone ? ` · office ${fmtPhone(a.officePhone)}` : ""}${a.office ? ` · ${a.office}` : ""}` : [`📱 ${fmtPhone(a.cell)}`, a.cellFrom && a.cellFrom !== "MLS" ? `from ${a.cellFrom}` : "", a.office].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {a.why === "nophone" && digits(a.officePhone).length === 10 && (
                  <button onClick={(e) => { e.preventDefault(); setFound((f) => f.map((x, j) => (j === i ? { ...x, cell: fmtPhone(x.officePhone), cellFrom: "typed", officePhone: "", why: "new", pick: true } : x))); }}
                    style={{ flexShrink: 0, minHeight: 36, padding: "0 10px", borderRadius: 100, border: "1px solid #E8D59E", background: "#FBF3DD", color: "#8a6d1f", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>📱 It's a cell</button>
                )}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.textSub, marginTop: 8, lineHeight: 1.45 }}>Only cell numbers get texted. MLS lists usually show office lines — Cowork's Monday/Thursday check reads each agent's business card for the cell. Agents are also saved to Contacts (tag “Agent”).</div>
        </div>
      )}
    </Sheet>
  );
}

// ── 2. The pitch ─────────────────────────────────────────────────────────────
// Standard wording (Elie 10/27/26: rewritten to read like a person texting).
// Elie can replace any of them with his own — "⭐ Save as my wording" stores it
// with {address} {town} {price} {facts} {me} placeholders (app_settings
// "rp_pitches"), and every teammate's pitch then starts from it.
const PITCHES = [
  ["listed", "🏡 Just listed", (f) => `Hi {first}, this is ${f.me} with Goldstone Properties. I noticed you have buyers looking in ${f.town || "the area"}, and we just listed ${f.address}${f.facts ? `, a ${f.reno ? "fully renovated " : ""}${f.facts}` : f.reno ? ", fully renovated" : ""}${f.price ? ` at ${f.price}` : ""}. Could it work for any of your clients? Happy to set up a showing.`],
  ["drop", "💲 Price drop", (f) => `Hi {first}, ${f.me} with Goldstone Properties here. We just dropped the price on ${f.address}${f.town ? ` in ${f.town}` : ""}${f.price ? ` to ${f.price}` : ""}${f.reno ? ". It's fully renovated" : ""}. I know you have buyers searching in the area. Would any of them want to take a look?`],
  ["open", "🚪 Open house", (f) => `Hi {first}, ${f.me} with Goldstone Properties. We're having an open house at ${f.address}${f.town ? ` in ${f.town}` : ""}${f.facts || f.reno ? ` (${[f.reno && "fully renovated", f.facts].filter(Boolean).join(", ")})` : ""}. Since your buyers are searching in the area, feel free to bring them by, or I can set up a private showing.`],
  ["follow", "🔁 Follow-up", (f) => `Hi {first}, ${f.me} from Goldstone Properties again. Just checking in on ${f.address}. Did any of your buyers want to see it? Happy to work around their schedule.`],
];
const TOKENS = ["address", "town", "price", "facts", "me"];
const fillTokens = (t, f) => TOKENS.reduce((x, k) => x.split(`{${k}}`).join(f[k] || ""), String(t || "")).replace(/ ,/g, ",").replace(/ {2,}/g, " ").trim();
// The text on screen → a reusable template: the property's own details become placeholders.
const toTokens = (t, f) => TOKENS.map((k) => [k, f[k]]).filter(([, v]) => v && String(v).length > 1).sort((x, y) => String(y[1]).length - String(x[1]).length)
  .reduce((x, [k, v]) => x.split(String(v)).join(`{${k}}`), String(t || ""));
// "ALEXANDRIA" → "Alexandria" (MLS rosters often shout names).
const niceFirst = (n) => { const f = firstOf(n); return f === f.toUpperCase() && f.length > 1 ? f[0] + f.slice(1).toLowerCase() : f; };

// 🎞 Any moment of the walkthrough as the cover: a row of stills across the
// video plus a slider for the exact second (Cloudflare renders the frame).
function FramePicker({ video, frameAt, onPick, onClose }) {
  const [dur, setDur] = useState(Number(video.dur) || 0);
  const [t, setT] = useState(2);
  const [shown, setShown] = useState(2);
  const tm = useRef(null);
  useEffect(() => {
    if (dur || !video.uid) return;
    qbAuthFetch(`/api/stream/upload?uid=${encodeURIComponent(video.uid)}`).then((d) => { if (d && d.duration > 0) setDur(d.duration); }).catch(() => setDur(60));
  }, [video.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = Math.max(1, Math.floor(dur || 60));
  const marks = Array.from({ length: 12 }, (_, i) => Math.round(((i + 0.5) / 12) * total));
  const move = (v) => { setT(v); clearTimeout(tm.current); tm.current = setTimeout(() => setShown(v), 250); };
  const clock = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`;
  return (
    <Sheet title="Pick a moment from the video" onClose={onClose} wide
      footer={<button onClick={() => onPick(frameAt(video, shown))} style={{ ...btn("gold"), width: "100%", minHeight: 48, fontSize: 15 }}>Use this picture</button>}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 10", borderRadius: 14, overflow: "hidden", background: "#111" }}>
        <img src={frameAt(video, shown)} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
        <span style={{ position: "absolute", left: 10, bottom: 8, color: "#fff", fontSize: 12.5, fontWeight: 700, background: "rgba(0,0,0,0.5)", borderRadius: 8, padding: "2px 7px" }}>{clock(shown)}</span>
      </div>
      <input type="range" min={0} max={total} step={1} value={t} onChange={(e) => move(Number(e.target.value))} aria-label="Moment in the video"
        style={{ width: "100%", marginTop: 12, accentColor: T.gold, height: 32 }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: T.textTert }}><span>0:00</span><span>{clock(t)}</span><span>{clock(total)}</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))", gap: 6, marginTop: 10 }}>
        {marks.map((m) => (
          <button key={m} onClick={() => { setT(m); setShown(m); }} aria-label={`Frame at ${clock(m)}`}
            style={{ position: "relative", aspectRatio: "1", minHeight: 44, padding: 0, borderRadius: 10, overflow: "hidden", cursor: "pointer", background: "#222", border: shown === m ? `3px solid ${T.gold}` : `1px solid ${T.border}` }}>
            <img src={frameAt(video, m).replace("height=1080", "height=240")} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 10.5, fontWeight: 700 }}>{clock(m)}</span>
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: T.textSub, marginTop: 10, lineHeight: 1.45 }}>Tap a still, or slide to the exact second. The picture goes to agents in high quality right after your text.</div>
    </Sheet>
  );
}

function PitchSheet({ property, targets, mode, getLatest, onUpdate, onSent, onClose }) {
  const { currentUser, appSettings, setAppSettings, flushAppSettings } = useData() || {};
  const mine = (((appSettings || []).find((x) => x.id === "rp_pitches") || {}).texts) || {};
  const { send, from } = useSmsTexting();
  const me = firstOf(currentUser || "");
  const pi = property.propertyInfo || {};
  const [price, setPrice] = useState(property.rpPrice || "");
  // "Fully renovated" only when Elie ticks it (Elie 10/27/26) — remembered per property.
  const [reno, setReno] = useState(!!property.rpReno);
  const fields = (pr, rn = reno) => ({
    reno: rn,
    me, town: property.city || "", address: streetOf(property), price: money(pr),
    facts: [pi.beds && `${pi.beds} bed`, pi.baths && `${pi.baths} bath`].filter(Boolean).join(" / "),
  });
  const [kind, setKind] = useState(mode === "follow" ? "follow" : "listed");
  const build = (k, pr, rn = reno) => (mine[k] ? fillTokens(mine[k], fields(pr, rn)) : (PITCHES.find((x) => x[0] === k) || PITCHES[0])[2](fields(pr, rn)));
  const [savedNote, setSavedNote] = useState("");
  const saveMine = (texts) => { setAppSettings((prev) => [...(prev || []).filter((x) => x.id !== "rp_pitches"), { id: "rp_pitches", texts }]); if (flushAppSettings) setTimeout(flushAppSettings, 0); };
  const [msg, setMsg] = useState(() => build(mode === "follow" ? "follow" : "listed", property.rpPrice || ""));
  const lastAuto = useRef(msg);
  const reTemplate = (k, pr, rn = reno) => { const t = build(k, pr, rn); setMsg(t); lastAuto.current = t; };

  // The walkthrough video: the one picked for this property, else the newest.
  const videos = useMemo(() => mediaOf(property).filter((m) => m.kind === "video" && m.uid), [property]);
  const [vidId, setVidId] = useState(() => (property.rpVideoId === "none" ? "none" : (videos.find((v) => v.id === property.rpVideoId) || videos[0] || {}).id || "none"));
  const vid = videos.find((v) => v.id === vidId) || null;
  const [vidPick, setVidPick] = useState(false);
  const [upPct, setUpPct] = useState(null);
  const vidRef = useRef(null);
  const thumbOf = (v) => {
    if (v.thumb && !/^https:\/\/[^/]*cloudflarestream\.com\//i.test(v.thumb)) return v.thumb; // not a Stream poster — use as is
    const base = String(v.thumb || "").split("?")[0] || (() => { const m = /^(https:\/\/[^/]+)\/([a-f0-9]{20,})\//i.exec(v.url || v.watch || ""); return m ? `${m[1]}/${m[2]}/thumbnails/thumbnail.jpg` : ""; })();
    return base ? `${base}?time=2s&height=720` : "";
  };
  // The video goes as a short link to its full-quality watch page
  // (gpflips.com/v/<street>) — a carrier picture message can't carry a clear
  // 60-second video (Elie 10/27/26 tested ~1 MB: 30 s, blurry). To make agents
  // want to tap it, a COVER PICTURE Elie picks (the video's own frame or any
  // photo in Media) is sent right after the text.
  const link = vid ? `gpflips.com/v/${slugOf(property.address)}` : "";
  const photos = useMemo(() => mediaOf(property).filter((m) => m.kind === "photo" && /^https:\/\//.test(m.url || "")), [property]);
  const [cover, setCover] = useState(() => property.rpCover || "frame"); // "frame" | photo url | "none"
  const [coverPick, setCoverPick] = useState(false);
  // Elie 10/27/26: his own picture, or any moment of the video as the cover.
  const [framePick, setFramePick] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverRef = useRef(null);
  const frameAt = (v, sec) => { const b = thumbOf(v).split("?")[0]; return b ? `${b}?time=${Math.max(0, Math.round(sec))}s&height=1080` : ""; };
  const uploadCover = async (f) => {
    if (!f) return;
    setCoverBusy(true);
    try { const att = await uploadAttachment(f, "sms"); if (att && att.url) { setCover(att.url); setCoverPick(false); } }
    catch (e) { alert(`Couldn't upload the picture: ${e.message || e}`); }
    setCoverBusy(false);
  };
  const coverUrl = cover === "none" ? "" : cover === "frame" ? (vid ? thumbOf(vid) : "") : cover;
  const [skip14, setSkip14] = useState(true);
  const now = Date.now();
  const optOut = useOptOut();
  const list = targets.filter((a) => digits(a.phone).length === 10 && !optOut.has(a.phone) && !(mode !== "follow" && skip14 && a.sentAt && now - new Date(a.sentAt).getTime() < 14 * DAY));
  const finalText = (a) => msg.replace(/\{first\}/g, niceFirst(a.name)) + (link ? `\n\nHere's a video walkthrough so you can get a preview of the house: ${link}` : "");
  const [prog, setProg] = useState(null); // {i,n,ok,fail:[]}
  const sample = list[0] || targets[0];

  const upload = async (file) => {
    if (!file) return;
    setUpPct(0);
    try {
      const added = await uploadToMedia(property, [file], { updateProp: onUpdate, getLatest, by: currentUser || "", src: "upload", onProgress: (p) => setUpPct(p.pct || 0) });
      const v = added.find((x) => x.kind === "video");
      if (v) { setVidId(v.id); setVidPick(false); }
    } catch (e) { alert(`Couldn't upload the video: ${e.message || e}`); }
    setUpPct(null);
  };

  const go = async () => {
    const res = { i: 0, n: list.length, ok: 0, fail: [] };
    setProg({ ...res });
    const sentIds = {};
    for (const a of list) {
      res.i += 1; setProg({ ...res });
      // The text first, then the cover picture as its own message — so it lands under the words.
      try { await send(a.phone, finalText(a), null, streetOf(property)); res.ok += 1; sentIds[a.id] = { at: new Date().toISOString(), cell: a.phone, from: a.cellFrom || "" }; }
      catch (e) { res.fail.push({ name: a.name, why: e.message || "failed" }); }
      if (/^https:\/\//.test(coverUrl) && sentIds[a.id]) {
        try { await new Promise((r) => setTimeout(r, 600)); await send(a.phone, "", [coverUrl], streetOf(property)); }
        catch (e) { res.fail.push({ name: a.name, why: `text sent, but the picture didn't go through (${e.message || "failed"})` }); }
      }
      setProg({ ...res });
      await new Promise((r) => setTimeout(r, 350));
    }
    const latest = (getLatest && getLatest()) || property;
    onUpdate(property.id, "rpAgents", (latest.rpAgents || []).map((a) => {
      const x = sentIds[a.id];
      if (!x) return a;
      const keep = "cell" in a && digits(a.cell).length === 10 ? {} : { cell: x.cell, cellFrom: x.from || "known", ...("cell" in a ? {} : { officePhone: a.officePhone || a.phone || "" }) };
      return mode === "follow" ? { ...a, ...keep, followAt: x.at, followBy: currentUser || "" } : { ...a, ...keep, sentAt: x.at, sentBy: currentUser || "", followAt: null };
    }));
    if (String(price) !== String(property.rpPrice || "")) onUpdate(property.id, "rpPrice", price);
    if (reno !== !!property.rpReno) onUpdate(property.id, "rpReno", reno);
    if (cover !== (property.rpCover || "frame")) onUpdate(property.id, "rpCover", cover);
    if (vidId !== (property.rpVideoId || "")) onUpdate(property.id, "rpVideoId", vidId);
    onSent && onSent();
  };

  if (prog) {
    const done = prog.i >= prog.n && (prog.ok + prog.fail.length) >= prog.n;
    return (
      <Sheet title={done ? "Sent" : "Sending…"} onClose={done ? onClose : () => {}}
        footer={done && <button onClick={onClose} style={{ ...btn("gold"), width: "100%" }}>Done</button>}>
        <div style={{ textAlign: "center", padding: "18px 0 8px" }}>
          <div style={{ fontSize: 34 }}>{done ? (prog.fail.length ? "⚠️" : "✅") : "📤"}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginTop: 6 }}>{done ? `Sent to ${prog.ok} agent${prog.ok === 1 ? "" : "s"}` : `Sending ${prog.i} of ${prog.n}…`}</div>
          {!done && <div style={{ fontSize: 12.5, color: T.textSub, marginTop: 4 }}>Keep the app open until it finishes.</div>}
        </div>
        {prog.fail.length > 0 && (
          <div style={{ marginTop: 10, background: "#FDECEA", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#C0392B" }}>{prog.fail.length} couldn't be sent</div>
            {prog.fail.map((f, i) => <div key={i} style={{ fontSize: 12.5, color: T.text, marginTop: 4 }}><b>{f.name}</b> — {f.why}</div>)}
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet title={`${mode === "follow" ? "Follow up with" : "Text"} ${list.length} agent${list.length === 1 ? "" : "s"} · ${streetOf(property)}`} onClose={onClose} wide
      footer={<>
        <button disabled={!list.length || !msg.trim() || upPct != null} onClick={go} style={{ ...btn("gold"), width: "100%", minHeight: 48, fontSize: 15, opacity: list.length && msg.trim() && upPct == null ? 1 : 0.5 }}>
          Send to {list.length} agent{list.length === 1 ? "" : "s"}{from ? ` from ${fmtPhone(from)}` : ""}
        </button>
        {targets.length > list.length && <div style={{ fontSize: 11.5, color: T.textTert, textAlign: "center", marginTop: 6 }}>{targets.length - list.length} skipped (no cell number, asked not to be texted{mode !== "follow" && skip14 ? ", or texted in the last 14 days" : ""})</div>}
      </>}>
      <div style={HDR}>Pitch</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, overflowX: "auto", paddingBottom: 2 }}>
        {PITCHES.map(([k, l]) => <button key={k} onClick={() => { setKind(k); reTemplate(k, price); }} style={chip(kind === k)}>{l}</button>)}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 13, color: T.textSub, flexShrink: 0 }}>List price</span>
        <input value={price} inputMode="numeric" placeholder="$ e.g. 489,900" onChange={(e) => { const v = e.target.value; setPrice(v); if (msg === lastAuto.current) reTemplate(kind, v); }}
          style={{ flex: 1, minWidth: 0, border: `1px solid ${T.border}`, borderRadius: 10, padding: "9px 11px", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, minHeight: 44, cursor: "pointer" }}>
        <input type="checkbox" checked={reno} onChange={(e) => { const v = e.target.checked; setReno(v); if (msg === lastAuto.current) reTemplate(kind, price, v); }} style={{ width: 20, height: 20, accentColor: T.gold }} />
        <span style={{ fontSize: 13.5, color: T.text }}>Mention it's fully renovated</span>
      </label>
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={6} style={{ width: "100%", boxSizing: "border-box", marginTop: 10, border: `1px solid ${T.border}`, borderRadius: 14, padding: "11px 12px", fontSize: 14.5, lineHeight: 1.45, fontFamily: "inherit", resize: "vertical", outline: "none", background: "#F7F7FA" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
        <span style={{ flex: 1, minWidth: 160, fontSize: 11.5, color: T.textTert }}>{savedNote || `{first} becomes each agent's first name.`}</span>
        {msg !== lastAuto.current && msg.trim() && (
          <button onClick={() => { const t = toTokens(msg, fields(price)); saveMine({ ...mine, [kind]: t }); lastAuto.current = msg; setSavedNote("⭐ Saved — this pitch will start with your wording from now on."); }}
            style={{ background: "none", border: "none", color: T.gold, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", minHeight: 44, padding: "0 4px" }}>⭐ Save as my wording</button>
        )}
        {mine[kind] && msg === lastAuto.current && (
          <button onClick={() => { const n = { ...mine }; delete n[kind]; saveMine(n); const t = (PITCHES.find((x) => x[0] === kind) || PITCHES[0])[2](fields(price)); setMsg(t); lastAuto.current = t; setSavedNote(""); }}
            style={{ background: "none", border: "none", color: T.textSub, fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit", minHeight: 44, padding: "0 4px" }}>↺ Standard wording</button>
        )}
      </div>

      <div style={{ ...HDR, marginTop: 14 }}>🎬 Video walkthrough</div>
      <input ref={vidRef} type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; upload(f); }} />
      <div style={{ marginTop: 8, border: `1px solid ${T.border}`, borderRadius: 14, padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
        {upPct != null ? (
          <div style={{ flex: 1, fontSize: 13.5, color: T.text }}>Uploading video… {Math.round(upPct)}%
            <div style={{ height: 4, borderRadius: 2, background: "#EEE", marginTop: 6 }}><div style={{ width: `${upPct}%`, height: "100%", borderRadius: 2, background: T.gold }} /></div>
          </div>
        ) : vid ? (<>
          <div style={{ position: "relative", width: 64, height: 64, borderRadius: 10, overflow: "hidden", background: "#222", flexShrink: 0 }}>
            {thumbOf(vid) && <img src={thumbOf(vid)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 20, textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>▶</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{vid.name || "Video"}</div>
            <div style={{ fontSize: 12, color: T.textSub }}>Full quality — sent as {link}</div>
          </div>
          <button onClick={() => setVidPick((x) => !x)} style={{ background: "none", border: "none", color: T.gold, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", minHeight: 44, padding: "0 6px" }}>Change</button>
        </>) : (<>
          <div style={{ flex: 1, fontSize: 13, color: T.textSub }}>{videos.length ? "No video with this text." : "No video for this property yet."}</div>
          {videos.length > 0 && <button onClick={() => setVidPick((x) => !x)} style={{ background: "none", border: "none", color: T.gold, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", minHeight: 44 }}>Pick one</button>}
          <button onClick={() => vidRef.current && vidRef.current.click()} style={{ background: "none", border: "none", color: T.gold, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", minHeight: 44 }}>＋ Upload</button>
        </>)}
      </div>
      {vidPick && upPct == null && (
        <div style={{ marginTop: 6, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
          {videos.map((v, i) => (
            <button key={v.id} onClick={() => { setVidId(v.id); setVidPick(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "none", borderTop: i ? `1px solid ${T.border}` : "none", background: v.id === vidId ? T.goldLight : "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
              <div style={{ width: 44, height: 44, borderRadius: 8, overflow: "hidden", background: "#222", flexShrink: 0 }}>{thumbOf(v) && <img src={thumbOf(v)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}</div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name || "Video"}<div style={{ fontSize: 11.5, color: T.textSub }}>{v.at ? shortDate(v.at) : ""}</div></div>
              {v.id === vidId && <span style={{ color: T.gold, fontWeight: 800 }}>✓</span>}
            </button>
          ))}
          <button onClick={() => vidRef.current && vidRef.current.click()} style={{ width: "100%", padding: "11px 12px", border: "none", borderTop: `1px solid ${T.border}`, background: "#fff", color: T.gold, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>＋ Upload a new video</button>
          <button onClick={() => { setVidId("none"); setVidPick(false); }} style={{ width: "100%", padding: "11px 12px", border: "none", borderTop: `1px solid ${T.border}`, background: "#fff", color: T.textSub, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>Send without a video</button>
        </div>
      )}

      <div style={{ ...HDR, marginTop: 14 }}>🖼 Cover picture <span style={{ textTransform: "none", fontWeight: 500, letterSpacing: 0 }}>— the sneak peek sent after the text</span></div>
      <div style={{ marginTop: 8, border: `1px solid ${T.border}`, borderRadius: 14, padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 64, height: 64, borderRadius: 10, overflow: "hidden", background: "#F2F2F7", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: T.textTert, fontSize: 11 }}>
          {coverUrl ? <img src={coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "None"}
        </div>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: T.text }}>{coverBusy ? "Uploading your picture…" : cover === "none" ? "No picture" : cover === "frame" ? (vid ? "A still from the video" : "No picture (no video)") : /thumbnails\/thumbnail\.jpg\?time=/.test(cover) ? `A moment from the video (${(/time=(\d+)/.exec(cover) || [])[1] || 0}s)` : photos.some((m) => m.url === cover) ? "A photo from Media" : "Your own picture"}</div>
        <button onClick={() => setCoverPick((x) => !x)} style={{ background: "none", border: "none", color: T.gold, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit", minHeight: 44, padding: "0 6px" }}>{coverPick ? "Done" : "Change"}</button>
      </div>
      <input ref={coverRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; uploadCover(f); }} />
      {coverPick && (
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button onClick={() => coverRef.current && coverRef.current.click()} style={btn("ghost")}>📷 Upload a picture</button>
          {vid && /^https:\/\/[^/]*(cloudflarestream\.com|videodelivery\.net)\//.test(thumbOf(vid)) && <button onClick={() => { setFramePick(true); setCoverPick(false); }} style={btn("ghost")}>🎞 Pick from the video</button>}
        </div>
      )}
      {coverPick && (
        <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))", gap: 6 }}>
          {[...(cover !== "none" && cover !== "frame" && !photos.some((m) => m.url === cover) ? [[cover, cover, "Current"]] : []), ...(vid && thumbOf(vid) ? [["frame", thumbOf(vid), "Video still"]] : []), ...photos.map((m) => [m.url, m.thumb || m.url, ""]), ["none", "", "No picture"]].map(([val, img, label]) => (
            <button key={val} onClick={() => { setCover(val); setCoverPick(false); }} aria-label={label || "Photo"}
              style={{ position: "relative", aspectRatio: "1", minHeight: 44, borderRadius: 10, overflow: "hidden", padding: 0, cursor: "pointer", background: "#F2F2F7", border: cover === val ? `3px solid ${T.gold}` : `1px solid ${T.border}`, fontFamily: "inherit", fontSize: 11, color: T.textSub }}>
              {img ? <img src={img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : label}
              {img && label && <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "2px 0" }}>{label}</span>}
            </button>
          ))}
        </div>
      )}

      {framePick && vid && <FramePicker video={vid} frameAt={frameAt} onPick={(url) => { setCover(url); setFramePick(false); }} onClose={() => setFramePick(false)} />}

      {sample && (<>
        <div style={{ ...HDR, marginTop: 14 }}>Preview · {sample.name}</div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginTop: 8, gap: 4 }}>
          <div style={{ maxWidth: 330, background: T.gold, color: "#fff", borderRadius: 18, padding: "9px 12px", fontSize: 14, lineHeight: 1.42, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{finalText(sample)}</div>
          {coverUrl && <img src={coverUrl} alt="" style={{ width: 180, maxHeight: 240, objectFit: "cover", borderRadius: 18, border: "1px solid rgba(0,0,0,0.06)" }} />}
        </div>
      </>)}

      {mode !== "follow" && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, padding: "10px 0", borderTop: `1px solid ${T.border}`, cursor: "pointer" }}>
          <span style={{ flex: 1, fontSize: 13.5, color: T.text }}>Skip agents already texted about it in the last 14 days</span>
          <input type="checkbox" checked={skip14} onChange={(e) => setSkip14(e.target.checked)} style={{ width: 22, height: 22, accentColor: T.green }} />
        </label>
      )}
    </Sheet>
  );
}

// ── 🔑 Which MLS a listing is in (the list of MLSs is shared, app_settings
// "mls_sources"; NO passwords — Cowork uses Elie's own signed-in Chrome) ─────
function MlsSheet({ property, list, saveList, onUpdate, flush, onClose }) {
  const [pick, setPick] = useState(property.mlsSource || "");
  const [num, setNum] = useState(property.mlsNumber || "");
  const [adding, setAdding] = useState(!list.length);
  const [nm, setNm] = useState(""), [url, setUrl] = useState(""), [notes, setNotes] = useState("");
  const inp = { width: "100%", boxSizing: "border-box", border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 14, fontFamily: "inherit", outline: "none", marginTop: 6 };
  const add = () => {
    if (!nm.trim()) return;
    const m = { id: `mls${Date.now()}`, name: nm.trim(), url: url.trim(), notes: notes.trim() };
    saveList([...list, m]); setPick(m.id); setAdding(false); setNm(""); setUrl(""); setNotes("");
  };
  const done = () => {
    if (pick !== (property.mlsSource || "")) onUpdate(property.id, "mlsSource", pick);
    if (num.trim() !== (property.mlsNumber || "")) onUpdate(property.id, "mlsNumber", num.trim());
    if (flush) setTimeout(flush, 0);
    onClose();
  };
  return (
    <Sheet title={`MLS · ${streetOf(property)}`} onClose={onClose} footer={<button onClick={done} style={{ ...btn("gold"), width: "100%" }}>Save</button>}>
      <div style={{ fontSize: 13, color: T.textSub, lineHeight: 1.5 }}>Every Monday and Thursday at 8 AM, Cowork opens this listing's reverse-prospecting page in your Chrome, reads each new agent's business card for their <b>cell</b>, and adds them here. Log into each MLS once in Chrome (let Chrome save the password) — never type passwords into Claude.</div>
      <div style={{ ...HDR, marginTop: 14 }}>Listed in</div>
      <div style={{ marginTop: 6, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" }}>
        {list.map((m, i) => (
          <button key={m.id} onClick={() => setPick(m.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", minHeight: 48, border: "none", borderTop: i ? `1px solid ${T.border}` : "none", background: pick === m.id ? T.goldLight : "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: T.text }}>{m.name}</span>
              {(m.url || m.notes) && <span style={{ display: "block", fontSize: 12, color: T.textSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[m.url, m.notes].filter(Boolean).join(" · ")}</span>}
            </span>
            {pick === m.id && <span style={{ color: T.gold, fontWeight: 800 }}>✓</span>}
          </button>
        ))}
        {!adding && <button onClick={() => setAdding(true)} style={{ width: "100%", padding: "12px", minHeight: 48, border: "none", borderTop: list.length ? `1px solid ${T.border}` : "none", background: "#fff", color: T.gold, fontWeight: 700, fontSize: 13.5, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>＋ Add an MLS</button>}
      </div>
      {adding && (
        <div style={{ marginTop: 10, background: "#F7F7FA", borderRadius: 14, padding: 12 }}>
          <input value={nm} onChange={(e) => setNm(e.target.value)} placeholder="MLS name (e.g. Monmouth-Ocean MLS)" style={inp} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Website you log into (e.g. mls.example.com)" style={inp} />
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for Cowork (optional — towns it covers, where the report is)" style={inp} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {list.length > 0 && <button onClick={() => setAdding(false)} style={btn()}>Cancel</button>}
            <button disabled={!nm.trim()} onClick={add} style={{ ...btn("gold"), opacity: nm.trim() ? 1 : 0.5 }}>Add MLS</button>
          </div>
        </div>
      )}
      <div style={{ ...HDR, marginTop: 14 }}>MLS listing # (optional)</div>
      <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="e.g. 22633811 — helps Cowork find it fast" style={inp} />
    </Sheet>
  );
}

// The listing's agents with the cell we'd text (shared by the tab + texts column).
function useRpAgents(property, showings) {
  const { sharedProps, contacts } = useData() || {};
  const find = useMemo(() => knownCells({ showings, contacts, props: sharedProps, skipPropId: property.id }), [showings, contacts, sharedProps, property.id]);
  const office = useMemo(() => officeSetOf(property.rpAgents || []), [property.rpAgents]);
  const agents = useMemo(() => (property.rpAgents || []).map((a) => resolveAgent(a, find, office)), [property.rpAgents, find, office]);
  return { find, agents };
}

// 💬 Desktop right column on the Reverse tab (Elie 10/27/26): the text history
// with this listing's reverse-prospecting agents — who replied, who didn't —
// instead of the showings conversations. Tap one → the full conversation.
export function ReverseTextsList({ property, showings, onOpen }) {
  const { agents } = useRpAgents(property, showings);
  const { connected, threadFor, unreadFor } = useSmsTexting();
  if (connected === false) return <div style={{ padding: "34px 22px", textAlign: "center", color: T.textTert, fontSize: 12.5, lineHeight: 1.6 }}>Business texting isn't connected for your login.</div>;
  const rows = agents.filter((a) => digits(a.phone).length === 10).map((a) => {
    const since = a.sentAt ? new Date(a.sentAt).getTime() - 60000 : Infinity;
    const th = threadFor(a.phone).filter((m) => m.kind !== "call" && new Date(m.at || 0).getTime() >= since);
    if (!th.length) return null;
    const last = th[th.length - 1];
    const replied = th.some((m) => m.direction === "in");
    return { a, last, replied, unread: unreadFor(a.phone), at: String(last.at || "") };
  }).filter(Boolean).sort((x, y) => ((y.unread > 0) - (x.unread > 0)) || (y.replied - x.replied) || y.at.localeCompare(x.at));
  const when = (iso) => { try { const d = new Date(iso), now = new Date(); if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; } };
  const snip = (m) => `${m.direction !== "in" ? "You: " : ""}${String(m.text || "").trim() || (Array.isArray(m.media) && m.media.length ? (m.media.some((u) => /\.(mp4|mov|3gp|m4v|webm)(\?|$)/i.test(u)) ? "🎬 Video" : "📷 Photo") : "")}`;
  const sec = (label, list) => list.length > 0 && (<>
    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, padding: "14px 2px 7px" }}>{label} ({list.length})</div>
    <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden" }}>
      {list.map((r, i) => {
        const [bg, fg] = avC(r.a.name);
        return (
          <div key={r.a.id} onClick={() => onOpen({ phone: r.a.phone, name: r.a.name })} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", cursor: "pointer", borderTop: i ? "1px solid rgba(0,0,0,0.055)" : "none", background: r.unread > 0 ? T.goldLight : "#fff" }}>
            <span style={{ width: 34, height: 34, borderRadius: 17, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}>{initials(r.a.name)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: r.unread > 0 ? 750 : 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.a.name || r.a.phone}</div>
              <div style={{ fontSize: 12, color: r.unread > 0 ? T.text : T.textSub, fontWeight: r.unread > 0 ? 600 : 400, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snip(r.last)}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 10.5, color: r.unread > 0 ? T.gold : T.textTert, fontWeight: r.unread > 0 ? 700 : 500 }}>{when(r.at)}</span>
              {r.unread > 0 && <span style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: T.gold, color: "#fff", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>{r.unread}</span>}
            </div>
          </div>
        );
      })}
    </div>
  </>);
  return (
    <div style={{ padding: "0 12px 24px" }}>
      {rows.length === 0 && <div style={{ padding: "34px 16px", textAlign: "center", color: T.textTert, fontSize: 12.5, lineHeight: 1.6 }}>No texts to this listing's agents yet.<br />Once you send the pitch, every conversation shows up here.</div>}
      {sec("💬 Replied", rows.filter((r) => r.replied))}
      {sec("⏳ No reply yet", rows.filter((r) => !r.replied))}
    </div>
  );
}

// ── The tab ──────────────────────────────────────────────────────────────────
export function ReversePane({ property, onUpdate, flush, onOpenSms, classify, showings }) {
  const { sharedProps, setContacts, flushContacts, contacts, currentUser, appSettings, setAppSettings, flushAppSettings } = useData() || {};
  const { connected, threadFor } = useSmsTexting();
  const optOut = useOptOut();
  const [filter, setFilter] = useState("all");
  const [imp, setImp] = useState(false);
  const [pitch, setPitch] = useState(null); // {targets, mode}
  const [menu, setMenu] = useState(null); // agent
  const getLatest = () => (sharedProps || []).find((x) => String(x.id) === String(property.id)) || property;
  const save = (list) => { onUpdate(property.id, "rpAgents", list); if (flush) setTimeout(flush, 0); };
  const { find, agents } = useRpAgents(property, showings);
  const [mlsOpen, setMlsOpen] = useState(false);
  const mlsList = ((appSettings || []).find((x) => x.id === "mls_sources") || {}).items || [];
  const mls = mlsList.find((m) => String(m.id) === String(property.mlsSource || "")) || null;

  const rows = agents.map((a) => {
    const ok = digits(a.phone).length === 10;
    const since = a.sentAt ? new Date(a.sentAt).getTime() : 0;
    const th = ok ? threadFor(a.phone).filter((m) => m.kind !== "call") : [];
    const ins = since ? th.filter((m) => m.direction === "in" && new Date(m.at || 0).getTime() > since) : [];
    const lastIn = ins[ins.length - 1] || null;
    const auto = lastIn && classify ? classify(lastIn.text) : null;
    const lead = a.lead || (auto === "interest" || auto === "offer" ? "hot" : auto === "not" || auto === "badnum" ? "not" : "");
    const askedOut = ok && (optOut.has(a.phone) || (th.some((m) => m.direction === "in" && OPT_OUT_RE.test(String(m.text || "")))));
    const st = askedOut ? "optout" : !ok ? "nophone" : !a.sentAt ? "new" : lead === "hot" ? "hot" : lead === "not" ? "not" : lastIn ? "replied" : "texted";
    const followDue = st === "texted" && !a.followAt && Date.now() - since > 3 * DAY;
    return { a, st, lastIn, followDue, autoOut: askedOut && !optOut.has(a.phone) };
  });
  // Someone replied "remove me" → onto the shared do-not-text list (once).
  const autoOut = rows.filter((r) => r.autoOut).map((r) => ({ phone: r.a.phone, name: r.a.name, why: (r.lastIn && r.lastIn.text) || "asked not to be texted" })).map((x) => x.phone).join(",");
  useEffect(() => {
    if (!autoOut) return;
    optOut.add(rows.filter((r) => r.autoOut).map((r) => ({ phone: r.a.phone, name: r.a.name, why: String((r.lastIn && r.lastIn.text) || "asked not to be texted") })));
  }, [autoOut]); // eslint-disable-line react-hooks/exhaustive-deps
  const cnt = (k) => rows.filter((r) => r.st === k).length;
  const fresh = rows.filter((r) => r.st === "new");
  const due = rows.filter((r) => r.followDue);
  const order = { hot: 0, replied: 1, new: 2, texted: 3, nophone: 4, not: 5, optout: 6 };
  const shown = rows.filter((r) => filter === "all" || (filter === "noreply" ? r.st === "texted" : filter === "replied" ? !!r.lastIn : r.st === filter))
    .sort((x, y) => (order[x.st] - order[y.st]) || String((y.lastIn && y.lastIn.at) || y.a.addedAt || "").localeCompare(String((x.lastIn && x.lastIn.at) || x.a.addedAt || "")));

  const addAgents = (list) => {
    const now = new Date().toISOString();
    const latest = getLatest().rpAgents || [];
    const merged = [...latest];
    const same = (a, x) => (digits(x.cell).length === 10 && digits(a.cell) === digits(x.cell)) || (x.email && emailKey(a.email) === emailKey(x.email)) || (nameKey(a.name) && nameKey(a.name) === nameKey(x.name));
    list.forEach((x, i) => {
      const k = merged.findIndex((a) => same(a, x));
      const cell = digits(x.cell).length === 10 ? fmtPhone(x.cell) : "";
      if (k >= 0) { const old = merged[k]; merged[k] = { ...old, ...(!digits(old.cell) && cell ? { cell, cellFrom: x.cellFrom || "MLS" } : {}), officePhone: old.officePhone || x.officePhone || "", buyers: Math.max(old.buyers || 1, x.buyers || 1), office: old.office || x.office, email: old.email || x.email, note: x.note || old.note }; return; }
      merged.push({ id: `rp${Date.now()}${i}`, name: x.name, cell, cellFrom: cell ? (x.cellFrom || "MLS") : "", officePhone: x.officePhone ? fmtPhone(x.officePhone) : "", email: x.email || "", office: x.office || "", buyers: x.buyers || 1, note: x.note || "", addedAt: now, addedBy: currentUser || "" });
    });
    save(merged);
    // Into Contacts too (tag "Agent") — only numbers we don't have yet.
    if (setContacts) {
      const known = new Set((contacts || []).flatMap((c) => [c.phone, ...(c.phones || []).map((p) => p.number)]).map(digits).filter(Boolean));
      const add = list.filter((x) => digits(x.cell).length === 10 && !known.has(digits(x.cell))).map((x, i) => ({
        id: Date.now() + i, name: x.name || fmtPhone(x.cell), company: x.office || "", role: "Agent", email: x.email || "",
        phones: [{ label: "Mobile", number: fmtPhone(x.cell) }, ...(digits(x.officePhone).length === 10 ? [{ label: "Office", number: fmtPhone(x.officePhone) }] : [])], phone: fmtPhone(x.cell), tags: ["Agent", "Reverse prospecting"],
        notes: `Reverse prospecting — ${streetOf(property)}`, addedBy: currentUser || "", addedAt: now,
      }));
      if (add.length) { setContacts((prev) => [...(prev || []), ...add]); if (flushContacts) setTimeout(flushContacts, 0); }
    }
    setImp(false);
  };
  const patch = (id, fn) => save((getLatest().rpAgents || []).map((a) => (a.id === id ? fn(a) : a)));

  const statBox = (n, l, red) => (<div style={{ flex: 1, background: "#F7F7FA", borderRadius: 12, padding: "8px 4px", textAlign: "center" }}><div style={{ fontSize: 19, fontWeight: 700, color: red && n ? "#C0392B" : T.text }}>{n}</div><div style={{ fontSize: 11, color: T.textSub, fontWeight: 600 }}>{l}</div></div>);
  const replied = rows.filter((r) => r.lastIn).length;

  return (
    <div style={{ padding: "12px 12px 28px", maxWidth: 760 }}>
      <button onClick={() => setMlsOpen(true)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "none", borderRadius: 16, padding: "10px 13px", marginBottom: 10, cursor: "pointer", fontFamily: "inherit", textAlign: "left", minHeight: 52 }}>
        <span style={{ fontSize: 18 }}>🔑</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: T.text }}>{mls ? `${mls.name}${property.mlsNumber ? ` · #${property.mlsNumber}` : ""}` : "Which MLS is this listed in?"}</span>
          <span style={{ display: "block", fontSize: 11.5, color: T.textSub, marginTop: 1 }}>{property.rpCheckedAt ? `Cowork last checked ${shortDate(property.rpCheckedAt)}` : mls ? "Cowork checks it Mon + Thu at 8 AM" : "Set it so Cowork can check for new agents Mon + Thu"}</span>
        </span>
        <span style={{ color: "#C7C7CC", fontSize: 18 }}>›</span>
      </button>
      <div style={{ background: "#fff", borderRadius: 16, padding: "12px 13px" }}>
        <div style={HDR}>Agents with buyers searching here</div>
        <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
          {statBox(agents.length, "Agents")}{statBox(rows.filter((r) => r.a.sentAt).length, "Texted")}{statBox(replied, "Replied")}{statBox(cnt("hot"), "Interested", true)}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
          <button onClick={() => setImp(true)} style={btn("ghost")}>📸 Add from MLS</button>
          {connected && <button disabled={!fresh.length} onClick={() => setPitch({ targets: fresh.map((r) => r.a), mode: "new" })} style={{ ...btn("gold"), opacity: fresh.length ? 1 : 0.45 }}>💬 Text {fresh.length || ""} new</button>}
        </div>
        {connected && due.length > 0 && (
          <button onClick={() => setPitch({ targets: due.map((r) => r.a), mode: "follow" })} style={{ ...btn(), width: "100%", marginTop: 8 }}>🔁 Follow up with {due.length} who didn't reply (3+ days)</button>
        )}
        {connected === false && <div style={{ fontSize: 12, color: T.textTert, marginTop: 8 }}>Business texting isn't connected for your login, so you can add agents but not text them from here.</div>}
      </div>

      {agents.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 2 }}>
          {[["all", `All ${agents.length}`], ["new", `Not texted ${cnt("new")}`], ["replied", `Replied ${rows.filter((r) => r.lastIn).length}`], ["hot", `🔥 Interested ${cnt("hot")}`], ["noreply", `No reply ${cnt("texted")}`], ...(cnt("nophone") ? [["nophone", `Needs cell ${cnt("nophone")}`]] : []), ["not", `Not interested ${cnt("not")}`], ...(cnt("optout") ? [["optout", `🚫 Don't text ${cnt("optout")}`]] : [])]
            .map(([k, l]) => <button key={k} onClick={() => setFilter(k)} style={chip(filter === k)}>{l}</button>)}
        </div>
      )}

      {agents.length === 0 ? (
        <div style={{ textAlign: "center", padding: "34px 18px", color: T.textSub }}>
          <div style={{ fontSize: 30 }}>🎯</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginTop: 6 }}>No agents yet</div>
          <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>Screenshot the reverse-prospecting report from your MLS and tap <b>📸 Add from MLS</b>.</div>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 16, marginTop: 10, overflow: "hidden" }}>
          {shown.length === 0 && <div style={{ padding: "18px 14px", textAlign: "center", fontSize: 13, color: T.textTert }}>Nobody here.</div>}
          {shown.map(({ a, st, lastIn }, i) => {
            const [bg, fg] = avC(a.name);
            const [pl, pbg, pfg] = PILL[st];
            const dim = st === "not" || st === "nophone" || st === "optout";
            const sub = lastIn ? `“${String(lastIn.text || "📎 Attachment").slice(0, 80)}” · ${shortDate(lastIn.at)}`
              : st === "nophone" ? [a.officePhone ? `office ${fmtPhone(a.officePhone)}` : "no number", a.office].filter(Boolean).join(" · ")
              : [a.cellFrom && !/^(MLS|typed|known)$/.test(a.cellFrom) ? `📱 from ${a.cellFrom}` : "", a.office, a.buyers > 1 ? `${a.buyers} buyers searching` : a.buyers === 1 ? "1 buyer searching" : "", a.sentAt ? `texted ${shortDate(a.sentAt)}${a.followAt ? " · followed up" : ""}` : a.addedAt ? `added ${shortDate(a.addedAt)}` : ""].filter(Boolean).join(" · ");
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 6px 10px 12px", borderTop: i ? "1px solid rgba(0,0,0,0.055)" : "none" }}>
                <div onClick={() => digits(a.phone).length === 10 && onOpenSms && onOpenSms({ phone: a.phone, name: a.name })} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10, cursor: digits(a.phone).length === 10 ? "pointer" : "default" }}>
                  <span style={{ width: 36, height: 36, borderRadius: 18, background: dim ? "#F2F2F7" : bg, color: dim ? "#8E8E93" : fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, fontWeight: 800, flexShrink: 0 }}>{initials(a.name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: dim ? T.textTert : T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name || fmtPhone(a.phone)}</div>
                    <div style={{ fontSize: 12, color: T.textSub, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3, padding: "3px 8px", borderRadius: 100, background: pbg, color: pfg, whiteSpace: "nowrap", flexShrink: 0 }}>{pl}</span>
                </div>
                <button onClick={() => setMenu(a)} aria-label="More" style={{ width: 44, height: 44, border: "none", background: "transparent", cursor: "pointer", color: T.textTert, fontSize: 18, flexShrink: 0 }}>•••</button>
              </div>
            );
          })}
        </div>
      )}
      {agents.length > 0 && <div style={{ fontSize: 11.5, color: T.textTert, textAlign: "center", marginTop: 9, lineHeight: 1.45 }}>Tap an agent to open the text conversation. Replies also land in Messages → Texts.</div>}

      {menu && (
        <Sheet title={menu.name || fmtPhone(menu.phone)} onClose={() => setMenu(null)}>
          <div style={{ fontSize: 13, color: T.textSub, marginBottom: 10, lineHeight: 1.5 }}>{[menu.phone ? `📱 ${fmtPhone(menu.phone)}${menu.cellFrom && !/^(MLS|typed|known)$/.test(menu.cellFrom) ? ` (from ${menu.cellFrom})` : ""}` : "📱 no cell yet", menu.officePhone ? `☎ office ${fmtPhone(menu.officePhone)}` : "", menu.email, menu.office].filter(Boolean).join(" · ")}{menu.note ? <><br />{menu.note}</> : null}</div>
          {[
            ["🔥 Mark interested", () => patch(menu.id, (a) => ({ ...a, lead: "hot" }))],
            ["👎 Mark not interested", () => patch(menu.id, (a) => ({ ...a, lead: "not" }))],
            ...(menu.lead ? [["↺ Clear the mark", () => patch(menu.id, (a) => ({ ...a, lead: "" }))]] : []),
            ...(connected && digits(menu.phone).length === 10 && !optOut.has(menu.phone) ? [["💬 Text just this agent", () => setPitch({ targets: [menu], mode: menu.sentAt ? "follow" : "new" })]] : []),
            [digits(menu.phone).length === 10 ? "✏️ Change the cell number" : "✏️ Enter the cell number", () => {
              const v = window.prompt(`Cell number for ${menu.name || "this agent"}:`, menu.phone || "");
              if (v == null) return;
              const d = digits(v);
              if (d && d.length !== 10) { alert("That doesn't look like a 10-digit phone number."); return; }
              patch(menu.id, (a) => ({ ...a, ...("cell" in a ? {} : { officePhone: a.officePhone || a.phone || "" }), cell: d ? fmtPhone(d) : "", cellFrom: d ? "typed" : "" }));
            }],
            ...(digits(menu.phone).length === 10 ? [optOut.has(menu.phone)
              ? ["✅ Allow texting again", () => optOut.remove(menu.phone)]
              : ["🚫 Never text again (any listing)", () => optOut.add([{ phone: menu.phone, name: menu.name, why: "marked by hand" }]), true]] : []),
            ["🗑 Remove from this list", () => save((getLatest().rpAgents || []).filter((a) => a.id !== menu.id)), true],
          ].map(([l, fn, red]) => (
            <button key={l} onClick={() => { fn(); setMenu(null); }} style={{ width: "100%", minHeight: 48, textAlign: "left", padding: "0 14px", marginTop: 6, borderRadius: 12, border: `1px solid ${T.border}`, background: "#fff", color: red ? T.red : T.text, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
          ))}
        </Sheet>
      )}
      {imp && <ImportSheet property={property} find={find} onAdd={addAgents} onClose={() => setImp(false)} />}
      {mlsOpen && <MlsSheet property={property} list={mlsList} onUpdate={onUpdate} flush={flush}
        saveList={(items) => { setAppSettings((prev) => [...(prev || []).filter((x) => x.id !== "mls_sources"), { id: "mls_sources", items }]); if (flushAppSettings) setTimeout(flushAppSettings, 0); }}
        onClose={() => setMlsOpen(false)} />}
      {pitch && <PitchSheet property={property} targets={pitch.targets} mode={pitch.mode} getLatest={getLatest} onUpdate={onUpdate}
        onSent={() => { if (flush) setTimeout(flush, 0); }} onClose={() => setPitch(null)} />}
    </div>
  );
}

// For the property's tab label.
export const rpCount = (p) => ((p && p.rpAgents) || []).length;
