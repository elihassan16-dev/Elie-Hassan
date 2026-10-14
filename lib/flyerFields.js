// Server copy of the flyer's default fields (src/flyers.jsx defaultFields) so the
// Claude connector can start a Social Posts draft with the same caption/fields the
// editor would. Copied verbatim — re-copy if defaultFields changes.
/* eslint-disable */
const STATES = { NJ: "New Jersey", NY: "New York", PA: "Pennsylvania", CT: "Connecticut", DE: "Delaware", MD: "Maryland", FL: "Florida", OH: "Ohio", MA: "Massachusetts", VA: "Virginia", NC: "North Carolina", GA: "Georgia", TX: "Texas" };
const stateFull = (s) => STATES[String(s || "").toUpperCase()] || s || "";
const num = (v) => { const n = parseFloat(String(v || "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };
const acres = (lot) => {
  const s = String(lot || "").toLowerCase(); const n = num(s);
  if (!n) return "";
  if (/sq|sf|ft/.test(s) || n > 20) return (n / 43560).toFixed(2);
  return String(+n.toFixed(2));
};
const commas = (v) => { const n = num(v); return n ? Math.round(n).toLocaleString("en-US") : ""; };
function defaultFields(property, kind) {
  const pi = property.propertyInfo || {};
  const city = property.city || "", st = stateFull(property.state);
  const addr = property.address || "";
  const sqft = commas(pi.sqft), beds = String(pi.beds || ""), baths = String(pi.baths || ""), lot = acres(pi.lot), year = String(pi.yearBuilt || "");
  const base = { kind, beds, baths, sqft, lot, year, days: "", price: "", showPrice: false, phone: "" };
  if (kind === "purchased") return {
    ...base, kicker: "JUST ACQUIRED", title: city || "New Jersey", sub: `${st || "New Jersey"}  ·  our newest project`,
    note: "The transformation starts now — follow along for the after", cta: "Follow along for the before & after",
    caption: `🏡 Just picked up our newest project in ${city || "town"}! Here's day one — stay tuned for the transformation. #GoldstoneProperties #BeforeAndAfter`,
  };
  if (kind === "sold") return {
    ...base, kicker: "SOLD", title: addr, sub: [city, st].filter(Boolean).join(", "),
    note: "Another Goldstone transformation — from dated to move-in ready", cta: "Thinking of selling? Message us today",
    caption: `🎉 SOLD! ${addr}${city ? `, ${city}` : ""} — another Goldstone transformation. Thinking of selling? Message us today. #GoldstoneProperties #Sold`,
  };
  const facts = [beds && `${beds} bed`, baths && `${baths} bath`, sqft && `${sqft} sq ft`].filter(Boolean).join(" · ");
  return {
    ...base, kicker: "JUST LISTED", title: addr, sub: [city, st].filter(Boolean).join(", "),
    note: lot ? "Fully renovated on an oversized lot — move-in ready" : "Fully renovated and move-in ready", cta: "",
    caption: `✨ Just listed: ${addr}${city ? `, ${city}` : ""}.${facts ? ` ${facts}.` : ""} Message us for pricing & a private showing! #GoldstoneProperties #JustListed`,
  };
}

export { defaultFields };
