// 🏢 Platinum Management (AppFolio) owner packets → structured data (Elie 10/5/26).
// Elie's Cowork downloads the owner statement PDF from the AppFolio owner
// portal twice a week and uploads it on Rental Portfolio; this reads it with
// pdf.js — Owner Statement pages (cash summary, transactions, bills due),
// Income Statement pages and Rent Roll pages — by text position, so wrapped
// cells ("American / Express", "05/01/ / 2026") land in the right column.
// View-only: Esti books Platinum's numbers in QuickBooks, so nothing here
// writes to the rental ledgers.

let pdfjsP = null;
const loadPdfjs = () => {
  if (!pdfjsP) {
    pdfjsP = Promise.all([
      import("pdfjs-dist/legacy/build/pdf.min.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    ]).then(([pdfjs, worker]) => { pdfjs.GlobalWorkerOptions.workerSrc = worker.default; return pdfjs; });
  }
  return pdfjsP;
};

const num = (s) => {
  const t = String(s || "").replace(/[$,\s]/g, "");
  if (!/^\(?-?\d+(\.\d+)?\)?$/.test(t)) return null;
  const v = parseFloat(t.replace(/[()]/g, ""));
  return /^\(.*\)$/.test(t) ? -v : v;
};
const isNum = (s) => num(s) != null;
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const toIso = (mdY) => { const m = String(mdY || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : ""; };
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const longIso = (s) => { const m = String(s || "").match(/([A-Z][a-z]{2})[a-z]* (\d{1,2}), (\d{4})/); return m && MON[m[1]] ? `${m[3]}-${String(MON[m[1]]).padStart(2, "0")}-${m[2].padStart(2, "0")}` : ""; };
// "420 Philadelphia Ave - 420 Philadelphia Ave, Egg Harbor City, NJ 08215"
const PROP_HDR = /^(.+?) - (.+?,? [A-Z][A-Za-z .'-]*,? [A-Z]{2} \d{5}(-\d{4})?)$/;
export const afKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Text items → {s, x, r, y} per page, top to bottom.
async function pageItems(pdf) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const pg = await pdf.getPage(i);
    const tc = await pg.getTextContent();
    pages.push(tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str.trim(), x: it.transform[4], r: it.transform[4] + it.width, y: it.transform[5] })));
  }
  return pages;
}
// Group items into visual lines (same baseline ±2), top to bottom, left to right.
function lines(items) {
  const out = [];
  [...items].sort((a, b) => b.y - a.y || a.x - b.x).forEach((it) => {
    const L = out.find((l) => Math.abs(l.y - it.y) <= 2);
    if (L) L.items.push(it); else out.push({ y: it.y, items: [it] });
  });
  out.forEach((l) => l.items.sort((a, b) => a.x - b.x));
  return out.sort((a, b) => b.y - a.y);
}
const lineText = (l) => l.items.map((i) => i.s).join(" ");
// Items of a table, assigned to the nearest row anchor (wrapped cells sit a
// few points above/below the anchor's baseline).
function rowsByAnchor(items, anchors, tol = 12) {
  const rows = anchors.map((a) => ({ y: a.y, items: [] }));
  items.forEach((it) => {
    let best = null, d = Infinity;
    rows.forEach((r) => { const dd = Math.abs(r.y - it.y); if (dd < d) { d = dd; best = r; } });
    if (best && d <= tol) best.items.push(it);
  });
  return rows;
}
// Columns from a header line: each label's [x-start, right edge].
const colOf = (cols, it) => {
  let best = null;
  cols.forEach((c) => { if (it.x >= c.x - 6) best = c; });
  return best;
};
const cellText = (row, cols, key) => row.items.filter((it) => colOf(cols, it)?.key === key).sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
const amountCol = (amtCols, it) => {
  let best = null, d = Infinity;
  amtCols.forEach((c) => { const dd = Math.abs(c.r - it.r); if (dd < d) { d = dd; best = c; } });
  return d <= 30 ? best : null;
};

const SUMMARY_KEYS = {
  "beginning balance": "beginning", "cash in": "cashIn", "cash out": "cashOut", "ending cash balance": "ending",
  "unpaid bills": "unpaidBills", "property reserve": "reserve", "prepayments": "prepayments",
  "net owner funds": "netOwnerFunds", "please remit balance due": "remit",
};
function summaryFrom(ls) {
  const out = {};
  ls.forEach((l) => {
    const label = l.items.filter((i) => !isNum(i.s)).map((i) => i.s).join(" ").toLowerCase().trim();
    const amt = l.items.filter((i) => isNum(i.s)).pop();
    if (SUMMARY_KEYS[label] && amt) out[SUMMARY_KEYS[label]] = num(amt.s);
  });
  return out;
}

function parseStatementPage(items, ctx) {
  const ls = lines(items);
  const hdr = ls.find((l) => l.items.length === 1 && PROP_HDR.test(l.items[0].s) && !/Properties:/.test(l.items[0].s));
  if (hdr) {
    const m = hdr.items[0].s.match(PROP_HDR);
    ctx.cur = { name: m[1].trim(), address: m[2].trim(), key: afKey(m[1]), summary: {}, transactions: [], bills: [] };
    ctx.props.push(ctx.cur);
    ctx.section = null;
  }
  const P = ctx.cur;
  if (!P) return;
  const yOf = (re) => { const l = ls.find((x) => x.items.length <= 2 && re.test(lineText(x))); return l ? l.y : null; };
  const yTx = yOf(/^Transactions$/), yBills = yOf(/^Bills Due$/);
  const ySum = yOf(/^Property Cash Summary$/);
  if (ySum != null) Object.assign(P.summary, summaryFrom(ls.filter((l) => l.y < ySum && (yTx == null || l.y > yTx))));
  // ── Transactions
  const txHead = ls.find((l) => /^Date\b/.test(lineText(l)) && /Cash In/.test(lineText(l)));
  if (txHead) ctx.txCols = txHead.items.map((i) => ({ key: i.s, x: i.x, r: i.r }));
  const txTop = txHead ? txHead.y : (yTx != null ? yTx : (!ySum && !hdr && ctx.section === "tx" ? Infinity : null));
  if (txTop != null && ctx.txCols) {
    ctx.section = "tx";
    const bottom = yBills != null ? yBills : -Infinity;
    const zone = items.filter((i) => i.y < txTop - 2 && i.y > bottom + 2);
    const dateCol = ctx.txCols.find((c) => c.key === "Date");
    const anchors = zone.filter((i) => DATE.test(i.s) && Math.abs(i.x - dateCol.x) < 12);
    const amtCols = ctx.txCols.filter((c) => /Cash In|Cash Out|Balance/.test(c.key));
    const textCols = ctx.txCols.filter((c) => !/Cash In|Cash Out|Balance/.test(c.key));
    rowsByAnchor(zone, anchors, 10).forEach((row) => {
      const t = { date: "", payee: "", type: "", ref: "", desc: "", cashIn: 0, cashOut: 0, balance: null };
      const texts = row.items.filter((i) => !(isNum(i.s) && amountCol(amtCols, i) && i.x > (textCols.find((c) => c.key === "Description")?.x || 0) + 120));
      t.date = toIso(cellText({ items: texts }, textCols, "Date"));
      t.payee = cellText({ items: texts }, textCols, "Payee / Payer");
      t.type = cellText({ items: texts }, textCols, "Type");
      t.ref = cellText({ items: texts }, textCols, "Reference");
      t.desc = cellText({ items: texts }, textCols, "Description");
      row.items.forEach((i) => {
        if (!isNum(i.s)) return;
        const c = amountCol(amtCols, i);
        if (!c || i.x < (textCols.find((x) => x.key === "Description")?.x || 0) + 120) return;
        if (c.key === "Cash In") t.cashIn = num(i.s);
        else if (c.key === "Cash Out") t.cashOut = num(i.s);
        else t.balance = num(i.s);
      });
      if (t.date) P.transactions.push(t);
    });
  }
  // ── Bills due
  const billHead = ls.find((l) => /^Due Date\b/.test(lineText(l)) && /Unpaid/.test(lineText(l)));
  if (billHead) ctx.billCols = billHead.items.map((i) => ({ key: i.s, x: i.x, r: i.r }));
  const bTop = billHead ? billHead.y : (ctx.section === "bills" && !hdr ? Infinity : null);
  if (bTop != null && ctx.billCols) {
    ctx.section = "bills";
    const zone = items.filter((i) => i.y < bTop - 2 && i.y > 40);
    const dueCol = ctx.billCols.find((c) => c.key === "Due Date");
    const anchors = zone.filter((i) => DATE.test(i.s) && Math.abs(i.x - dueCol.x) < 12);
    const textCols = ctx.billCols.filter((c) => c.key !== "Unpaid");
    rowsByAnchor(zone, anchors, 10).forEach((row) => {
      const amt = row.items.filter((i) => isNum(i.s) && i.x > (ctx.billCols.find((c) => c.key === "Unpaid")?.x || 0) - 40).pop();
      const texts = row.items.filter((i) => i !== amt);
      const b = { due: toIso(cellText({ items: texts }, textCols, "Due Date")), payee: cellText({ items: texts }, textCols, "Payee"), desc: cellText({ items: texts }, textCols, "Description"), amount: amt ? num(amt.s) : 0 };
      if (b.due) P.bills.push(b);
    });
  }
}

const STATUS = /\s+(Current|Notice(?:-Unrented|-Rented)?|Evict|Eviction|Past|Future|Vacant(?:-Unrented|-Rented)?)$/;
function parseRentRollPage(items, out) {
  const ls = lines(items);
  const head = ls.find((l) => /^Unit\b/.test(lineText(l)) && /Tenant/.test(lineText(l)));
  if (!head) return;
  const asOfL = ls.find((l) => /^As of:/.test(lineText(l)));
  const asOf = asOfL ? toIso(lineText(asOfL)) : "";
  // Two-line header: "Market / Rent", "Lease / From", "NSF / Count" — the
  // top-line words name the columns; the lone "Rent" on the main line is Rent.
  const near = items.filter((i) => Math.abs(i.y - head.y) <= 8);
  const cols = [];
  near.filter((i) => i.y >= head.y - 1).sort((a, b) => a.x - b.x).forEach((i) => {
    const key = i.s === "Market" ? "Market Rent" : i.s === "Lease" ? "Lease From" : i.s === "NSF" ? "NSF Count" : i.s === "Late" ? "Late Count" : i.s;
    if (!cols.find((c) => Math.abs(c.x - i.x) < 4)) cols.push({ key, x: Math.min(i.x, ...near.filter((n) => n.y < head.y - 1 && Math.abs((n.x + n.r) / 2 - (i.x + i.r) / 2) < 14).map((n) => n.x)), r: i.r });
  });
  cols.sort((a, b) => a.x - b.x);
  const rentCol = cols.find((c) => c.key === "Rent");
  const body = items.filter((i) => i.y < head.y - 10 && i.y > 30);
  // Property group headers ("420 Philadelphia Ave - 420 Philadelphia Ave Egg Harbor City, NJ 08215")
  const groups = body.filter((i) => PROP_HDR.test(i.s) && i.x < 60).map((i) => ({ y: i.y, name: i.s.match(PROP_HDR)[1].trim() }));
  const propLine = ls.find((l) => /^Properties:/.test(lineText(l)));
  const fallback = propLine ? (lineText(propLine).replace(/^Properties:\s*/, "").match(PROP_HDR) || [])[1] : "";
  const anchors = body.filter((i) => isNum(i.s) && rentCol && Math.abs(i.r - rentCol.r) < 6);
  rowsByAnchor(body.filter((i) => !groups.some((g) => g.y === i.y && PROP_HDR.test(i.s))), anchors, 12).forEach((row) => {
    // Numbers/dates are right-aligned (they start left of their header), so
    // they go to the column whose right edge is nearest; words go by x.
    const colFor = (it) => {
      if (/^[\d,.()\-/]+$|^--\/--$/.test(it.s)) {
        let best = null, d = Infinity;
        cols.forEach((c) => { const dd = Math.abs(c.r - it.r); if (dd < d) { d = dd; best = c; } });
        return best;
      }
      return colOf(cols, it);
    };
    const cell = (k) => row.items.filter((it) => colFor(it)?.key === k).sort((a, b) => b.y - a.y || a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim();
    const unitTxt = cell("Unit");
    if (/^Total\b|^\d+ Units?\b/.test(unitTxt)) return;
    let tenant = cell("Tenant"), status = cell("Status");
    const sm = tenant.match(STATUS);
    if (sm) { tenant = tenant.replace(STATUS, "").trim(); status = status || sm[1]; }
    // A tenant cell that ran into Status ("Tyla Bailey Current") gets split above;
    // Status cells that swallowed a tenant word go back to the tenant.
    const g = groups.filter((x) => x.y > row.y).sort((a, b) => a.y - b.y)[0];
    out.push({
      prop: (g && g.name) || fallback || "", key: afKey((g && g.name) || fallback || ""), asOf,
      unit: unitTxt, bdba: cell("BD/BA"), tenant, status,
      rent: num(cell("Rent")) || 0, marketRent: num(cell("Market Rent")), deposit: num(cell("Deposit")) || 0,
      leaseFrom: toIso(cell("Lease From").replace(/\s/g, "")), leaseTo: toIso(cell("Lease To").replace(/\s/g, "")),
      moveIn: toIso(cell("Move-in").replace(/\s/g, "")), moveOut: toIso(cell("Move-out").replace(/\s/g, "")),
      pastDue: num(cell("Past Due")) || 0, nsf: num(cell("NSF Count")) || 0, late: num(cell("Late Count")) || 0,
    });
  });
}

function parseIncomePage(items, out) {
  const ls = lines(items);
  const propL = ls.find((l) => /^Properties:/.test(lineText(l)));
  const name = propL ? ((lineText(propL).replace(/^Properties:\s*/, "").match(PROP_HDR) || [])[1] || "").trim() : "";
  const val = (re) => { const l = ls.find((x) => re.test(x.items.filter((i) => !isNum(i.s)).map((i) => i.s).join(" "))); const a = l && l.items.filter((i) => isNum(i.s)).pop(); return a ? num(a.s) : null; };
  const ti = val(/^Total Income$/), te = val(/^Total Expense$/);
  if (name && (ti != null || te != null)) out.push({ prop: name, key: afKey(name), totalIncome: ti || 0, totalExpense: te || 0, net: (ti || 0) - (te || 0) });
}

// → { from, to, createdOn, summary, props:[{name,address,key,summary,transactions,bills,units,income}] }
export async function parseAppfolioPdf(data) {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: data instanceof Uint8Array ? data : new Uint8Array(data) }).promise;
  return parseAppfolioPages(await pageItems(pdf));
}
export function parseAppfolioPages(pages) {
  const ctx = { props: [], cur: null, txCols: null, billCols: null, section: null };
  const units = [], income = [];
  let from = "", to = "", createdOn = "", summary = {};
  pages.forEach((items) => {
    const all = items.map((i) => i.s).join("\n");
    const cm = all.match(/Created on (\d{2}\/\d{2}\/\d{4})/);
    if (cm && !createdOn) createdOn = toIso(cm[1]);
    if (/^Rent Roll$/m.test(all)) { ctx.cur = null; return parseRentRollPage(items, units); }
    if (/^Income Statement/m.test(all)) { ctx.cur = null; const dm = all.match(/(\d{2}\/\d{2}\/\d{4}) to (\d{2}\/\d{2}\/\d{4})/); if (dm && !from) { from = toIso(dm[1]); to = toIso(dm[2]); } return parseIncomePage(items, income); }
    const pm = all.match(/([A-Z][a-z]{2} \d{1,2}, \d{4}) - ([A-Z][a-z]{2} \d{1,2}, \d{4})/);
    if (pm) { from = longIso(pm[1]); to = longIso(pm[2]); }
    if (/Consolidated Summary/.test(all) || (/Owner Statement/.test(all) && !/Property Cash Summary/.test(all))) {
      const ls = lines(items);
      const y = (ls.find((l) => /Consolidated Summary|Owner Statement/.test(lineText(l))) || {}).y;
      summary = summaryFrom(ls.filter((l) => y == null || l.y < y));
      return;
    }
    parseStatementPage(items, ctx);
  });
  const props = ctx.props.map((p) => ({ ...p, units: [], income: null }));
  const find = (key) => props.find((p) => p.key === key);
  units.forEach((u) => {
    let p = find(u.key);
    if (!p) { p = { name: u.prop, address: "", key: u.key, summary: {}, transactions: [], bills: [], units: [], income: null, rollOnly: true }; props.push(p); }
    p.units.push(u);
  });
  income.forEach((x) => { const p = find(x.key); if (p) p.income = x; });
  if (!props.length) throw new Error("This doesn't look like a Platinum / AppFolio owner statement.");
  return { from, to, createdOn, summary, props };
}

// ── Matching a statement property to a Rental Portfolio rental ────────────
const STREET_NOISE = new Set(["st", "street", "ave", "avenue", "rd", "road", "dr", "drive", "ln", "lane", "ct", "court", "blvd", "pl", "place", "ter", "terrace", "way", "wy", "hwy", "n", "s", "e", "w", "north", "south", "east", "west"]);
const addrParts = (s) => {
  const t = afKey(s).split(" ");
  const nums = [];
  const first = (t[0] || "").split("-");
  first.forEach((x) => { if (/^\d+[a-z]?$/.test(x)) nums.push(x); });
  // "516-518" in afKey becomes "516 518"
  let i = 0; while (i < t.length && /^\d+[a-z]?$/.test(t[i])) { nums.push(t[i]); i++; }
  const words = t.slice(i).filter((w) => !STREET_NOISE.has(w) && !/^\d+$/.test(w)); // keep "4th"
  return { nums: [...new Set(nums)], word: words[0] || "" };
};
export function matchRental(afName, rentals) {
  const a = addrParts(afName);
  if (!a.nums.length || !a.word) return null;
  return (rentals || []).find((r) => {
    const b = addrParts(r.address || "");
    return b.word === a.word && b.nums.some((n) => a.nums.includes(n));
  }) || null;
}
