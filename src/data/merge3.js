// Three-way merge for concurrent saves: apply OUR local changes (base → ours)
// on top of THEIR freshest copy. Anywhere we didn't touch, THEIR value stays;
// where only we touched, OURS lands; where both sides touched the same spot,
// ours (the edit being saved right now) wins. Objects merge key-by-key; arrays
// of {id:…} items (tasks, leads, messages) merge item-by-item so one device
// editing task A never wipes another device's new lead status — the whole
// reason this exists: a stale open tab saving its old copy of a property used
// to erase every change made elsewhere since that tab last loaded.
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function merge3(base, ours, theirs) {
  if (same(ours, base)) return theirs;   // we didn't touch this — take theirs
  if (same(theirs, base)) return ours;   // only we touched it — take ours
  if (isObj(base) && isObj(ours) && isObj(theirs)) {
    const out = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
      const b = base[k], o = ours[k], t = theirs[k];
      const v = !same(o, b) ? (!same(t, b) ? merge3(b, o, t) : o) : t;
      if (v !== undefined) out[k] = v; // undefined = deleted by whichever side changed it
    }
    return out;
  }
  const idArr = (a) => Array.isArray(a) && a.every((x) => x && typeof x === "object" && "id" in x);
  if (idArr(base) && idArr(ours) && idArr(theirs)) {
    const bM = new Map(base.map((x) => [String(x.id), x]));
    const oM = new Map(ours.map((x) => [String(x.id), x]));
    const out = [];
    const seen = new Set();
    theirs.forEach((t) => {
      const id = String(t.id);
      seen.add(id);
      const b = bM.get(id), o = oM.get(id);
      if (o === undefined) { if (b === undefined) out.push(t); return; } // theirs added → keep; we deleted → drop
      out.push(!same(o, b) ? (!same(t, b) ? merge3(b ?? {}, o, t) : o) : t);
    });
    ours.forEach((o) => {
      const id = String(o.id);
      if (seen.has(id)) return;
      const b = bM.get(id);
      if (b === undefined) out.push(o);            // our local add
      else if (!same(o, b)) out.push(o);           // they deleted it but we edited it → keep ours
      /* they deleted it and we left it alone → respect their delete */
    });
    return out;
  }
  return ours; // scalars / mixed shapes both changed: the edit being saved wins
}
