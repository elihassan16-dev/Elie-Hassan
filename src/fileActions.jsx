// "⬇ Save · ⤴ Share" chips under a chat photo / video / file — they hand over
// the real file (see fileSave.js), never the storage link.
import { useState } from "react";
import { saveItem, shareItem, isPhone } from "./fileSave";

export function FileActions({ item, mine }) {
  const [st, setSt] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn, kind) => {
    if (busy) return;
    setBusy(true);
    let keep = 3200;
    try {
      const r = await fn(item, (s) => setSt(s));
      if (r === "again") { setSt(kind === "save" ? "Ready — tap Save again" : "Ready — tap Share again"); keep = 12000; }
      else if (r === "downloaded" || (r === "done" && !isPhone() && kind === "save")) setSt("✓ Downloaded");
      else setSt("");
    } catch (e) { setSt(`⚠ ${e.message || "Couldn't get the file"}`); keep = 5000; }
    setBusy(false);
    setTimeout(() => setSt((s) => (/^Preparing|^Getting|^Downloading/.test(s) ? s : "")), keep);
  };
  const chip = { display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 11px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.05)", background: mine ? "rgba(255,255,255,0.15)" : "rgba(118,118,128,0.08)", color: mine ? "#fff" : "#8a6d1f", fontSize: 10.5, fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
  if (st) {
    return <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {/^Ready/.test(st) && !busy
        ? <button onClick={() => run(/Share/.test(st) ? shareItem : saveItem, /Share/.test(st) ? "share" : "save")} style={{ ...chip, background: mine ? "rgba(255,255,255,0.28)" : "#F8F1E0" }}>{st}</button>
        : <span style={{ ...chip, cursor: "default" }}>{st}</span>}
    </span>;
  }
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); run(saveItem, "save"); }} title={isPhone() ? "Save to your phone (Photos / Files)" : "Download to this computer"} style={chip}>⬇ {isPhone() ? "Save" : "Download"}</button>
      <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); run(shareItem, "share"); }} title="Share the file — WhatsApp, Messages, Mail…" style={chip}>⤴ Share</button>
    </span>
  );
}
