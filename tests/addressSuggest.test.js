// node --test tests/ — /api/address/suggest (Add New Lead type-ahead): Google
// Places parsing, place details → street/town/state/zip, OpenStreetMap fallback,
// team-only. Global fetch is stubbed; nothing leaves the machine.
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
let googleOk = true;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
before(() => {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return json({ id: "u1", email: "e@x.com", aud: "authenticated" });
    if (u.includes("/rest/v1/users")) return json({ role: "admin" });
    if (u.includes("places:autocomplete")) return googleOk
      ? json({ suggestions: [{ placePrediction: { placeId: "ChIJ1", text: { text: "12 Oak Ln, Willingboro, NJ, USA" }, structuredFormat: { mainText: { text: "12 Oak Ln" }, secondaryText: { text: "Willingboro, NJ, USA" } } } }] })
      : json({ error: { message: "Places API (New) has not been used in project 123 before or it is disabled." } }, 403);
    if (u.includes("places.googleapis.com/v1/places/ChIJ1")) return json({ formattedAddress: "12 Oak Ln, Willingboro, NJ 08046, USA", addressComponents: [
      { types: ["street_number"], longText: "12", shortText: "12" }, { types: ["route"], longText: "Oak Lane", shortText: "Oak Ln" },
      { types: ["locality"], longText: "Willingboro", shortText: "Willingboro" }, { types: ["administrative_area_level_1"], longText: "New Jersey", shortText: "NJ" },
      { types: ["postal_code"], longText: "08046", shortText: "08046" }] });
    if (u.includes("photon.komoot.io")) return json({ features: [
      { properties: { countrycode: "US", housenumber: "12", street: "Oak Lane", city: "Philadelphia", state: "Pennsylvania", postcode: "19103" } },
      { properties: { countrycode: "US", housenumber: "12", street: "Oak Lane", city: "Willingboro", state: "New Jersey", postcode: "08046" } }] });
    throw new Error("unexpected " + u);
  };
});
const call = async (query, auth = true) => {
  const { default: handler } = await import("../api/address/suggest.js");
  let code = 200, body;
  const res = { setHeader() {}, status(c) { code = c; return res; }, json(b) { body = b; return res; } };
  await handler({ query, headers: auth ? { authorization: "Bearer tok" } : {} }, res);
  return { code, body };
};

test("signed-out callers are refused", async () => {
  assert.equal((await call({ q: "12 oak" }, false)).code, 401);
});
test("Google suggestions + place details", async () => {
  process.env.GOOGLE_MAPS_API_KEY = "k"; googleOk = true;
  const { body } = await call({ q: "12 oak", session: "s1" });
  assert.equal(body.source, "google");
  assert.deepEqual(body.items[0], { id: "g:ChIJ1", main: "12 Oak Ln", secondary: "Willingboro, NJ" });
  const d = (await call({ place: "g:ChIJ1", session: "s1" })).body;
  assert.equal(d.full, "12 Oak Ln, Willingboro, NJ 08046");
});
test("Google off → OpenStreetMap, New Jersey first", async () => {
  googleOk = false;
  const { body } = await call({ q: "12 oak" });
  assert.equal(body.source, "osm");
  assert.match(body.note, /Places API \(New\)/);
  assert.equal(body.items[0].secondary, "Willingboro, NJ 08046");
  assert.equal(body.items[1].secondary, "Philadelphia, PA 19103");
});
