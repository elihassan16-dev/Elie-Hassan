// 🌐 Goldstone Properties public website (Elie 11/8/26 — approved the dark +
// gold concept). Plain JS, no app code: it reads /api/site/listings (only
// the public fields of our On Market / In Closing homes) and
// posts the "Sell to us" form to /api/site/lead (→ New Leads + team push).
// Served at gpflips.com/company now; Elie's own domain points here later.
import "./site.css";

const EMAIL = "info@goldstonepropertiesnj.com";
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const KIND = { sale: "For Sale", pending: "Under Contract" }; // no Sold on the site (Elie 11/8/26)
const logo = (h = 44) => `<img class="mark" src="/site/mark.png" alt="" width="${Math.round(h * 0.87)}" height="${h}">`; // the real Goldstone hexagon (assets/icon-foreground.png)
const LOGO = logo(54);

const state = { listings: null, filter: "sale", form: { condition: "", timeline: "" } };

function factsHtml(l) {
  const f = [];
  if (l.beds) f.push(`<span><b>${esc(l.beds)}</b> Beds</span>`);
  if (l.baths) f.push(`<span><b>${esc(l.baths)}</b> Baths</span>`);
  if (l.sqft) f.push(`<span><b>${l.sqft.toLocaleString("en-US")}</b> Sq ft</span>`);
  if (l.renovated) f.push(`<span><b>Fully renovated</b></span>`);
  return f.length ? `<div class="facts">${f.join("")}</div>` : "";
}
const priceHtml = (l) => l.price ? `<div class="price">${money(l.price)}</div>` : `<div class="price ask">Price on request</div>`;
const coverOf = (l) => (l.photos[0] && l.photos[0].url) || (l.video && l.video.poster) || "";

function card(l) {
  const cover = coverOf(l);
  const n = l.photos.length;
  return `<button class="card" data-id="${esc(l.id)}" aria-label="${esc(l.street)}, ${esc(l.town)}">
    <div class="ph">${cover ? `<div class="cover" style="background-image:url('${esc(cover)}')"></div>` : `<div class="noimg">${LOGO}</div>`}
      ${l.kind !== "sale" ? `<span class="pill st">${KIND[l.kind]}</span>` : ""}
      ${n ? `<span class="pill cnt">▣ ${n} photo${n === 1 ? "" : "s"}</span>` : ""}
      ${l.video ? `<span class="pill vid"><span class="play">▶</span>Video tour</span>` : ""}
    </div>
    <div class="body"><div class="town">${esc(l.town || l.state)}</div><h3>${esc(l.street)}</h3>${priceHtml(l)}${factsHtml(l)}</div>
  </button>`;
}

function renderListings() {
  const box = $("#grid"), tabs = $("#filters");
  if (!state.listings) { box.innerHTML = `<div class="grid">${"<div class='skel'></div>".repeat(3)}</div>`; tabs.innerHTML = ""; return; }
  const counts = { sale: 0, pending: 0 };
  state.listings.forEach((l) => { if (l.kind in counts) counts[l.kind]++; });
  if (!counts[state.filter]) state.filter = ["sale", "pending"].find((k) => counts[k]) || "sale";
  tabs.innerHTML = Object.keys(KIND).filter((k) => counts[k] || k === "sale")
    .map((k) => `<button data-f="${k}" class="${state.filter === k ? "on" : ""}">${KIND[k]}${counts[k] ? ` · ${counts[k]}` : ""}</button>`).join("");
  const list = state.listings.filter((l) => l.kind === state.filter);
  box.innerHTML = list.length ? `<div class="grid">${list.map(card).join("")}</div>`
    : `<div class="empty"><em class="it">New homes coming soon.</em>We're finishing our next renovations right now. Check back shortly — or reach us at <a href="mailto:${EMAIL}">${EMAIL}</a>.</div>`;
}

function renderHeroAndAbout() {
  const withPics = (state.listings || []).filter((l) => coverOf(l));
  const duo = $("#duo");
  const pics = withPics.slice(0, 2);
  if (pics.length === 2) {
    duo.innerHTML = pics.map((l, i) => `<div class="ph ${i ? "b" : "a"}" style="background-image:url('${esc(coverOf(l))}')"><span class="tag">${esc(l.town || l.street)}</span></div>`).join("");
  }
}

// ── Listing detail ─────────────────────────────────────────────
function openListing(id, push = true) {
  const l = (state.listings || []).find((x) => x.id === id);
  if (!l) return;
  if (push) history.pushState({ home: id }, "", `#home/${encodeURIComponent(id)}`);
  const slides = [
    ...(l.video ? [{ video: l.video }] : []),
    ...l.photos.map((p) => ({ img: p.url })),
  ];
  const el = document.createElement("div");
  el.className = "sheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", l.street);
  el.innerHTML = `<div class="box">
    <button class="x" aria-label="Close">✕</button>
    ${slides.length ? `<div class="gal"><div class="track">${slides.map((s, i) => `<div class="slide" data-i="${i}">${s.video
      ? `<button class="vplay" data-v="1" style="all:unset;cursor:pointer;width:100%;height:100%;background:url('${esc(s.video.poster)}') center/cover;display:grid;place-items:center" aria-label="Play the video tour"><span class="pill" style="position:static;font-size:13px;padding:12px 20px 12px 12px"><span class="play" style="width:34px;height:34px;font-size:13px">▶</span>Play video tour</span></button>`
      : `<img src="${esc(s.img)}" alt="${esc(l.street)} photo ${i + 1}" loading="${i < 2 ? "eager" : "lazy"}">`}</div>`).join("")}</div>
      ${slides.length > 1 ? `<button class="nav l" aria-label="Previous">‹</button><button class="nav r" aria-label="Next">›</button>` : ""}
      ${slides.length > 1 ? `<span class="pill ctr"><span id="gi">1</span>&nbsp;/ ${slides.length}</span>` : ""}</div>
      ${slides.length > 1 ? `<div class="thumbs">${slides.map((s, i) => `<button data-t="${i}" class="${i ? "" : "on"} ${s.video ? "vt" : ""}" style="background-image:url('${esc(s.video ? s.video.poster : s.img)}')" aria-label="Show ${s.video ? "video" : "photo " + i}">${s.video ? "▶" : ""}</button>`).join("")}</div>` : ""}` : ""}
    <div class="det"><div>
      <div class="town">${esc([l.town, l.state].filter(Boolean).join(", "))}${l.kind !== "sale" ? ` · ${KIND[l.kind]}` : ""}</div>
      <h2>${esc(l.street)}</h2>${priceHtml(l)}${factsHtml(l)}
      ${l.blurb ? `<div class="blurb">${esc(l.blurb)}</div>` : `<div class="blurb">A Goldstone renovation — rebuilt with care, inside and out, and ready to move in.</div>`}
    </div><aside>
      <h3>Interested in this home?</h3><p>Ask us anything or set up a private showing — we'll get right back to you.</p>
      <a class="btn gold" href="mailto:${EMAIL}?subject=${encodeURIComponent(`${l.street}, ${l.town}`)}&body=${encodeURIComponent(`Hi, I'm interested in ${l.street}, ${l.town}. `)}">Ask about this home</a>
      <a class="btn ghost" href="#sell" data-close="1">Selling a house?</a>
    </aside></div></div>`;
  document.body.appendChild(el); document.body.classList.add("locked");
  const track = $(".track", el);
  const go = (i) => { if (track) track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" }); };
  const cur = () => (track ? Math.round(track.scrollLeft / Math.max(1, track.clientWidth)) : 0);
  const close = (back = true) => { el.remove(); document.body.classList.remove("locked"); document.removeEventListener("keydown", onKey); if (back && location.hash.startsWith("#home/")) history.back(); };
  const onKey = (e) => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") go(cur() + 1); if (e.key === "ArrowLeft") go(cur() - 1); };
  document.addEventListener("keydown", onKey);
  el._close = close;
  el.addEventListener("click", (e) => {
    const t = e.target.closest("button,a");
    if (e.target === el || (t && t.classList.contains("x"))) return close();
    if (!t) return;
    if (t.dataset.close) { close(false); history.replaceState(null, "", "#sell"); return; }
    if (t.classList.contains("l")) go(cur() - 1);
    if (t.classList.contains("r")) go(cur() + 1);
    if (t.dataset.t) go(Number(t.dataset.t));
    if (t.dataset.v) { const v = slides[0].video; t.outerHTML = `<iframe src="${esc(v.player)}?autoplay=true&poster=${encodeURIComponent(v.poster)}" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowfullscreen title="Video tour"></iframe>`; }
  });
  if (track) track.addEventListener("scroll", () => {
    const i = cur(); const gi = $("#gi", el); if (gi) gi.textContent = String(i + 1);
    el.querySelectorAll(".thumbs button").forEach((b, j) => b.classList.toggle("on", i === j));
  }, { passive: true });
  $(".x", el).focus();
}
function syncHash() {
  const open = $(".sheet");
  const m = /^#home\/(.+)$/.exec(location.hash);
  if (!m && open) open._close(false);
  if (m && !open) openListing(decodeURIComponent(m[1]), false);
}

// ── Sell form ─────────────────────────────────────────────────
function formHtml() {
  const chips = (k, opts) => `<div class="chips" data-k="${k}">${opts.map((o) => `<button type="button" data-o="${esc(o)}" aria-pressed="false">${esc(o)}</button>`).join("")}</div>`;
  return `<h3>Get a cash offer</h3><p>Free, no obligation. We never share your information.</p>
    <div id="ferr"></div>
    <label class="fld"><span>Property address</span><input name="address" autocomplete="street-address" placeholder="Street, town, ZIP" required></label>
    <div class="row"><label class="fld"><span>Your name</span><input name="name" autocomplete="name" placeholder="Full name" required></label>
    <label class="fld"><span>Phone</span><input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555"></label></div>
    <label class="fld"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="you@email.com"></label>
    <fieldset class="fld"><legend>Condition</legend>${chips("condition", ["Move-in ready", "Needs some work", "Needs a lot of work", "Not sure"])}</fieldset>
    <fieldset class="fld"><legend>How soon do you want to sell?</legend>${chips("timeline", ["ASAP", "1–3 months", "3+ months", "Just exploring"])}</fieldset>
    <label class="fld"><span>Anything else? (optional)</span><textarea name="message" placeholder="Inherited, tenants, liens, behind on payments…"></textarea></label>
    <label class="hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
    <button class="btn gold" type="submit">Get my cash offer</button>
    <div class="fine">Goes straight to our team — we'll reach out shortly.</div>`;
}
function wireForm() {
  const f = $("#offer");
  f.innerHTML = formHtml();
  f.addEventListener("click", (e) => {
    const b = e.target.closest(".chips button"); if (!b) return;
    const k = b.parentElement.dataset.k, v = b.dataset.o;
    state.form[k] = state.form[k] === v ? "" : v;
    b.parentElement.querySelectorAll("button").forEach((x) => { const on = x.dataset.o === state.form[k]; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(f).entries());
    const err = (m) => { $("#ferr").innerHTML = m ? `<div class="err" role="alert">${esc(m)}</div>` : ""; };
    if (!String(fd.phone || "").replace(/\D/g, "").length && !String(fd.email || "").trim()) return err("Please enter a phone number or email so we can reach you.");
    const btn = $("button[type=submit]", f); btn.disabled = true; btn.textContent = "Sending…"; err("");
    try {
      const r = await fetch("/api/site/lead", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fd, ...state.form }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 429) throw new Error(j.error || "Something went wrong — please try again.");
      f.innerHTML = `<div class="thanks"><div class="seal">✓</div><h3>Thank you${fd.name ? `, ${esc(String(fd.name).split(" ")[0])}` : ""}.</h3><p>Your request is with our team. We'll review the property and reach out with your offer — usually within 24 hours.</p></div>`;
    } catch (x) { err(x.message || "Something went wrong — please try again."); btn.disabled = false; btn.textContent = "Get my cash offer"; }
  });
}

// ── Page ──────────────────────────────────────────────────────
function page() {
  const year = new Date().getFullYear();
  return `
<header class="hero" id="top">
  <div class="bg photo" id="heroBg"></div><div class="shade"></div>
  <nav class="top" aria-label="Main"><div class="wrap">
    <a class="brand" href="#top">${LOGO}<div class="wm"><b>GOLDSTONE</b><small>PROPERTIES</small></div></a>
    <div class="links"><a href="#about">About</a><a href="#listings">Listings</a><a href="#sell">Sell Your House</a><a href="mailto:${EMAIL}">Contact</a><a class="btn gold" href="#sell">Sell to Us</a></div>
  </div></nav>
  <div class="wrap">
    <div class="kick">New Jersey Real Estate</div>
    <h1>Homes, <em class="it">reimagined.</em></h1>
    <p>We buy houses across New Jersey, renovate them top to bottom with care, and bring them back to market ready for the next family.</p>
    <div class="cta"><a class="btn gold" href="#listings">View our listings</a><a class="btn ghost" href="#sell">Get a cash offer →</a></div>
  </div>
</header>
<main>
<section class="about" id="about"><div class="wrap">
  <div>
    <div class="kick">About Goldstone</div>
    <h2>Every house deserves a <em class="it">second act.</em></h2>
    <p class="lead">Goldstone Properties is a family-run real estate company. We find homes that need work, invest in them properly — new kitchens, baths, systems and finishes — and deliver move-in ready homes built to last. For sellers, we make it simple: a fair cash offer, no repairs, and a closing on your timeline.</p>
    <div class="pillars">
      <div><h3>We buy</h3><p>Any condition, any situation. Cash, no agents, no showings.</p></div>
      <div><h3>We renovate</h3><p>Our own team manages every trade, start to finish.</p></div>
      <div><h3>We sell</h3><p>Fully renovated homes, every finish chosen with care.</p></div>
      <div><h3>We hold</h3><p>A growing rental portfolio across New Jersey.</p></div>
    </div>
  </div>
  <div class="duo" id="duo"><div class="art">${logo(170)}</div></div>
</div></section>
<section class="listings" id="listings"><div class="wrap">
  <div class="lhead"><div><div class="kick">Available now</div><h2>Our Listings</h2></div><div class="filters" id="filters" role="tablist"></div></div>
  <div id="grid"></div>
</div></section>
<section class="sell" id="sell"><div class="wrap">
  <div>
    <div class="kick">Sell your house</div>
    <h2>Sell to us. <em class="it">Skip the hassle.</em></h2>
    <p class="lead">No repairs, no cleaning, no showings, no commissions. Tell us about your property and we'll get back to you with a fair cash offer.</p>
    <div class="steps">
      <div><b>01</b><span><h3>Tell us about the house</h3><p>Takes two minutes.</p></span></div>
      <div><b>02</b><span><h3>Get your cash offer</h3><p>A real number, usually within 24 hours.</p></span></div>
      <div><b>03</b><span><h3>Close when you're ready</h3><p>You pick the date. We handle the rest.</p></span></div>
    </div>
  </div>
  <form class="offer" id="offer" novalidate></form>
</div></section>
</main>
<footer><div class="wrap">
  <a class="brand" href="#top">${logo(40)}<div class="wm"><b>GOLDSTONE</b><small>PROPERTIES</small></div></a>
  <div>New Jersey · <a href="mailto:${EMAIL}">${EMAIL}</a></div>
  <div>© ${year} Goldstone Properties</div>
</div></footer>`;
}

async function load() {
  try {
    const r = await fetch("/api/site/listings");
    const j = await r.json();
    state.listings = Array.isArray(j.listings) ? j.listings : [];
  } catch { state.listings = []; }
  renderListings(); renderHeroAndAbout(); syncHash();
}

$("#site").innerHTML = page();
wireForm();
renderListings();
$("#filters").addEventListener("click", (e) => { const b = e.target.closest("button[data-f]"); if (b) { state.filter = b.dataset.f; renderListings(); } });
$("#grid").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) openListing(c.dataset.id); });
window.addEventListener("popstate", syncHash);
load();
