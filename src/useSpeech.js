// 🎙 Record-to-text via the phone's built-in speech recognition — same engine
// the Goldstone Assistant uses. No server, no audio upload: words appear in the
// box as you talk. Where the OS blocks it (some iOS PWA modes) we say so and
// point at the keyboard mic, which always works.
import { useEffect, useRef, useState } from "react";

export function useSpeechToText({ value, onText, onError }) {
  const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const [recOn, setRecOn] = useState(false);
  const recRef = useRef(null);
  const baseRef = useRef("");
  const toggleRec = () => {
    if (recOn) { try { recRef.current && recRef.current.stop(); } catch { /* already stopped */ } setRecOn(false); return; }
    if (!SR) { onError && onError("Voice capture isn't available in this view — tap the 🎤 on your keyboard instead (it types as you talk)."); return; }
    try {
      const r = new SR();
      r.lang = "en-US"; r.interimResults = true; r.continuous = true;
      baseRef.current = (value || "").trim();
      r.onresult = (ev) => {
        let text = "";
        for (let i = 0; i < ev.results.length; i++) text += ev.results[i][0].transcript;
        onText((baseRef.current ? baseRef.current + " " : "") + text.trim());
      };
      r.onerror = (ev) => { setRecOn(false); if (ev.error === "not-allowed" || ev.error === "service-not-allowed") onError && onError("Voice capture is blocked here — tap the 🎤 on your keyboard instead (it types as you talk)."); };
      r.onend = () => setRecOn(false);
      r.start(); recRef.current = r; setRecOn(true);
    } catch { onError && onError("Couldn't start voice capture — tap the 🎤 on your keyboard instead."); }
  };
  useEffect(() => () => { try { recRef.current && recRef.current.stop(); } catch { /* unmount */ } }, []);
  return { recOn, toggleRec };
}

// The matching button — red and pulsing while listening.
export const micBtnStyle = (on, T) => ({ width: 38, height: 38, flexShrink: 0, borderRadius: "50%", border: `1.5px solid ${on ? "#FF3B30" : T.border}`, background: on ? "#FFF0EF" : "#fff", fontSize: 15, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, lineHeight: 1 });
