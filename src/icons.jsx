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
