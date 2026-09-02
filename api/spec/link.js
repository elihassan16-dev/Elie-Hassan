// Paste a product link on the Finish Spec Sheet → the app grabs the page's
// share image, title, description and price so the card builds itself
// (Elie 9/2/26). Best-effort: retailers that block bots just return nothing
// and the app falls back to "add a photo". Team-only.
import { requireTeamUser } from "../../lib/quickbooks.js";

const pick = (html, names) => {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${n}["']`, "i");
    const m = html.match(re) || html.match(re2);
    if (m && m[1]) return m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
  }
  return "";
};

export default async function handler(req, res) {
  const user = await requireTeamUser(req);
  if (!user) { res.status(401).json({ error: "Not signed in." }); return; }
  let url = String(req.query.url || "").trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  let u;
  try { u = new URL(url); } catch { res.status(400).json({ error: "That doesn't look like a link." }); return; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 7000);
    const r = await fetch(u.toString(), {
      signal: ctl.signal, redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", Accept: "text/html,application/xhtml+xml" },
    });
    clearTimeout(t);
    const html = (await r.text()).slice(0, 600000);
    let image = pick(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]);
    if (image && image.startsWith("//")) image = "https:" + image;
    if (image && image.startsWith("/")) image = `${u.origin}${image}`;
    const title = pick(html, ["og:title", "twitter:title"]) || (html.match(/<title[^>]*>([^<]{1,200})<\/title>/i) || [])[1] || "";
    const desc = pick(html, ["og:description", "description", "twitter:description"]);
    const price = pick(html, ["product:price:amount", "og:price:amount", "twitter:data1"]);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(200).json({ ok: true, url: u.toString(), image, title: title.replace(/\s+/g, " ").slice(0, 160), desc: desc.slice(0, 300), price: /^\$?\d/.test(price) ? price : "", blocked: r.status === 403 || r.status === 429 });
  } catch (e) {
    res.status(200).json({ ok: false, url: u.toString(), image: "", title: "", desc: "", price: "", error: e.name === "AbortError" ? "That site took too long." : "Couldn't read that page." });
  }
}
