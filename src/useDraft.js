// Crash-proof form drafts. iOS reloads a backgrounded PWA whenever it feels
// like it, wiping React state — so long-form popups (AI scope of work, new
// teammate, …) mirror their fields to localStorage as the user types and
// restore them when the popup next opens. clear() once the thing is actually
// sent/saved.
import { useCallback, useEffect, useState } from "react";

export function usePersistentDraft(key, initial) {
  const [draft, setDraft] = useState(() => {
    try { const s = localStorage.getItem(key); return s ? { ...initial, ...JSON.parse(s) } : initial; }
    catch { return initial; }
  });
  useEffect(() => {
    try {
      const empty = Object.values(draft).every((v) => !String(v ?? "").trim());
      if (empty) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(draft));
    } catch { /* private mode / storage full — drafts just don't persist */ }
  }, [key, draft]);
  const clear = useCallback((reset) => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    if (reset !== false) setDraft(initial);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasContent = Object.values(draft).some((v) => String(v ?? "").trim());
  return [draft, setDraft, clear, hasContent];
}
