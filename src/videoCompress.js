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
    // H.264 everywhere it exists (iPhones, Android, desktop); a couple of
    // fallbacks for browsers built without it. Nothing encodable → original.
    const outW = Math.round((w * scale) / 2) * 2, outH = Math.round((h * scale) / 2) * 2;
    const codec = await mb.getFirstEncodableVideoCodec(["avc", "hevc", "vp9"], { width: outW, height: outH, bitrate: VIDEO_BITRATE });
    if (!codec) return null;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input, output,
      video: { width: outW, codec, bitrate: VIDEO_BITRATE },
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

// 📱 A copy small enough to TEXT (Elie 10/27/26 — reverse-prospecting pitches
// send the walkthrough as a real video attachment, like texting one from the
// phone's gallery). Business texts go out as MMS, where carriers only take a
// few MB, so this makes a ~2.5 MB clip: the first minute at most, phone-size
// (640 on the long side), modest bitrate — about what a phone itself sends over
// MMS. Returns a File, or throws with a plain-English reason.
export const TEXT_VIDEO_MAX = 2.5 * 1024 * 1024;
export async function compressForText(file, onProgress, { maxBytes = TEXT_VIDEO_MAX, maxSec = 60, codecs = ["avc"] } = {}) {
  if (typeof VideoEncoder === "undefined") throw new Error("This browser can't shrink videos — use Chrome on a computer, or a newer iPhone.");
  const mb = await import("mediabunny");
  const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("That file has no video in it.");
    const w = track.displayWidth || 0, h = track.displayHeight || 0;
    if (!w || !h) throw new Error("Couldn't read the video's size.");
    const full = (await input.computeDuration()) || maxSec;
    const dur = Math.max(1, Math.min(full, maxSec));
    const scale = Math.min(1, 640 / Math.max(w, h));
    const outW = Math.round((w * scale) / 2) * 2;
    const outH = Math.round((h * scale) / 2) * 2;
    // Two tries: re-encode the sound small (AAC mono) — or, on a device with no
    // AAC encoder, copy the original sound track and spend less on the picture.
    let conversion = null, output = null;
    for (const [AUDIO, audio] of [[48_000, { codec: "aac", bitrate: 48_000, numberOfChannels: 1, forceTranscode: true }], [160_000, {}]]) {
      const vbit = Math.max(150_000, Math.min(900_000, Math.floor((maxBytes * 8 * 0.88) / dur) - AUDIO));
      const codec = await mb.getFirstEncodableVideoCodec(codecs, { width: outW, height: outH, bitrate: vbit });
      if (!codec) throw new Error("This device can't make an MP4 video — try on a computer with Chrome.");
      output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
      conversion = await mb.Conversion.init({
        input, output,
        video: { width: outW, codec, bitrate: vbit, forceTranscode: true },
        audio,
        ...(full > maxSec ? { trim: { start: 0, end: maxSec } } : {}),
      });
      if (conversion.isValid && !(conversion.discardedTracks || []).some((d) => d.track && d.track.type === "audio")) break;
      conversion = null;
    }
    if (!conversion) throw new Error("Couldn't convert this video on this device — try on a computer with Chrome.");
    if (onProgress) conversion.onProgress = (p) => onProgress(Math.max(1, Math.min(99, Math.round(p * 100))));
    await conversion.execute();
    const buf = output.target.buffer;
    if (!buf || buf.byteLength < 1000) throw new Error("Converting the video failed.");
    const name = (file.name || "video").replace(/\.[a-z0-9]+$/i, "") + " (text).mp4";
    return { file: new File([buf], name, { type: "video/mp4" }), seconds: Math.round(dur), trimmed: full > maxSec + 0.5 };
  } finally {
    try { input.dispose(); } catch { /* ignore */ }
  }
}
