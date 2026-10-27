// Server copy of the app's status-change gate (src/GoldstoneApp.jsx: STATUS_FLOW,
// GATE_FIELDS, DEFAULT_GATE_REQS, gateConfig, gateReqsFor, statusIsForward) so
// the Claude connector asks for the same checklist the status picker does.
// Copied verbatim — if the gate rules change in GoldstoneApp.jsx, re-copy here.
/* eslint-disable */
const SC_KEYS=["Under Contract","Purchased","Under Construction","On Market","In Closing","Sold","Rental","New Leads"];
const STATUS_FLOW=["New Leads","Under Contract","Purchased","Under Construction","On Market","In Closing","Sold"];
const GATE_STATUSES=["Under Contract","Purchased","Under Construction","On Market","In Closing","Sold","Rental"];

// Property fields a "field" requirement can demand. top/key say where the value
// lives on the property object so the gate can read the current value and save it.
const GATE_FIELDS={
  purchaseDate:{label:"Purchase Date",kind:"date",top:"financials",key:"purchaseDate"},
  sellingDate:{label:"Selling Date",kind:"date",top:"financials",key:"sellingDate"},
  lockboxCode:{label:"Lockbox Code",kind:"text",top:"propertyInfo",key:"lockboxCode"},
  mortgageCommitment:{label:"Mortgage Commitment Date",kind:"date",top:"propertyInfo",key:"mortgageCommitment"},
  inspectionDue:{label:"Inspection Due Date",kind:"date",top:"propertyInfo",key:"inspectionDue"},
  // Elie 10/27/26: which MLSs a listing is in (ids from 🔑 MLS accounts, or
  // ["none"]) — top-level p.mlsSources, so reverse prospecting knows where to look.
  mlsSources:{label:"Which MLSs is it listed in?",kind:"mls",top:"",key:"mlsSources"},
};
const GATE_FIELD_KEYS=Object.keys(GATE_FIELDS);
const gateFieldVal=(p,fk)=>{const s=GATE_FIELDS[fk];if(!s)return "";const v=s.top?(p?.[s.top]||{})[s.key]:p?.[s.key];return Array.isArray(v)?v.join(","):String(v||"");};

const _ck=(id,label)=>({id,type:"check",label});
const _fd=(id,field)=>({id,type:"field",field,label:GATE_FIELDS[field]?.label||field});
const _ct=(id,label)=>({id,type:"contact",label});

// Sensible starting requirements per status (admin can change these in Settings).
const DEFAULT_GATE_REQS={
  "Under Contract":[
    _fd("uc_pd","purchaseDate"),
    _ck("uc_ps","Purchase & Sale agreement signed by all parties"),
    _ck("uc_em","Earnest money deposit sent"),
    _ck("uc_pr","Purchase price & key terms confirmed"),
    _ck("uc_insp","Inspection / due-diligence period noted"),
  ],
  "Purchased":[
    _fd("pu_pd","purchaseDate"),
    _ck("pu_close","Closing completed & deed recorded"),
    _ck("pu_fund","Hard money / LOC funding confirmed & received"),
    _ck("pu_title","Title insurance / owner's policy received"),
    _ck("pu_util","Utilities & insurance transferred to us"),
  ],
  "Under Construction":[
    _ck("cn_scope","Scope of work finalized"),
    _ct("cn_gc","General contractor"),
    _ck("cn_budget","Construction budget confirmed"),
    _ck("cn_draw","Draw schedule set"),
    _ck("cn_permit","Required permits pulled"),
  ],
  "On Market":[
    _ck("om_reno","Renovation complete & final walkthrough done"),
    _ct("om_agent","Listing agent"),
    _ck("om_price","List price set"),
    _ck("om_live","Photos taken & listing is live"),
    _fd("om_mls","mlsSources"),
  ],
  "In Closing":[
    _fd("ic_sd","sellingDate"),
    _ck("ic_offer","Buyer offer accepted & contract signed"),
    _ct("ic_buyer","Buyer's agent"),
    _ck("ic_em","Buyer earnest money received"),
    _ck("ic_atty","Attorney review complete"),
  ],
  "Sold":[
    _fd("so_sd","sellingDate"),
    _ck("so_close","Sale closed & proceeds received"),
    _ck("so_hud","Final settlement statement (HUD / ALTA) received"),
    _ck("so_payoff","Hard money / LOC paid off"),
  ],
  "Rental":[
    _ck("rn_lease","Lease signed"),
    _ct("rn_tenant","Tenant"),
    _ck("rn_fin","Hold / refinance financing in place"),
  ],
};
// The effective requirement config: the admin-saved one, else the defaults.
function gateConfig(appSettings){
  const row=(appSettings||[]).find(r=>r&&r.id==="status_gates");
  const saved=row&&row.gates;
  return saved&&typeof saved==="object"?saved:DEFAULT_GATE_REQS;
}
// Requirements for a specific target status (a status with no key falls back to
// the default list; an explicit empty list means "no gate").
function gateReqsFor(appSettings,status){
  const cfg=gateConfig(appSettings);
  const r=cfg[status];
  const out=Array.isArray(r)?r:(DEFAULT_GATE_REQS[status]||[]);
  // Going On Market always asks which MLSs (Elie 10/27/26 — reverse prospecting).
  return status==="On Market"&&!out.some(x=>x&&x.field==="mlsSources")?[...out,_fd("om_mls","mlsSources")]:out;
}
// Gate only when advancing (or entering the Rental side-branch), never backward.
function statusIsForward(from,to){
  if(from===to)return false;
  if(to==="Rental")return true;
  const fi=STATUS_FLOW.indexOf(from),ti=STATUS_FLOW.indexOf(to);
  if(ti<0)return false;
  if(fi<0)return true; // coming from an off-flow status (e.g. Rental) → gate
  return ti>fi;
}

export { SC_KEYS, STATUS_FLOW, GATE_FIELDS, gateReqsFor, statusIsForward, gateFieldVal };
