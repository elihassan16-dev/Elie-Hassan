// Shared line-art icons (WhatsApp-style thin outlines) — used instead of emoji
// so mics look identical everywhere and can take any color via currentColor.
export function MicIcon({ size = 22, color = "currentColor", strokeWidth = 1.8 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <line x1="12" y1="18" x2="12" y2="21.5" />
    </svg>
  );
}

// Internal team messaging — two bubbles in conversation. THE symbol for
// "talk to your own team about this" everywhere in the app (gold contexts).
export function TeamChatIcon({ size = 15, color = "currentColor", strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M17 9a7 7 0 1 0-13.4 2.8L3 16l4.4-1.1A7 7 0 0 0 17 9z" />
      <path d="M21 15a6 6 0 0 1-8.5 5.4L9 21l.9-3" />
    </svg>
  );
}

// Business texting (SMS) — one bubble with typing dots. THE symbol for
// "text this person" everywhere in the app (green contexts).
export function SmsChatIcon({ size = 15, color = "currentColor", strokeWidth = 2 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}>
      <path d="M21 11.5a8.5 8.5 0 1 0-15.9 4.2L4 21l5.4-1.2A8.5 8.5 0 0 0 21 11.5z" />
      <circle cx="8.5" cy="11.5" r="0.9" fill={color} stroke="none" />
      <circle cx="12" cy="11.5" r="0.9" fill={color} stroke="none" />
      <circle cx="15.5" cy="11.5" r="0.9" fill={color} stroke="none" />
    </svg>
  );
}
