// Preview-harness network layer for the MAIN app — no backend, no Supabase.
// qbAuthFetch answers the app's API routes with safe, realistic canned shapes
// so pages render instead of erroring. Aliased in by vite.appdemo.config.js.
export const attachmentKind = (mime = "") => mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "file";
export const sanitizeName = (n = "file") => n;
export const STREAM_VIDEO_CAP = 200 * 1024 * 1024;
export async function notify() { /* preview */ }
export async function compressImage(file) { return file; }
export async function waitStreamReady() { return true; }
export async function uploadAttachment(file) {
  return { url: URL.createObjectURL(file), name: file.name || "file", mime: file.type || "", kind: attachmentKind(file.type || "") };
}
export async function uploadStreamVideo(file) { return uploadAttachment(file); }

export async function qbAuthFetch(path) {
  const p = String(path);
  if (p.includes("/api/showings")) return { configured: true, showings: [] };
  if (p.includes("/api/jivetel/send")) return { connected: true, from: "+17325550100", lines: {} };
  if (p.includes("/api/team/roster")) return { names: ["Elie Hassan", "Moshe Hamaoui", "Esti Ungar"] };
  if (p.includes("/api/quickbooks")) return { connected: false, rows: [], income: 0, cogs: 0, expenses: 0, netIncome: 0 };
  if (p.includes("/api/boldtrail")) return { leads: [] };
  if (p.includes("/api/rentcast/value")) {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
    return {
      at: new Date().toISOString(), filters: { radius: 1, months: 12 },
      value: { price: 426000, low: 400000, high: 452000 },
      subject: { sqft: 2056, beds: 4, baths: 2, yearBuilt: 1972, lotSize: 10890, type: "Single Family", pool: false, garage: true, garageSpaces: 2, county: "Burlington", zoning: "R-2", apn: "05076-103-0500", heating: "Forced Air", cooling: "Central", architecture: "Colonial", owner: "Goldstone Properties LLC" },
      comps: [
        { address: "323 Dermody St", full: "323 Dermody St, Pemberton, NJ 08068", price: 495000, priceSrc: "sold", sqft: 1980, beds: 4, baths: 2, distance: 0.15, daysOld: 22, date: d(22) },
        { address: "248 W 3rd Ave", full: "248 W 3rd Ave, Pemberton, NJ 08068", price: 450000, priceSrc: "sold", sqft: 1890, beds: 3, baths: 2, distance: 0.32, daysOld: 95, date: d(95) },
        { address: "207 Clover St", full: "207 Clover St, Pemberton, NJ 08068", price: 275000, priceSrc: "sold", sqft: 1510, beds: 3, baths: 1, distance: 0.02, daysOld: 60, date: d(60) },
        { address: "88 Maple Ave", full: "88 Maple Ave, Pemberton, NJ 08068", price: 610000, priceSrc: "sold", sqft: 3120, beds: 5, baths: 3, distance: 0.6, daysOld: 130, date: d(130) },
        { address: "399 Division St", full: "399 Division St, Pemberton, NJ 08068", price: 474999, priceSrc: "list", sqft: 2120, beds: 4, baths: 2, distance: 0.19, daysOld: 12, date: d(12), dom: 34, recNote: "off-market:" + d(12) + "·34dom" },
        { address: "61 Juliustown Rd", full: "61 Juliustown Rd, Pemberton, NJ 08068", price: 439000, priceSrc: "sold", sqft: 2010, beds: 4, baths: 2, distance: 0.44, daysOld: 210, date: d(210) },
      ],
    };
  }
  if (p.includes("/api/ai/arv")) {
    return { arv: 476000, low: 458000, high: 494000, psf: 232, reasoning: "Preview-mode sample underwrite built from your checked comps — the live site runs the real AI.", used: [{ i: 0, why: "renovated, near-identical size" }, { i: 1, why: "updated, $238/sf" }], skipped: [{ i: 2, why: "as-is estate sale" }] };
  }
  if (p.includes("/api/rentcast")) throw new Error("Preview mode — RentCast runs on the live site.");
  if (p.includes("/api/ai/")) throw new Error("Preview mode — AI runs on the live site.");
  return { ok: true };
}
