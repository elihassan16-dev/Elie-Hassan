// 🎙 Record-to-transcribe. Records with MediaRecorder (the same engine as voice
// notes — reliable on iOS, including home-screen PWAs) and transcribes server-
// side via /api/ai/transcribe (Cloudflare Whisper). The old in-page
// SpeechRecognition froze iOS PWAs mid-recording, so it's gone.
import { useEffect, useRef, useState } from "react";
import { qbAuthFetch } from "./net";

// onDone (optional) fires with the full combined text after a successful
// transcription — lets callers chain straight into an AI call, no extra tap.
export function useSpeechToText({ value, onText, onError, onDone }) {
  const [recOn, setRecOn] = useState(false);
  const [busy, setBusy] = useState(false); // transcribing after stop
  const mrRef = useRef(null);
  const chunksRef = useRef([]);
  const baseRef = useRef("");
  const timerRef = useRef(null);
  const stopAll = () => { try { if (mrRef.current && mrRef.current.state !== "inactive") mrRef.current.stop(); } catch { /* already stopped */ } };
  const toggleRec = async () => {
    if (busy) return;
    if (recOn) { stopAll(); return; } // onstop finishes the job
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      const mime = ["audio/mp4", "audio/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
      // Speech-quality bitrate: ~4x smaller files → much faster upload on cell.
      const mr = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
      chunksRef.current = [];
      baseRef.current = (value || "").trim();
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        clearTimeout(timerRef.current);
        stream.getTracks().forEach((t) => t.stop());
        setRecOn(false);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (!blob.size) return;
        setBusy(true);
        try {
          const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1] || ""); fr.onerror = rej; fr.readAsDataURL(blob); });
          const d = await qbAuthFetch("/api/ai/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: b64, mime: blob.type }) });
          const text = (d.text || "").trim();
          if (text) {
            const full = (baseRef.current ? baseRef.current + " " : "") + text;
            onText(full);
            onDone && onDone(full);
          } else onError && onError("Didn't catch anything — try again, a little closer to the mic.");
        } catch (ex) { onError && onError(ex.message || "Transcription failed — tap the 🎤 on your keyboard instead."); }
        setBusy(false);
      };
      mr.start();
      mrRef.current = mr;
      setRecOn(true);
      timerRef.current = setTimeout(stopAll, 300000); // hard cap: 5 minutes
    } catch { onError && onError("Microphone access was blocked — allow it in your browser settings, or use the keyboard 🎤."); }
  };
  useEffect(() => () => { clearTimeout(timerRef.current); stopAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { recOn, busy, toggleRec };
}

// The matching button — red while recording, hourglass while transcribing.
export const micBtnStyle = (on, T) => ({ width: 38, height: 38, flexShrink: 0, borderRadius: "50%", border: `1.5px solid ${on ? "#FF3B30" : T.border}`, background: on ? "#FFF0EF" : "#fff", fontSize: 15, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 });
export const micGlyph = (on, busy) => (on ? "◼" : busy ? "⏳" : "🎙");
