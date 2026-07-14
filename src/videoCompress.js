// WhatsApp-style video compression — on the phone, BEFORE upload. A 1-minute
// 4K iPhone clip is ~350 MB as shot; re-encoded to 1080p H.264 it's ~30 MB, so
// the upload (and the wait on the receiving end) drops ~10x. Uses the device's
// hardware encoder via WebCodecs (mediabunny handles iPhone rotation metadata
// and copies the audio track without re-encoding). Anything unsupported or
// risky returns null and the ORIGINAL file uploads exactly like before — this
// can only ever make things faster, never break a send.
// mediabunny is imported on demand so it adds nothing to app launch.

const LONG_SIDE = 1920;              // keep 1080p-class detail — walkthrough videos get inspected
const VIDEO_BITRATE = 4_000_000;     // ≈ 30 MB per minute including audio
const MIN_SIZE = 20 * 1024 * 1024;   // already small — not worth the wait
const MAX_SIZE = 2 * 1024 * 1024 * 1024; // beyond this, stream the original (memory safety)

export async function compressVideo(file, onProgress) {
  if (typeof VideoEncoder === "undefined") return null; // old browser — no WebCodecs
  if (!file || file.size < MIN_SIZE || file.size > MAX_SIZE) return null;
  let input = null;
  try {
    const mb = await import("mediabunny");
    input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const w = track.displayWidth || 0, h = track.displayHeight || 0;
    if (!w || !h) return null;
    const scale = Math.min(1, LONG_SIDE / Math.max(w, h));
    // Source already lean (screen recordings, previously-compressed clips) and
    // not oversized → re-encoding would just burn battery for nothing.
    const dur = await input.computeDuration();
    if (dur > 0 && (file.size * 8) / dur < VIDEO_BITRATE * 1.5 && scale === 1) return null;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input, output,
      video: { width: Math.round((w * scale) / 2) * 2, codec: "avc", bitrate: VIDEO_BITRATE },
    });
    if (!conversion.isValid) return null;
    // Never ship a silently-muted video: if the audio track can't come along
    // (uncopyable codec and no encoder on this device), send the original.
    if ((conversion.discardedTracks || []).some((d) => d.track && d.track.type === "audio")) return null;
    if (onProgress) conversion.onProgress = (p) => onProgress(Math.max(1, Math.min(99, Math.round(p * 100))));
    await conversion.execute();
    const buf = output.target.buffer;
    if (!buf || buf.byteLength < 1000 || buf.byteLength >= file.size * 0.85) return null; // barely shrank — keep original
    const name = (file.name || "video").replace(/\.[a-z0-9]+$/i, "") + ".mp4";
    return new File([buf], name, { type: "video/mp4" });
  } catch {
    return null; // any hiccup → the original uploads exactly as before
  } finally {
    try { if (input) input.dispose(); } catch { /* ignore */ }
  }
}
