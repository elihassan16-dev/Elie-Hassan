// Scope-of-Work library — the standard lines Elie picks from when building a
// house's scope (approved design 9/2/26). Seeded here in his voice; his own
// lines, edits and deletions live in app_settings row "sow_library" and are
// merged over the seed, so the seed can grow later without clobbering him.
//
// Library item: { id, cat, text, custom? }      (custom = written by the team)
// Scope line:   { id, libId, cat, text, status } status = "in" | "asneeded" | "discuss"

export const SOW_CATS = [
  { key: "demo", label: "Demo & Trash", emoji: "🗑", long: "DEMOLITION & TRASH REMOVAL" },
  { key: "exterior", label: "Exterior", emoji: "🏠", long: "EXTERIOR" },
  { key: "roof", label: "Roof", emoji: "🧱", long: "ROOF & GUTTERS" },
  { key: "windows", label: "Windows & Doors", emoji: "🚪", long: "WINDOWS & DOORS" },
  { key: "framing", label: "Framing & Drywall", emoji: "🪚", long: "FRAMING, INSULATION & DRYWALL" },
  { key: "electric", label: "Electrical", emoji: "⚡", long: "ELECTRICAL" },
  { key: "plumbing", label: "Plumbing", emoji: "🚰", long: "PLUMBING" },
  { key: "hvac", label: "HVAC", emoji: "❄️", long: "HVAC" },
  { key: "kitchen", label: "Kitchen", emoji: "🍳", long: "KITCHEN" },
  { key: "bath", label: "Bathrooms", emoji: "🛁", long: "BATHROOMS" },
  { key: "floors", label: "Flooring", emoji: "🪵", long: "FLOORING" },
  { key: "paint", label: "Paint", emoji: "🎨", long: "PAINT" },
  { key: "trim", label: "Trim & Interior Doors", emoji: "📐", long: "TRIM, INTERIOR DOORS & HARDWARE" },
  { key: "site", label: "Landscaping & Final", emoji: "🌳", long: "LANDSCAPING, SITE & FINAL CLEAN" },
  { key: "general", label: "General", emoji: "📋", long: "GENERAL CONDITIONS" },
];
export const catOf = (key) => SOW_CATS.find((c) => c.key === key) || SOW_CATS[SOW_CATS.length - 1];

export const SOW_STATUS = {
  in: { label: "Included", short: "", color: "#0F9D58", bg: "#EDFBF1" },
  asneeded: { label: "As needed", short: "as needed", color: "#0A66C2", bg: "#E8F4FF" },
  discuss: { label: "To discuss", short: "TO DISCUSS", color: "#B45309", bg: "#FDE9C8" },
};
export const NEXT_STATUS = { in: "asneeded", asneeded: "discuss", discuss: "in" };

// Who buys the materials for a line. The scope has one default (sow.matDefault,
// normally "contractor" = labor AND materials); a line can override it.
export const SOW_MAT = {
  contractor: { label: "Contractor buys materials", short: "CONTRACTOR MATERIALS", who: "Contractor" },
  goldstone: { label: "Goldstone buys materials", short: "GOLDSTONE MATERIALS", who: "Goldstone" },
};
export const matOf = (it, def) => (it && it.mat) || def || "contractor";

const S = (cat, lines) => lines.map((text, i) => ({ id: `s-${cat}-${i + 1}`, cat, text }));
export const SOW_SEED = [
  ...S("demo", [
    "Demo & dispose of all debris, interior and exterior",
    "Demo & dispose of all work necessary to conduct the rehab",
    "Demo & dispose of exterior shed",
    "Demo & dispose of exterior deck",
    "Demo & dispose of above-ground pool and decking",
    "Remove all existing flooring down to subfloor",
    "Remove kitchen cabinets, countertops and appliances",
    "Gut bathrooms to studs",
    "Remove all wallpaper and paneling",
    "Remove drop ceilings",
    "Remove all window treatments, hardware and nails",
    "Dumpsters, hauling and dump fees by contractor",
    "Clean out basement, attic and garage of all contents",
  ]),
  ...S("exterior", [
    "Power-wash all siding, walkways and driveway",
    "Repair/replace damaged siding sections to match existing",
    "Install new vinyl siding — whole house",
    "Install new exterior trim, soffit and fascia",
    "Replace all exterior doors and trim",
    "Install new front door with new lockset and deadbolt",
    "Install new storm doors",
    "Repair/replace front porch and steps",
    "Repair/replace rear deck and railings to code",
    "Install new exterior light fixtures — front, rear and side",
    "Install new house numbers and mailbox",
    "Repair/replace concrete walkway and front steps",
    "Repair/replace garage door and opener",
    "Paint all exterior trim, doors and shutters",
  ]),
  ...S("roof", [
    "Tear off existing roof and install new architectural shingle roof with ice & water shield, drip edge and ridge vent",
    "Roof repair — replace damaged shingles and flashing, seal all penetrations",
    "Install new gutters and downspouts with splash blocks",
    "Clean and reseal existing gutters",
    "Replace rotted roof sheathing as needed",
    "Install new roof vents and pipe boots",
  ]),
  ...S("windows", [
    "Replace all windows with new vinyl double-hung, double-pane, low-E",
    "Replace windows as needed — confirm count on site",
    "Install new interior window sills and trim",
    "Replace all interior doors with new 6-panel hollow-core, prehung",
    "Replace all interior door hardware — lever style, matching finish",
    "Install new closet doors — bifold",
    "Install new basement/bulkhead door",
  ]),
  ...S("framing", [
    "Frame new walls per layout drawing",
    "Remove wall between kitchen and living room — engineer-approved beam and posts",
    "Frame new closet(s) per plan",
    "Install new insulation in all exterior walls and attic to code",
    "Hang, tape and finish drywall — all walls and ceilings, level 4",
    "Patch and skim-coat all existing walls and ceilings — smooth finish",
    "Remove popcorn ceilings and refinish smooth",
    "Sister/replace damaged floor joists as needed",
    "Repair/replace subfloor as needed",
  ]),
  ...S("electric", [
    "New 200-amp electrical service and panel — permitted and inspected",
    "Rewire entire house to code — permitted and inspected",
    "Replace all outlets, switches and cover plates — white Decora",
    "Install GFCI outlets in kitchen, baths, garage and exterior per code",
    "Install new recessed LED lighting — living areas, kitchen and hallways",
    "Install new light fixtures per spec sheet in every room",
    "Install bathroom exhaust fans vented to exterior",
    "Install hardwired smoke and CO detectors per code",
    "Install new doorbell",
    "Install ceiling fan boxes in bedrooms",
    "Provide dedicated circuits for kitchen appliances, HVAC and laundry",
  ]),
  ...S("plumbing", [
    "Replace all supply lines with PEX — whole house",
    "Replace all drain, waste and vent lines as needed",
    "Install new water heater — 40/50-gallon, gas or electric to match existing",
    "Install new kitchen sink, faucet and garbage disposal per spec sheet",
    "Install new bathroom fixtures — toilet, vanity, faucet, tub/shower valve and trim — per spec sheet",
    "Install new tub or shower base with surround per spec sheet",
    "Install new hose bibs — front and rear",
    "Install washer box and dryer vent for laundry",
    "Install new sump pump and check valve",
    "Camera-scope and clear main sewer line; report condition",
  ]),
  ...S("hvac", [
    "Install new gas furnace and central A/C system, sized for the house — permitted and inspected",
    "Install new heat pump / mini-split system per plan",
    "Service existing HVAC system; replace filter, test and certify",
    "Replace ductwork as needed; add returns to bedrooms",
    "Install new thermostat — smart, wifi",
    "Install new baseboard heat / replace radiators as needed",
  ]),
  ...S("kitchen", [
    "Install new kitchen cabinets per layout and spec sheet — level, plumb, soft-close",
    "Install new countertops per spec sheet with undermount sink cutout",
    "Install tile backsplash per spec sheet",
    "Install new stainless appliance package — range, microwave, dishwasher, refrigerator (Goldstone supplies)",
    "Install new kitchen light fixtures and under-cabinet lighting",
    "Install cabinet hardware per spec sheet",
    "Install new pantry shelving",
  ]),
  ...S("bath", [
    "Full bathroom remodel — tile floor, tile tub/shower surround to ceiling, new vanity, toilet, mirror, fixtures and accessories per spec sheet",
    "Install new tile floor per spec sheet",
    "Install tile tub/shower surround to ceiling per spec sheet",
    "Install new vanity, top, faucet and mirror per spec sheet",
    "Install new toilet — elongated, comfort height",
    "Install new towel bars, paper holder and accessories per spec sheet",
    "Install new shower door / curtain rod",
    "Add new half bath per plan",
  ]),
  ...S("floors", [
    "Install new LVP flooring throughout per spec sheet — whole house except baths",
    "Install new LVP flooring — first floor",
    "Refinish existing hardwood floors — sand, stain per spec sheet, 3 coats poly",
    "Install new carpet and pad — bedrooms and stairs",
    "Install new tile floors — kitchen, baths and laundry",
    "Install new stair treads and risers; refinish",
    "Level subfloor as needed before new flooring",
  ]),
  ...S("paint", [
    "Paint entire interior — walls, ceilings, trim and doors — colors per spec sheet, 2 coats",
    "Prime all new drywall",
    "Paint all interior trim and doors — semi-gloss",
    "Paint basement floor and walls",
    "Paint exterior — siding, trim, doors and shutters",
    "Stain/seal deck and railings",
  ]),
  ...S("trim", [
    "Install new baseboard throughout — 5¼\" colonial",
    "Install new door and window casing throughout",
    "Install new crown molding — living room and dining room",
    "Install new closet shelving and rod — all closets",
    "Install new stair railing and balusters to code",
    "Install new interior door hardware, hinges and stops",
  ]),
  ...S("site", [
    "Clean up yard — remove all debris, overgrowth and dead trees/shrubs",
    "Trim trees and shrubs away from the house",
    "Fresh mulch beds and new shrubs at front of house",
    "Seed/sod lawn — front and rear",
    "Repair/replace fence and gates",
    "Grade soil away from foundation",
    "Final construction clean — whole house ready to show, windows inside and out",
  ]),
  ...S("general", [
    "Contractor is licensed and insured; provide certificate of insurance before start",
    "All permits pulled and inspections passed by contractor unless noted",
    "All work to code and to manufacturer specifications",
    "Debris removed daily; site kept broom-clean and safe",
    "Materials per Goldstone Finish Spec Sheet unless noted; substitutions need written approval",
    "Any change to this scope is priced and approved in writing before the work is done",
    "One-year workmanship warranty on all work",
    "Progress payments per the schedule in the contract; final payment after punch list is complete",
  ]),
];

// Merge the seed with the team's changes from the app_settings row.
// row = { id:"sow_library", added:[{id,cat,text}], removed:[id], edits:{id:text} }
export function libraryFrom(row) {
  const removed = new Set((row && row.removed) || []);
  const edits = (row && row.edits) || {};
  const seed = SOW_SEED.filter((it) => !removed.has(it.id)).map((it) => (edits[it.id] ? { ...it, text: edits[it.id] } : it));
  const added = ((row && row.added) || []).filter((it) => it && it.id && !removed.has(it.id)).map((it) => ({ ...it, custom: true, text: edits[it.id] || it.text }));
  return [...seed, ...added];
}

// Pure helpers that return the next row — callers write it to app_settings.
export const libAdd = (row, cat, text) => {
  const it = { id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, cat, text: String(text || "").trim(), at: new Date().toISOString() };
  return { next: { ...(row || { id: "sow_library" }), id: "sow_library", added: [...((row && row.added) || []), it] }, item: { ...it, custom: true } };
};
export const libEdit = (row, id, text) => ({ ...(row || { id: "sow_library" }), id: "sow_library", edits: { ...((row && row.edits) || {}), [id]: String(text || "").trim() } });
export const libRemove = (row, id) => ({ ...(row || { id: "sow_library" }), id: "sow_library", removed: [...new Set([...((row && row.removed) || []), id])] });

// Plain-text rendering — what the contractor portal's line-by-line bid box
// mirrors, and the fallback wherever only text is understood.
export function scopeToText(items, matDefault = "contractor") {
  const out = [`MATERIALS: ${SOW_MAT[matDefault] ? SOW_MAT[matDefault].label.toLowerCase() : "contractor buys materials"} unless a line says otherwise.`];
  SOW_CATS.forEach((c) => {
    const rows = (items || []).filter((it) => it.cat === c.key);
    if (!rows.length) return;
    out.push("");
    out.push(c.long);
    rows.forEach((it, i) => {
      const m = matOf(it, matDefault);
      out.push(`${i + 1}. ${it.text}${it.status === "asneeded" ? " (as needed — confirm on site)" : it.status === "discuss" ? " — TO DISCUSS with Goldstone before pricing" : ""}${m !== matDefault ? ` (${SOW_MAT[m].who} buys the materials)` : ""}${it.note ? ` — ${it.note}` : ""}`);
    });
  });
  return out.join("\n");
}

export const scopeCounts = (items) => {
  const n = { total: 0, in: 0, asneeded: 0, discuss: 0 };
  (items || []).forEach((it) => { n.total++; n[it.status || "in"] = (n[it.status || "in"] || 0) + 1; });
  return n;
};
