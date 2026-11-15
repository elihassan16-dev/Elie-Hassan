// ✍️ "My email signature" (Elie 11/15/26). Microsoft doesn't let apps read the
// signature saved in Outlook, so each teammate keeps a copy here — found
// automatically in their newest sent emails (Outlook marks it), or pasted in.
// Pictures (logos) are copied to our storage so they show in every inbox.
// Saved per person in prefs.mailSig (uprefs row — BIG_KEYS); the shell hands it
// to useOutlookMail, which adds it under every email sent from the app, and
// the Claude connector adds it to send_email / reply_email.
import { useEffect, useRef, useState } from "react";
import { T } from "./theme";
import { useAuth } from "./auth/AuthProvider";
import { uploadAttachment } from "./net";

// Pull the signature block out of one sent email's HTML.
export function findSignature(html) {
  if (!html) return "";
  let doc;
  try { doc = new DOMParser().parseFromString(html, "text/html"); } catch { return ""; }
  // Outlook on the web / new Outlook / phone apps mark it with an id.
  const marked = doc.querySelector('#Signature, #signature, [id^="Signature"], #ms-outlook-mobile-signature, #ms-outlook-ios-signature, .gmail_signature, [data-gs-sig]');
  if (marked && marked.textContent.trim()) return marked.innerHTML.trim();
  // Classic Outlook: <a name="_MailAutoSig"> starts it; it runs until the
  // quoted original (divRplyFwdMsg / the "From:" border line) or the end.
  const anchor = doc.querySelector('a[name="_MailAutoSig"]');
  if (anchor) {
    let block = anchor;
    while (block.parentElement && block.parentElement !== doc.body && !/WordSection1/i.test(block.parentElement.className || "")) block = block.parentElement;
    const out = [];
    for (let el = block; el; el = el.nextElementSibling) {
      if (el.id === "divRplyFwdMsg" || el.id === "appendonsend" || el.tagName === "HR" || /border-top:\s*solid/i.test(el.getAttribute("style") || "")) break;
      if (el.querySelector && el.querySelector("#divRplyFwdMsg")) break;
      out.push(el.outerHTML);
    }
    const h = out.join("").trim();
    if (h && doc.createRange) return h;
  }
  return "";
}

// Clean pasted / found HTML: no scripts, no event handlers.
const clean = (h) => String(h || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

// Inline pictures (data: / cid:) → files in our storage, so every inbox shows them.
async function hostImages(html, cidMap = {}) {
  const imgs = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)];
  let out = html;
  for (const m of imgs) {
    let src = m[2];
    if (/^cid:/i.test(src)) src = cidMap[src.slice(4).replace(/[<>]/g, "").trim().toLowerCase()] || src;
    if (!/^data:image\//i.test(src)) continue;
    try {
      const blob = await (await fetch(src)).blob();
      const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const up = await uploadAttachment(new File([blob], `signature.${ext}`, { type: blob.type }), "signatures");
      out = out.split(m[2]).join(up.url);
    } catch { /* leave it */ }
  }
  return out;
}

export function MailSignatureSheet({ mail, isMobile, onClose }) {
  const { prefs, savePrefs } = useAuth() || {};
  const [html, setHtml] = useState((prefs && prefs.mailSig) || "");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const ed = useRef(null);
  useEffect(() => { if (ed.current && ed.current.innerHTML !== html) ed.current.innerHTML = html; }, [html]);

  const find = async () => {
    if (!mail || !mail.signedIn) { setMsg("Connect Outlook first (Emails tab)."); return; }
    setBusy("find"); setMsg("");
    try {
      const sent = await mail.sentBodies(10);
      for (const m of sent) {
        const sig = findSignature((m.body && m.body.content) || "");
        if (sig) {
          const cids = /src\s*=\s*["']cid:/i.test(sig) ? await mail.getInlineImages(m.id) : {};
          const fixed = clean(sig).replace(/src\s*=\s*(["'])cid:([^"']+)\1/gi, (mm, q, cid) => { const u = cids[String(cid).replace(/[<>]/g, "").trim().toLowerCase()]; return u ? `src=${q}${u}${q}` : mm; });
          setHtml(fixed); setMsg("Found it in your sent email — check it below, then Save."); setBusy(""); return;
        }
      }
      setMsg("Couldn't spot a signature in your last 10 sent emails. Copy it from Outlook (Settings → Signatures, or any email you sent) and paste it in the box below.");
    } catch (e) { setMsg(e.message || "Couldn't read your sent email."); }
    setBusy("");
  };
  const save = async () => {
    setBusy("save"); setMsg("");
    try {
      const raw = clean(ed.current ? ed.current.innerHTML : html).trim();
      const hosted = raw ? await hostImages(raw) : "";
      const empty = !hosted.replace(/<[^>]+>/g, "").trim() && !/<img/i.test(hosted);
      await savePrefs({ mailSig: empty ? "" : hosted });
      onClose();
    } catch (e) { setMsg(e.message || "Couldn't save."); setBusy(""); }
  };

  const btn = (primary) => ({ minHeight: 44, padding: "0 18px", borderRadius: 22, border: primary ? "none" : `1px solid ${T.border}`, background: primary ? T.gold : "#fff", color: primary ? "#fff" : T.text, fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" });
  return (
    <div onClick={() => !busy && onClose()} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: isMobile ? "flex-end" : "center", justifyContent: "center", zIndex: 330, padding: isMobile ? 0 : 16, boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.card, borderRadius: isMobile ? "20px 20px 0 0" : 20, width: 560, maxWidth: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: T.shadowMd, overflow: "hidden" }}>
        <div style={{ padding: "15px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800 }}>✍️ My email signature</div>
            <div style={{ fontSize: 12, color: T.textSub, marginTop: 2 }}>Added under every email you send from the app — replies, new emails, and the ones Claude sends for you.</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textTert, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ padding: "14px 18px", overflowY: "auto" }}>
          <button onClick={find} disabled={!!busy} style={{ ...btn(false), width: "100%", marginBottom: 10 }}>{busy === "find" ? "Looking…" : "🔍 Find it in my sent email"}</button>
          {msg && <div style={{ fontSize: 12.5, color: "#8a6d1f", background: T.goldLight, borderRadius: 10, padding: "8px 11px", marginBottom: 10, lineHeight: 1.45 }}>{msg}</div>}
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textTert, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Your signature — edit or paste here</div>
          <div ref={ed} contentEditable suppressContentEditableWarning onBlur={(e) => setHtml(e.currentTarget.innerHTML)}
            style={{ minHeight: 120, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px", background: "#fff", fontSize: 14, lineHeight: 1.45, outline: "none", overflowWrap: "anywhere" }} />
          <div style={{ fontSize: 11.5, color: T.textTert, marginTop: 6 }}>Logos and pictures are kept. Leave it empty to send without a signature.</div>
        </div>
        <div style={{ padding: "12px 18px max(12px,env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={!!busy} style={btn(false)}>Cancel</button>
          <button onClick={save} disabled={!!busy} style={btn(true)}>{busy === "save" ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
