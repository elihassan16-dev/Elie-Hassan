// Deploy trigger: publish latest Financial Section (reinvest register) to production.
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useData } from "./data/DataProvider";
import { useAuth } from "./auth/AuthProvider";
import { useOneDrive } from "./onedrive/useOneDrive";
import { supabase } from "./supabaseClient";
import { mkLead } from "./seed";

// Authenticated fetch to our serverless API (sends the Supabase JWT). If the token
// has gone stale (server replies 401 "Not signed in"), refresh the session once and
// retry — otherwise an idle PWA can fail even though the user is still logged in.
async function qbAuthFetch(path, opts = {}) {
  const call = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return fetch(path, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  };
  let res = await call();
  if (res.status === 401) {
    try { await supabase.auth.refreshSession(); } catch { /* fall through */ }
    res = await call();
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
  return json;
}

// Reactively tracks whether we're on a phone-width screen (sidebar -> bottom tabs).
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return isMobile;
}

const T={gold:"#B8953F",goldLight:"#F8F1E0",goldMid:"#D4A843",bg:"#F2F2F7",card:"#FFFFFF",cardAlt:"#F9F9FB",border:"rgba(0,0,0,0.08)",text:"#1C1C1E",textSub:"#8A8A8E",textTert:"#AEAEB2",blue:"#007AFF",green:"#34C759",red:"#FF3B30",orange:"#FF9500",purple:"#AF52DE",teal:"#5AC8FA",shadow:"0 1px 3px rgba(0,0,0,0.07),0 4px 16px rgba(0,0,0,0.04)",shadowMd:"0 2px 8px rgba(0,0,0,0.10),0 8px 32px rgba(0,0,0,0.06)",radius:14,radiusSm:10};

const SC={"Under Contract":{color:"#9333EA",bg:"#F3E8FF"},"Purchased":{color:"#2563EB",bg:"#DBEAFE"},"Under Construction":{color:"#EA580C",bg:"#FFEDD5"},"On Market":{color:"#16A34A",bg:"#DCFCE7"},"In Closing":{color:"#CA8A04",bg:"#FEF9C3"},"Sold":{color:"#65A30D",bg:"#ECFCCB"},"Rental":{color:"#0891B2",bg:"#CFFAFE"},"New Leads":{color:"#DB2777",bg:"#FCE7F3"}};
const DEFAULT_ORDER=["Under Contract","In Closing","Purchased","Under Construction","On Market","Rental","New Leads","Sold"];
// Fixed display order for the Properties page (New Leads lives in the Leads section).
const PROP_ORDER=["Under Contract","Purchased","Under Construction","On Market","In Closing","Sold","Rental"];

// Small localStorage-backed preference helpers (per device) for UI settings that
// should survive an app reload — e.g. the property list's status sort/filter.
const loadPref=(key,fallback)=>{try{const v=localStorage.getItem(key);return v==null?fallback:JSON.parse(v);}catch{return fallback;}};
const savePref=(key,val)=>{try{localStorage.setItem(key,JSON.stringify(val));}catch{/* ignore quota/private-mode */}};

// Compact property data: [id,address,city,zip,status, pp,bc,btx,txResp,rehab,holdCost,holdPd,fundSrc, sp,sc,stx, app,abc,arc,pDate,sDate, locL,locI,hmL,hmI,asp,asc,astx, lbCode,notes]
const PR=[
// [id,addr,city,zip,status,pp,rehab,hp,fs,sp,txResp,lb,notes,app,abc,arc,li,hi,asp]
[1,"516-518 High St N","Millville","08332","Rental",0,0,0,"","","","","",0,0,0,0,0,0],
[2,"610 Bayview Ave","Union Beach","07735","On Market",345000,40000,3,"HM Combo",550000,"Seller Pays","2320","",0,0,0,0,0,0],
[3,"609 N Indiana Ave","Atlantic City","08401","Sold",0,0,0,"",0,"","","",0,0,0,0,0,0],
[4,"4686 Thelma Ave","Mays Landing","","Under Construction",280000,100000,6,"HM Combo",530000,"Buyer Pays","","",0,0,0,0,0,0],
[5,"33 Morris Ave","Burlington","08016","In Closing",185000,80000,4,"HM Combo",359000,"Seller Pays","1948","",199000,-9685,80000,1740,11641,360000],
[6,"20 Blackwell Ln","Willingboro","","Under Construction",256000,80000,6,"HM Combo",410000,"","8672","",0,0,0,0,0,0],
[7,"1600 13th St","Trenton","08638","In Closing",170000,87000,4,"HM Combo",350000,"","1745","",170000,3207,95000,973,8145,350000],
[8,"185 W Passaic Ave","Bloomfield","","New Leads",470000,100000,6,"HM Combo",750000,"","","",0,0,0,0,0,0],
[9,"114 Hillcrest","Willingboro","","Sold",287000,0,2,"HM Combo",355000,"","0","",273700,16352,2000,990,7648,360000],
[10,"141 Vanard Dr","Brick","","On Market",0,0,0,"",0,"","","",0,0,0,0,0,0],
[11,"420 Philadelphia Ave","Egg Harbor Twp","08215","Rental",0,0,0,"",0,"","","",0,0,0,0,0,0],
[12,"1030 Hanover Blvd","Browns Mills","","Under Construction",202500,85000,6,"HM Combo",360000,"","7070","",202500,6492,90000,1660,10606,375000],
[13,"415 1st Ave","Galloway","","On Market",260000,140000,5,"HM Combo",500000,"","1745","",260000,5484,145000,2576,16318,500000],
[14,"498 Perrineville Rd","Hightstown","08520","In Closing",556000,7000,2.5,"HM Combo",735000,"Seller Pays","4889","",531000,25000,7000,2550,15715,735000],
[15,"2800 Perna Ln","Vineland","","Sold",0,79000,0,"",450000,"","","",273079,5931,79000,8483,41443,0],
[16,"7487 Githens Ave","Pennsauken","","On Market",0,0,0,"",378000,"","","",365711,0,0,24156,0,0],
[17,"415 Garden State Dr","Cherry Hill","","Under Construction",385000,110000,4,"HM Combo",600000,"","1745","",0,0,0,0,0,0],
[18,"443 Manor Rd","Millville","","Rental",0,0,0,"",0,"","","",0,0,0,0,0,0],
[19,"241 Addison Ave","Haddon Township","","Purchased",425000,110000,6,"HM Combo",680000,"","","",0,0,0,0,0,0],
[20,"456 W Lake Dr","Brick","","Under Construction",305000,110000,6,"HM Combo",520000,"Buyer Pays","1295","Dropbox: https://drive.google.com/drive/folders/1_hXXw2aywu1DLeE8-fV80matE5vKASNB",279000,31817,110000,2351,15449,550000],
[21,"114 Carnation Ct","Deptford","08096","Under Contract",342000,85000,6,"HM Combo",530000,"Buyer Pays","","Dropbox: https://drive.google.com/drive/folders/1bnu9SnURbKyXBwrlrHfQ6j9Cwuuy6nfo",0,0,0,0,0,0],
[22,"1105 Chestnut Ave","Woodbury Heights","","Under Construction",265000,110000,6,"HM Combo",500000,"","1745","",242500,26500,130000,3255,19356,500000],
[23,"39 Lejune Rd","Cinnaminson","08077","In Closing",245000,5000,9,"LOC",340000,"","","",241730,1837,4000,23934,0,320000],
[24,"9 14th St","Williamstown","","Purchased",0,120000,0,"",350000,"","","",165000,9238,120000,2082,12816,0],
[25,"6 S 4th St","","","Rental",0,0,0,"",0,"","","",0,0,0,0,0,0],
[26,"114 Oneida Lake Dr","Little Egg Harbor","08087","Under Construction",285000,40000,6,"HM Combo",425000,"Buyer Pays","2320","",0,0,0,0,0,0],
[27,"8 Lupine Dr","Titusville","","Under Construction",400000,225000,8,"HM Combo",850000,"Seller Pays","115","",0,0,0,0,0,0],
[28,"639 Fordville","","","Rental",0,0,0,"",0,"","","",0,0,0,0,0,0],
[29,"28 Messenger St","Toms River","08753","Under Contract",356000,120000,6,"HM Combo",600000,"","","",0,0,0,0,0,0],
[30,"16 Falmouth Rd","Hamilton","08620","On Market",340000,70000,4,"HM Combo",500000,"Seller Pays","2042","",340000,1531,77000,14420,0,500000],
[31,"417 Lakeview Ter","Pemberton","08068","Purchased",297500,74000,6,"HM Combo",475000,"Seller Pays","","",0,0,0,0,0,0],
[32,"116-120 Sycamore Ave","Plainfield","07060","New Leads",0,0,0,"",0,"","","",0,0,0,0,0,0],
[33,"222 Oliver Ave","Trenton","","On Market",200000,105000,4,"LOC",400000,"Seller Pays","2042","",200000,2500,125000,1921,13524,388000],
[34,"44 Bismark St","Trenton","08610","Under Construction",175000,110000,6,"LOC",375000,"Seller Pays","","",0,0,0,0,0,0],
[35,"1282 Marcella Dr","Union Twp.","07083","Purchased",440000,100000,6,"HM Combo",675000,"Seller Pays","","",0,0,0,0,0,0],
[36,"120 Moore St","Woodbury Heights","08097","Under Construction",300000,100000,3.5,"LOC",500000,"Buyer Pays","7070","",300000,6350,115000,22685,0,475000],
[37,"1055 Huntingdon Dr","Williamstown","08094","Under Construction",453000,100000,6,"HM Combo",675000,"Split","5887","",453000,6300,100000,4734,17336,650000],
[38,"11 Pleasant Valley Dr","Woodbury","08096","Under Construction",275108,65000,6,"LOC",450000,"Seller Pays","","",275108,4500,65000,26466,0,450000],
[39,"32 Oakland Ave","Newfield","","Under Contract",0,0,0,"",0,"","","",0,0,0,0,0,0],
[40,"1213 Hope St","Vineland","08361","Under Contract",0,0,0,"",0,"","","",0,0,0,0,0,0],
[41,"50 Arcadia Pl","Vineland","08360","Under Contract",0,0,0,"",0,"","","",0,0,0,0,0,0],
[42,"12 Indian King Dr","Cherry Hill","08003","On Market",535000,15000,4,"HM Combo",660000,"Buyer Pays","5887","Dropbox: https://www.dropbox.com/scl/fo/fyind06xh8os0x950fqea",535000,9500,5600,1841,13202,620000],
[43,"1155 Ringwood Ave","Pompton Lakes","","Purchased",325000,140000,9,"HM Combo",630000,"Buyer Pays","5887","",0,0,0,0,0,0],
[44,"40 Parson Ln","Willingboro","08046","Under Contract",264450,80000,6,"HM Combo",440000,"Seller Pays","","",0,0,0,0,0,0],
[45,"579 Coral Ln","Manahawkin","","Under Contract",427000,15000,4,"HM Combo",550000,"Seller Pays","","",0,0,0,0,0,0],
[46,"24A Dewey Dr","New Brunswick","08901","Under Construction",625000,100000,4,"HM Combo",850000,"Buyer Pays","","Dropbox: https://www.dropbox.com/scl/fo/03bikkm31ufv9c63bx1hr",0,0,0,0,0,0],
[47,"211 Clover St","Roselle","07203","Under Contract",385000,80000,5,"HM Combo",600000,"Buyer Pays","","Dropbox: https://www.dropbox.com/scl/fo/yqujngo01qb7d3jd6mtpb",0,0,0,0,0,0],
[48,"8 Atlanta Dr","Jackson","08527","Under Contract",540000,110000,6,"HM Combo",825000,"Buyer Pays","","",0,0,0,0,0,0],
[49,"13 Winding Way","Trenton","08620","Under Contract",350000,60000,6,"HM Combo",520000,"","","",0,0,0,0,0,0],
[50,"21 Merion Pl","Lawrence Township","08648","New Leads",575000,120000,6,"HM Combo",900000,"Seller Pays","","",0,0,0,0,0,0],
];

function parseProps(raw){
  return raw.map(r=>{
    const[id,address,city,zip,status,pp,rehab,hp,fs,sp,txResp,lbCode,notes,app,abc,arc,li,hi,asp]=r;
    const purchasePrice=String(pp||"");
    const salePrice=String(sp||"");
    const holdPeriod=String(hp||"");
    const transferTaxResp=txResp||"Seller Pays";
    const buyingCostItems=[
      {id:1,title:"Title Cost",   autoType:"title",auto:true, resp:"Buyer Pays"},
      {id:2,title:"Transfer Tax", autoType:"tax",  auto:true, resp:transferTaxResp},
      {id:3,title:"Miscellaneous",autoType:null,   auto:false,resp:"Buyer Pays",amount:"1000"},
    ];
    const sellingCostItems=[
      {id:1,title:"Commission",   autoType:"commission",auto:true, resp:"Seller Pays",commissionPct:"2"},
      {id:2,title:"Transfer Tax", autoType:"tax",       auto:true, resp:"Seller Pays"},
      {id:3,title:"Miscellaneous",autoType:null,        auto:false,resp:"Seller Pays",amount:"2000"},
    ];
    const holdingCostItems=[
      {id:1,title:"Property Taxes",amount:"",   perYear:true, auto:false},
      {id:2,title:"Insurance",     amount:"",   perYear:true, auto:false},
      {id:3,title:"Utilities",     amount:"150",perMonth:true,auto:true},
      {id:4,title:"Miscellaneous", amount:"200",perMonth:true,auto:false},
    ];
    return{id,address,city,state:"NJ",zip,status,
      financials:{
        purchasePrice,rehabCosts:String(rehab||""),holdPeriod,fundingSource:fs,salePrice,
        transferTaxResp,
        buyingCosts:"",buyingTransferTax:"",sellingCosts:"",sellingTransferTax:"",annualHoldingCosts:"",
        actualPurchasePrice:String(app||""),actualBuyingCosts:String(abc||""),actualRehabCosts:String(arc||""),
        purchaseDate:"",sellingDate:"",
        locLoan:"",locInterest:String(li||""),hmLoan:"",hmInterest:String(hi||""),
        actualSalePrice:String(asp||""),actualSellingCosts:"",actualSellingTransferTax:"",
        buyingCostItems,sellingCostItems,holdingCostItems,
      },
      propertyInfo:{type:"",beds:"",baths:"",sqft:"",yearBuilt:"",lot:"",parcel:"",lockboxCode:String(lbCode||""),lockboxLocation:"",notes:String(notes||"")},
      tasks:[],contacts:[]};
  });
}
const INIT_PROPS = parseProps(PR);

// CONTACTS now comes from Supabase. Each component that needs it reads the live
// list via `const { contacts: CONTACTS } = useData();`.

// ─── Default task checklists per deal stage ───────────────────────────────────
const DEFAULT_CHECKLISTS={
  "Under Contract":[
    {cat:"Due Diligence",tasks:[
      {text:"Order title search",        contact:"Title Company"},
      {text:"Schedule inspection",        contact:"Inspector", multi:true},
      {text:"Review inspection report"},
      {text:"Negotiate repairs / credits"},
      {text:"Confirm clear title",        linkedContact:"Title Company"},
    ]},
    {cat:"Financing",tasks:[
      "Submit HM loan application",
      "Provide gap funding docs to lender",
      {text:"Wire earnest money deposit",  linkedContact:"Title Company"},
      "Confirm loan commitment",
    ]},
    {cat:"Closing Prep",tasks:[
      {text:"Obtain homeowner's insurance", contact:"Insurance Agent"},
      {text:"Confirm closing date & location", linkedContact:"Title Company"},
    ]},
  ],
  "Purchased":[
    {cat:"Property Setup",tasks:["Change locks","Set up utilities in company name","Install lockbox","Document existing condition (photos)"]},
    {cat:"Contractor",tasks:["Finalize scope of work","Get 3 contractor bids","Execute contractor contract","Set draw schedule"]},
    {cat:"Permits",tasks:["Submit permit applications","Confirm permits approved","Post permits on property"]},
  ],
  "Under Construction":[
    {cat:"Demo & Rough",tasks:["Demo complete","Framing complete","Rough plumbing rough-in","Rough electrical rough-in","HVAC rough-in","Insulation complete","Drywall hung"]},
    {cat:"Finishes",tasks:["Drywall finished & painted","Flooring installed","Kitchen cabinets installed","Countertops installed","Tile complete (bath/kitchen)","Fixtures installed","Doors & trim complete"]},
    {cat:"Final",tasks:["Final plumbing complete","Final electrical complete","HVAC final complete","Final punch list walk","Final inspection passed","Deep clean complete","Staging/photos complete"]},
    {cat:"Inspections",tasks:["Rough inspection passed","Framing inspection passed","Final inspection passed","Certificate of Occupancy obtained"]},
  ],
  "On Market":[
    {cat:"Listing",tasks:["Photos uploaded to MLS","Listing live on Zillow/Realtor","For sale sign installed","Lockbox active","Open house scheduled"]},
    {cat:"Offers",tasks:["Reviewed all offers","Accepted offer executed","Buyer proof of funds received","Attorney review period complete"]},
    {cat:"Under Contract",tasks:["Inspection scheduled","Inspection negotiation complete","Buyer loan commitment received","Clear to close confirmed"]},
  ],
  "In Closing":[
    {cat:"Closing Prep",tasks:["Final walkthrough scheduled","Settlement statement reviewed","Wire instructions confirmed","All liens/judgments cleared","Confirm closing time & location"]},
    {cat:"Post-Close",tasks:["Confirm funds received","Cancel utilities","Remove lockbox & signs","Update property status to Sold","File closing docs","Calculate final profit/loss"]},
  ],
};

// Every task name the old auto-checklist feature could have created. Used once, on
// load, to clean up leftover checklist tasks that an earlier app version saved onto
// properties (the feature itself is long gone).
const CHECKLIST_TEXTS=new Set(
  Object.values(DEFAULT_CHECKLISTS).flatMap(groups=>
    groups.flatMap(g=>(g.tasks||[]).map(t=>(typeof t==="string"?t:t.text)))
  ).filter(Boolean).map(s=>s.trim().toLowerCase())
);
// A leftover auto-checklist task = matches a known checklist name AND was never touched
// (no assignee/delegate, no messages, no linked contact, not automation-created).
const isLeftoverChecklistTask=(t)=>
  CHECKLIST_TEXTS.has((t.text||"").trim().toLowerCase())
  && !t.autoId && !t.assignee && !t.delegate && !t.taskContact
  && !(t.messages&&t.messages.length);

const TASK_STATUSES=["Not Started","In Progress","Completed","N/A"];
const TASK_STATUS_COLORS={"Not Started":{bg:"#F2F2F7",color:"#8A8A8E"},"In Progress":{bg:"#FFF4E5",color:"#FF9500"},"Completed":{bg:"#EDFBF1",color:"#34C759"},"N/A":{bg:"#F2F2F7",color:"#AEAEB2"}};


// ─── Helpers ──────────────────────────────────────────────────────────────────
function n(v){const x=parseFloat(String(v).replace(/,/g,""));return isNaN(x)?0:x;}
function pct(v){const x=parseFloat(String(v));return isNaN(x)?0:x/100;}
// Currency: show cents only when the value actually has them (so $1,225.81 keeps
// its cents, but $740,000 stays clean). Negatives read as -$X.
function fmtD(v){const x=v||0,neg=x<0,a=Math.abs(x),r2=Math.round(a*100),cents=r2%100!==0;return (neg?"-$":"$")+(r2/100).toLocaleString(undefined,{minimumFractionDigits:cents?2:0,maximumFractionDigits:2});}
// A value counts as "entered" when it isn't blank — so 0 and negatives (credits) still
// display, and only a truly empty field shows the "tap to enter" placeholder.
const hasVal=(v)=>v!==null&&v!==undefined&&String(v).trim()!=="";
// Sanitize a currency input while allowing a single leading minus (credits/refunds).
const numIn=(v)=>String(v).replace(/[^\d.-]/g,"").replace(/(?!^)-/g,"");

function calcP(f){
  const hold=(n(f.annualHoldingCosts)/12)*n(f.holdPeriod);
  const total=n(f.purchasePrice)+n(f.buyingCosts)+n(f.buyingTransferTax)+n(f.rehabCosts)+hold;
  const rev=n(f.salePrice);
  return{total,hold,net:rev-total-(rev*pct(f.sellingCosts))-n(f.sellingTransferTax)};
}
function calcA(f){
  const total=n(f.actualPurchasePrice)+n(f.actualBuyingCosts)+n(f.actualRehabCosts);
  const interest=n(f.locInterest)+n(f.hmInterest);
  const rev=n(f.actualSalePrice);
  return{total,interest,net:rev-total-interest-(rev*pct(f.actualSellingCosts))-n(f.actualSellingTransferTax)};
}

// ─── SINGLE SOURCE OF TRUTH for a property's profit ───────────────────────────
// Used by BOTH the Financial Overview banner and the Portfolio Overview so the
// two can never disagree. Mirrors the Financial Overview formulas exactly.
// If you change a profit rule, change it HERE only.
function finProfit(f){
  if(!f) return {netProfit:0,acNet:0,effective:0,useActual:false};
  const buyingItems=f.buyingCostItems||[];
  const buyingTotal=buyingItems.length>0?calcBuyingTotal(buyingItems,f.purchasePrice):n(f.buyingCosts)||0;
  const sellingItems=f.sellingCostItems||[];
  const holdingItems=f.holdingCostItems||[];
  const months=n(f.holdPeriod)||0;
  const sellingOf=(sp,items,flat)=>items.length>0
    ?items.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>{
        if(i.autoType==="commission")return s+Math.round(n(sp)*(parseFloat(i.commissionPct||0)/100));
        if(i.autoType==="tax"){const rtf=calcNJRTF(n(sp));return i.resp==="Seller Pays"?s+rtf.total:i.resp==="Split"?s+Math.round(rtf.total/2):s;}
        return s+n(i.amount);
      },0)
    :n(flat)||0;

  // ── Projected ──
  const sellingTotal=sellingOf(f.salePrice,sellingItems,f.sellingCosts);
  const holdingTotal=holdingItems.length>0?holdingItems.reduce((s,i)=>s+(i.perYear?n(i.amount)/12:n(i.amount))*months,0):n(f.annualHoldingCosts)||0;
  const totalCosts=n(f.purchasePrice)+buyingTotal+n(f.rehabCosts)+holdingTotal;
  const liveHmLoan=Math.round(n(f.purchasePrice)*(n(f.hmLoanPct||90)/100));
  const liveHmMonthly=Math.round(liveHmLoan*(n(f.hmRate||9)/100)/12);
  const liveHmReserve=Math.round(liveHmMonthly*months);
  const liveRehabLoan=Math.round(n(f.rehabCosts)*(n(f.rehabFinPct||100)/100));
  const liveHmTotal=liveHmLoan+liveRehabLoan;
  const liveHmOrigFee=Math.round(liveHmTotal*(n(f.hmOrigPct||0)/100));
  const liveHmDoc=n(f.hmDocFee||1000);
  const liveGapPrinc=Math.round(n(f.purchasePrice)*(1-n(f.hmLoanPct||90)/100))+Math.round(n(f.rehabCosts)*(1-n(f.rehabFinPct||100)/100))+buyingTotal+liveHmReserve+liveHmOrigFee+liveHmDoc;
  const liveGapBalloon=Math.round(liveGapPrinc*(n(f.gapRate||15)/100)/12*months);
  const debtService=(n(f.hmInterest)||liveHmReserve)+(n(f.locInterest)||liveGapBalloon);
  const netProfit=n(f.salePrice)-sellingTotal-debtService-totalCosts;

  // ── Actual ──
  const actualHoldMonths=f.purchaseDate&&f.sellingDate?parseFloat(((new Date(f.sellingDate)-new Date(f.purchaseDate))/(1000*60*60*24*30.44)).toFixed(1)):months;
  const acCosts=n(f.actualPurchasePrice)+n(f.actualBuyingCosts)+n(f.actualRehabCosts)+n(f.actualHoldingCosts);
  const acSalePrice=n(f.actualSalePrice);
  const acSelling=sellingOf(acSalePrice,f.actualSellingCostItems||[],f.actualSellingCosts);
  const acHmLoanAmt=n(f.acHmLoanAmt)||liveHmTotal;
  const acHmRate=f.acHmRate!==undefined?n(f.acHmRate):n(f.hmRate||9);
  const acHmOrigPct=f.acHmOrigPct!==undefined?n(f.acHmOrigPct):n(f.hmOrigPct||0);
  const acHmDocAmt=f.acHmDocFee!==undefined?n(f.acHmDocFee):n(f.hmDocFee||1000);
  const equityRequired=n(f.locLoan)||liveGapPrinc;
  const acGapLoanAmt=n(f.acGapLoanAmt)||equityRequired;
  const acGapRate=f.acGapRate!==undefined?n(f.acGapRate):n(f.gapRate||15);
  const acHmMonthlyInt=Math.round(acHmLoanAmt*(acHmRate/100)/12);
  const acHmInterest=f.acHmInterestOverride!==undefined&&f.acHmInterestOverride!==""?n(f.acHmInterestOverride):Math.round(acHmMonthlyInt*actualHoldMonths)+Math.round(acHmLoanAmt*(acHmOrigPct/100))+acHmDocAmt;
  const acGapBalloon=f.acGapInterestOverride!==undefined&&f.acGapInterestOverride!==""?n(f.acGapInterestOverride):Math.round(acGapLoanAmt*(acGapRate/100)/12*actualHoldMonths);
  const acNet=acSalePrice>0?acSalePrice-acSelling-(acHmInterest+acGapBalloon)-acCosts:0;

  const useActual=!!(f.useActualProfit&&acSalePrice>0);
  return {netProfit,acNet,effective:useActual?acNet:netProfit,useActual};
}

// ─── NJ Realty Transfer Tax ───────────────────────────────────────────────────
function calcNJRTF(price){
  const p=Math.ceil(price/500)*500;
  let rtf=0;
  if(p<=150000) rtf=(p/500)*2.00;
  else if(p<=200000) rtf=600+(((p-150000)/500)*3.35);
  else if(p<=350000) rtf=600+335+(((p-200000)/500)*3.90);
  else rtf=600+335+1170+(((p-350000)/500)*6.05);
  let gpf=0;
  if(price>3500000) gpf=price*0.035;
  else if(price>3000000) gpf=price*0.030;
  else if(price>2500000) gpf=price*0.025;
  else if(price>2000000) gpf=price*0.020;
  else if(price>1000000) gpf=price*0.010;
  return{rtf:Math.round(rtf),gpf:Math.round(gpf),total:Math.round(rtf+gpf)};
}

// ─── NJ Title Insurance Formula (NJDBI regulated rates) ──────────────────────
function calcNJTitle(price){
  const p=price||0;
  let premium=0;
  if(p<=100000) premium=(p/1000)*5.25;
  else if(p<=500000) premium=525+((p-100000)/1000)*4.25;
  else if(p<=2000000) premium=2225+((p-500000)/1000)*2.75;
  else premium=6350+((p-2000000)/1000)*2.00;
  premium=Math.max(200,Math.round(premium));
  const searchAndExam=100;
  return{premium,searchAndExam,total:premium+searchAndExam};
}

const Ico=({p,p2,c,r,lines=[]})=>(
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {p&&<path d={p}/>}{p2&&<path d={p2}/>}
    {c&&<circle cx={c[0]} cy={c[1]} r={c[2]}/>}
    {r&&<rect x={r[0]} y={r[1]} width={r[2]} height={r[3]} rx={r[4]||0}/>}
    {lines.map((l,i)=><line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]}/>)}
  </svg>
);
const ICONS={
  tasks:<Ico p="M9 11l3 3L22 4" p2="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>,
  portfolio:<Ico p="M18 20V10" p2="M12 20V4" lines={[[6,20,6,14]]}/>,
  leads:<Ico c={[11,11,8]} lines={[[21,21,16.65,16.65],[11,8,11,14],[8,11,14,11]]}/>,
  properties:<Ico p="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" p2="M9 22v-10h6v10"/>,
  calendar:<Ico r={[3,4,18,18,2]} lines={[[16,2,16,6],[8,2,8,6],[3,10,21,10]]}/>,
  contacts:<Ico p="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" p2="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" c={[9,7,4]}/>,
  messages:<Ico p="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>,
  showings:<Ico p="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" c={[12,12,3]}/>,
  share:<Ico p="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" p2="M16 6l-4-4-4 4" lines={[[12,2,12,15]]}/>,
  sort:<Ico lines={[[3,6,21,6],[3,12,15,12],[3,18,9,18]]}/>,
  financials:<Ico p="M12 1v22" p2="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>,
};
const NAV=[
  {key:"tasks",label:"Tasks",short:"Tasks",icon:ICONS.tasks},
  {key:"messages",label:"Messages",short:"Messages",icon:ICONS.messages},
  {key:"portfolio",label:"Portfolio Overview",short:"Portfolio",icon:ICONS.portfolio},
  {key:"leads",label:"New Leads",short:"Leads",icon:ICONS.leads},
  {key:"properties",label:"Properties",short:"Properties",icon:ICONS.properties},
  {key:"calendar",label:"Calendar",short:"Calendar",icon:ICONS.calendar},
  {key:"showings",label:"Showings",short:"Showings",icon:ICONS.showings},
  {key:"contacts",label:"Contacts",short:"Contacts",icon:ICONS.contacts},
  {key:"financials",label:"Financial Section",short:"Financials",icon:ICONS.financials},
];
// Sections only the admin (Elie) can see. Everyone else never gets these nav items.
const ADMIN_ONLY_KEYS=new Set(["financials"]);

// ─── UI Primitives ────────────────────────────────────────────────────────────
function Card({children,style={}}){return <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",...style}}>{children}</div>;}

// ─── StatusPicker — iOS-style pill that opens a colored dropdown list ────────
function StatusPicker({value,onChange,size="md"}){
  const[open,setOpen]=useState(false);
  const sc=SC[value]||{color:T.gold,bg:T.goldLight};
  const pillFs=size==="sm"?11:13;
  const pillPad=size==="sm"?"3px 10px":"6px 14px";
  return(
    <div style={{position:"relative",display:"inline-block"}}>
      <span onClick={()=>setOpen(o=>!o)}
        style={{background:sc.bg,color:sc.color,fontSize:pillFs,fontWeight:700,padding:pillPad,borderRadius:20,whiteSpace:"nowrap",cursor:"pointer",display:"inline-block",userSelect:"none"}}>
        {value}
      </span>
      {open&&<>
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:99}}/>
        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,background:"#fff",borderRadius:14,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",padding:6,zIndex:100,minWidth:150,display:"flex",flexDirection:"column",gap:3}}>
          {Object.keys(SC).map(s=>{
            const ssc=SC[s];
            const selected=s===value;
            return(
              <div key={s} onClick={()=>{onChange(s);setOpen(false);}}
                style={{background:selected?ssc.bg:"transparent",color:ssc.color,fontSize:13,fontWeight:600,padding:"7px 12px",borderRadius:9,cursor:"pointer",transition:"background 0.1s"}}
                onMouseEnter={e=>{if(!selected)e.currentTarget.style.background=ssc.bg;}}
                onMouseLeave={e=>{if(!selected)e.currentTarget.style.background="transparent";}}>
                {s}
              </div>
            );
          })}
        </div>
      </>}
    </div>
  );
}

function GHeader({label,color=T.gold}){
  return <div style={{padding:"13px 16px 7px",display:"flex",alignItems:"center",gap:8}}>
    <span style={{width:3,height:13,borderRadius:2,background:color,display:"inline-block"}}/>
    <span style={{fontSize:11,fontWeight:700,color:T.textSub,letterSpacing:"0.06em",textTransform:"uppercase"}}>{label}</span>
  </div>;
}
function ERow({label,value,editable,onChange,isTotal,suffix=""}){
  const[editing,setEditing]=useState(false);
  const[local,setLocal]=useState(value);
  const commit=()=>{setEditing(false);onChange&&onChange(local);};
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:isTotal?"13px 16px":"11px 16px",background:isTotal?T.goldLight:"transparent",borderTop:`1px solid ${T.border}`}}>
      <span style={{fontSize:14,color:isTotal?T.gold:T.text,fontWeight:isTotal?600:400}}>{label}</span>
      <div>
        {isTotal?<span style={{fontSize:14,fontWeight:700,color:T.gold}}>{value}</span>
        :editable?(editing?
          <input autoFocus value={local} onChange={e=>setLocal(e.target.value)} onBlur={commit} onKeyDown={e=>e.key==="Enter"&&commit()}
            style={{background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:6,padding:"2px 8px",fontSize:14,color:T.text,outline:"none",textAlign:"right",width:120,fontFamily:"inherit"}}/>
          :<span onClick={()=>{setLocal(value);setEditing(true);}} style={{fontSize:14,color:T.blue,cursor:"pointer"}}>{value}{suffix}</span>)
        :<span style={{fontSize:14,color:T.textSub}}>{value}{suffix}</span>}
      </div>
    </div>
  );
}
function NetBanner({value,label="Net Profit"}){
  const pos=value>=0;
  return <div style={{borderRadius:T.radiusSm,padding:"16px 20px",background:pos?"#EDFBF1":"#FFF0EF",border:`1.5px solid ${pos?T.green:T.red}`,display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12}}>
    <span style={{fontSize:15,fontWeight:700,color:pos?T.green:T.red}}>{label}</span>
    <span style={{fontSize:22,fontWeight:800,color:pos?T.green:T.red}}>{fmtD(value)}</span>
  </div>;
}
function FSec({title,color,children}){
  const cm={gold:T.gold,blue:T.blue,green:T.green,red:T.red,purple:T.purple,teal:T.teal};
  return <Card style={{marginBottom:12}}><GHeader label={title} color={cm[color]||T.gold}/>{children}</Card>;
}

// ─── Editable Amount — shows formatted $, click to edit ───────────────────────
function EditableAmount({value, onChange}){
  const[editing,setEditing]=useState(false);
  const[local,setLocal]=useState(value);
  const commit=()=>{setEditing(false);onChange(local);};
  if(editing) return(
    <input autoFocus value={local}
      onChange={e=>setLocal(e.target.value.replace(/[^\d.]/g,""))}
      onBlur={commit} onKeyDown={e=>e.key==="Enter"&&commit()}
      style={{width:"100%",padding:"6px 10px",borderRadius:8,border:`1.5px solid ${T.gold}`,background:T.goldLight,color:T.text,fontSize:15,fontWeight:600,textAlign:"right",outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
  );
  return(
    <span onClick={()=>{setLocal(value);setEditing(true);}}
      style={{fontSize:15,fontWeight:700,color:T.text,cursor:"pointer",borderBottom:`1px dashed ${T.border}`,paddingBottom:1}}>
      {n(value)>0?fmtD(n(value)):"$0"}
    </span>
  );
}

// ─── Shared buying cost calculator (used by popup AND overview) ───────────────
function calcBuyingTotal(items, purchasePrice){
  if(!items||items.length===0) return 0;
  const rtf = calcNJRTF(n(purchasePrice));
  const title = calcNJTitle(n(purchasePrice));
  return items.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>{
    if(i.autoType==="tax"){
      if(i.resp==="Buyer Pays") return s+rtf.total;
      if(i.resp==="Split") return s+Math.round(rtf.total/2);
      return s;
    }
    if(i.autoType==="title") return s+title.total;
    return s+n(i.amount);
  },0);
}

// ─── Buying Costs Popup ───────────────────────────────────────────────────────
function BuyingCostsPopup({items, purchasePrice, currentResp, onChange, onClose}){
  const calc = calcNJRTF(n(purchasePrice));
  const titleCalc = calcNJTitle(n(purchasePrice));

  const RESP_OPTIONS_AUTO = ["Buyer Pays","Seller Pays","Split","N/A","Maybe"];
  const RESP_OPTIONS_CUSTOM = ["Buyer Pays","Seller Pays"];

  function getAmt(item, resp){
    if(item.autoType==="tax"){
      if(resp==="Buyer Pays") return calc.total;
      if(resp==="Split") return Math.round(calc.total/2);
      return 0;
    }
    if(item.autoType==="title") return titleCalc.total;
    return n(item.amount);
  }

  const seed = (items && items.length > 0) ? items : [
    {id:1, title:"Title Cost",      autoType:"title", auto:true,  resp:"Buyer Pays"},
    {id:2, title:"Transfer Tax",    autoType:"tax",   auto:true,  resp:currentResp||"Seller Pays"},
    {id:3, title:"Miscellaneous",   autoType:null,    auto:false, resp:"Buyer Pays", amount:"1000"},
  ];
  const[loc,setLoc]=useState(seed);
  const up=(id,k,v)=>setLoc(prev=>prev.map(it=>it.id===id?{...it,[k]:v}:it));
  const addItem=()=>setLoc(prev=>[...prev,{id:Date.now(),title:"",autoType:null,auto:false,resp:"Buyer Pays",amount:""}]);
  const delItem=(id)=>setLoc(prev=>prev.filter(it=>it.id!==id));

  const displayItems=loc.map(it=>({...it,computedAmt:getAmt(it,it.resp)}));
  const total=calcBuyingTotal(loc, purchasePrice);

  const iS={padding:"9px 12px",borderRadius:8,background:"#fff",border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",width:"100%"};
  const selS={...iS,cursor:"pointer",appearance:"auto"};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
      <div style={{background:T.bg,borderRadius:22,width:"min(680px,94vw)",maxHeight:"90vh",boxShadow:T.shadowMd,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* Header */}
        <div style={{padding:"22px 28px 16px",background:T.card,borderBottom:`1px solid ${T.border}`,flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontWeight:700,fontSize:20,color:T.text}}>Buying Costs</div>
            <div style={{fontSize:14,color:T.textSub,marginTop:3}}>Purchase price: <strong style={{color:T.text}}>{fmtD(n(purchasePrice))}</strong></div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:24,color:T.textTert,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
        </div>

        {/* Table */}
        <div style={{flex:1,overflowY:"auto",padding:"20px 28px"}}>

          {/* Column headers */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 130px 150px 36px",gap:10,marginBottom:10,padding:"0 4px"}}>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em"}}>Description</div>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Amount</div>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em"}}>Who Pays</div>
            <div/>
          </div>

          {/* Rows */}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {displayItems.map(item=>{
              const isNA = item.resp==="N/A" || item.resp==="Maybe";
              return(
                <div key={item.id} style={{display:"grid",gridTemplateColumns:"1fr 130px 150px 36px",gap:10,alignItems:"center",padding:"12px 14px",background:T.card,borderRadius:T.radiusSm,boxShadow:T.shadow,opacity:isNA?0.5:1}}>
                  {/* Description */}
                  {item.auto
                    ? <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:14,fontWeight:600,color:T.gold}}>{item.title}</span>
                        <span style={{fontSize:11,background:T.goldLight,color:T.gold,padding:"2px 7px",borderRadius:20,fontWeight:600}}>auto</span>
                      </div>
                    : <input value={item.title} onChange={e=>up(item.id,"title",e.target.value)} placeholder="Description" style={iS}/>
                  }
                  {/* Amount */}
                  <div style={{textAlign:"right"}}>
                    {item.auto || isNA
                      ? <span style={{fontSize:15,fontWeight:700,color:isNA?T.textTert:T.gold}}>{isNA?"—":fmtD(item.computedAmt)}</span>
                      : <EditableAmount value={item.amount} onChange={v=>up(item.id,"amount",v)}/>
                    }
                  </div>
                  {/* Who Pays dropdown */}
                  <select value={item.resp} onChange={e=>up(item.id,"resp",e.target.value)} style={selS}>
                    {(item.auto ? RESP_OPTIONS_AUTO : RESP_OPTIONS_CUSTOM).map(o=><option key={o}>{o}</option>)}
                  </select>
                  {/* Delete */}
                  {item.auto
                    ? <div style={{textAlign:"center",fontSize:12,color:T.textTert}}>🔒</div>
                    : <button onClick={()=>delItem(item.id)} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:20,lineHeight:1,textAlign:"center"}}>×</button>
                  }
                </div>
              );
            })}
          </div>

          <button onClick={addItem} style={{marginTop:12,width:"100%",padding:"13px",borderRadius:T.radiusSm,background:"transparent",border:`2px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontSize:14,fontFamily:"inherit",fontWeight:500}}>
            + Add Line Item
          </button>
        </div>

        {/* Footer */}
        <div style={{background:T.card,borderTop:`1px solid ${T.border}`,padding:"18px 28px",flexShrink:0}}>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
            {displayItems.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe"&&i.computedAmt>0).map(item=>(
              <div key={item.id} style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:14,color:T.textSub}}>{item.title||"(unnamed)"} <span style={{fontSize:12,color:T.textTert}}>· {item.resp}</span></span>
                <span style={{fontSize:14,fontWeight:600,color:item.auto?T.gold:T.text}}>{fmtD(item.computedAmt)}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:`2px solid ${T.gold}`,paddingTop:12,marginTop:4}}>
              <span style={{fontSize:16,fontWeight:700,color:T.text}}>Total Buying Costs</span>
              <span style={{fontSize:20,fontWeight:800,color:T.gold}}>{fmtD(total)}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
            <button onClick={onClose} style={{padding:"12px 24px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:15}}>Cancel</button>
            <button onClick={()=>{
              const resp=loc.find(i=>i.autoType==="tax")?.resp||"Seller Pays";
              const taxAmt=displayItems.find(i=>i.autoType==="tax")?.computedAmt||0;
              onChange(displayItems,total,resp,taxAmt);
              onClose();
            }} style={{padding:"12px 28px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:15,boxShadow:`0 2px 10px ${T.gold}55`}}>
              Save — {fmtD(total)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Selling Costs Popup ──────────────────────────────────────────────────────
function SellingCostsPopup({items, salePrice, currentResp, onChange, onClose, blank}){
  const calc = calcNJRTF(n(salePrice));
  const RESP_AUTO   = ["Buyer Pays","Seller Pays","Split","N/A","Maybe"];
  const RESP_CUSTOM = ["Buyer Pays","Seller Pays"];

  function getAmt(item){
    if(item.autoType==="tax"){
      if(item.resp==="Seller Pays") return calc.total;
      if(item.resp==="Split") return Math.round(calc.total/2);
      return 0;
    }
    if(item.autoType==="commission"){
      const pct=parseFloat(item.commissionPct)||0;
      return Math.round(n(salePrice)*(pct/100));
    }
    return n(item.amount);
  }

  const seed = (items && items.length > 0) ? items : (blank ? [] : [
    {id:1, title:"Commission",    autoType:"commission", auto:true,  resp:"Seller Pays", commissionPct:"2"},
    {id:2, title:"Transfer Tax",  autoType:"tax",        auto:true,  resp:"Seller Pays"},
    {id:3, title:"Miscellaneous", autoType:null,         auto:false, resp:"Seller Pays", amount:"2000"},
  ]);
  const[loc,setLoc]=useState(seed);
  const up=(id,k,v)=>setLoc(prev=>prev.map(it=>it.id===id?{...it,[k]:v}:it));
  const addItem=()=>setLoc(prev=>[...prev,{id:Date.now(),title:"",autoType:null,auto:false,resp:"Seller Pays",amount:""}]);
  const delItem=(id)=>setLoc(prev=>prev.filter(it=>it.id!==id));
  const displayItems=loc.map(it=>({...it,computedAmt:getAmt(it)}));
  const total=displayItems.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>s+i.computedAmt,0);
  const iS={padding:"9px 12px",borderRadius:8,background:"#fff",border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",width:"100%"};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
      <div style={{background:T.bg,borderRadius:22,width:"min(680px,94vw)",maxHeight:"90vh",boxShadow:T.shadowMd,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"22px 28px 16px",background:T.card,borderBottom:`1px solid ${T.border}`,flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontWeight:700,fontSize:20,color:T.text}}>Selling Costs</div>
            <div style={{fontSize:14,color:T.textSub,marginTop:3}}>Sale price: <strong style={{color:T.text}}>{fmtD(n(salePrice))}</strong></div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:24,color:T.textTert,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"20px 28px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 130px 150px 36px",gap:10,marginBottom:10,padding:"0 4px"}}>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em"}}>Description</div>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Amount</div>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em"}}>Who Pays</div>
            <div/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {displayItems.map(item=>{
              const isNA=item.resp==="N/A"||item.resp==="Maybe";
              return(
                <div key={item.id} style={{display:"grid",gridTemplateColumns:"1fr 130px 150px 36px",gap:10,alignItems:"center",padding:"12px 14px",background:T.card,borderRadius:T.radiusSm,boxShadow:T.shadow,opacity:isNA?0.45:1}}>
                  {/* Description + optional % input for commission */}
                  {item.auto
                    ? <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontSize:14,fontWeight:600,color:T.gold}}>{item.title}</span>
                        {item.autoType==="commission"&&(
                          <div style={{display:"flex",alignItems:"center",gap:4}}>
                            <input value={item.commissionPct} onChange={e=>up(item.id,"commissionPct",e.target.value.replace(/[^\d.]/g,""))}
                              style={{width:44,padding:"3px 6px",borderRadius:6,border:`1px solid ${T.border}`,fontSize:13,textAlign:"right",outline:"none",fontFamily:"inherit",background:"#fff"}}/>
                            <span style={{fontSize:13,color:T.textSub}}>%</span>
                          </div>
                        )}
                        <span style={{fontSize:11,background:T.goldLight,color:T.gold,padding:"2px 7px",borderRadius:20,fontWeight:600}}>auto</span>
                      </div>
                    : <input value={item.title} onChange={e=>up(item.id,"title",e.target.value)} placeholder="Description" style={iS}/>
                  }
                  {/* Amount */}
                  <div style={{textAlign:"right"}}>
                    {item.auto||isNA
                      ? <span style={{fontSize:15,fontWeight:700,color:isNA?T.textTert:T.gold}}>{isNA?"—":fmtD(item.computedAmt)}</span>
                      : <EditableAmount value={item.amount} onChange={v=>up(item.id,"amount",v)}/>
                    }
                  </div>
                  <select value={item.resp} onChange={e=>up(item.id,"resp",e.target.value)} style={{...iS,cursor:"pointer"}}>
                    {(item.auto?RESP_AUTO:RESP_CUSTOM).map(o=><option key={o}>{o}</option>)}
                  </select>
                  {item.auto
                    ?<div style={{textAlign:"center",fontSize:12,color:T.textTert}}>🔒</div>
                    :<button onClick={()=>delItem(item.id)} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:20,lineHeight:1,textAlign:"center"}}>×</button>
                  }
                </div>
              );
            })}
          </div>
          <button onClick={addItem} style={{marginTop:12,width:"100%",padding:"13px",borderRadius:T.radiusSm,background:"transparent",border:`2px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontSize:14,fontFamily:"inherit",fontWeight:500}}>+ Add Line Item</button>
        </div>
        <div style={{background:T.card,borderTop:`1px solid ${T.border}`,padding:"18px 28px",flexShrink:0}}>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
            {displayItems.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe"&&i.computedAmt>0).map(item=>(
              <div key={item.id} style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:14,color:T.textSub}}>{item.title||"(unnamed)"} <span style={{fontSize:12,color:T.textTert}}>· {item.resp}</span></span>
                <span style={{fontSize:14,fontWeight:600,color:item.auto?T.gold:T.text}}>{fmtD(item.computedAmt)}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:`2px solid ${T.gold}`,paddingTop:12,marginTop:4}}>
              <span style={{fontSize:16,fontWeight:700,color:T.text}}>Total Selling Costs</span>
              <span style={{fontSize:20,fontWeight:800,color:T.gold}}>{fmtD(total)}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
            <button onClick={onClose} style={{padding:"12px 24px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:15}}>Cancel</button>
            <button onClick={()=>{onChange(displayItems,total);onClose();}} style={{padding:"12px 28px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:15,boxShadow:`0 2px 10px ${T.gold}55`}}>Save — {fmtD(total)}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Holding Costs Popup ──────────────────────────────────────────────────────
function HoldingCostsPopup({items, holdPeriod, onChange, onClose}){
  const months = n(holdPeriod)||1;
  const seed = (items && items.length > 0) ? items : [
    {id:1, title:"Property Taxes",  amount:"", perYear:true,  auto:false},
    {id:2, title:"Insurance",       amount:"", perYear:true,  auto:false},
    {id:3, title:"Utilities",       amount:"150", perMonth:true, auto:true},
    {id:4, title:"Miscellaneous",   amount:"200", perMonth:true, auto:false},
  ];
  const[loc,setLoc]=useState(seed);
  const up=(id,k,v)=>setLoc(prev=>prev.map(it=>it.id===id?{...it,[k]:v}:it));
  const addItem=()=>setLoc(prev=>[...prev,{id:Date.now(),title:"",amount:"",perMonth:true,auto:false}]);
  const delItem=(id)=>setLoc(prev=>prev.filter(it=>it.id!==id));

  function monthlyAmt(item){
    const a=n(item.amount);
    if(item.perYear) return a/12;
    return a;
  }
  function totalForPeriod(item){ return monthlyAmt(item)*months; }

  const grandTotal=loc.reduce((s,i)=>s+totalForPeriod(i),0);
  const iS={padding:"9px 12px",borderRadius:8,background:"#fff",border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",width:"100%"};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
      <div style={{background:T.bg,borderRadius:22,width:"min(700px,94vw)",maxHeight:"90vh",boxShadow:T.shadowMd,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{padding:"22px 28px 16px",background:T.card,borderBottom:`1px solid ${T.border}`,flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontWeight:700,fontSize:20,color:T.text}}>Holding Costs</div>
            <div style={{fontSize:14,color:T.textSub,marginTop:3}}>Hold period: <strong style={{color:T.text}}>{months} month{months!==1?"s":""}</strong> · Annual costs ÷ 12 × months</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:24,color:T.textTert,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"20px 28px"}}>
          {/* Column headers */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 110px 90px 110px 36px",gap:8,marginBottom:10,padding:"0 4px"}}>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em"}}>Description</div>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Annual / Mo</div>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"center"}}>Per</div>
            <div style={{fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Total ({months}mo)</div>
            <div/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {loc.map(item=>(
              <div key={item.id} style={{display:"grid",gridTemplateColumns:"1fr 110px 90px 110px 36px",gap:8,alignItems:"center",padding:"12px 14px",background:T.card,borderRadius:T.radiusSm,boxShadow:T.shadow}}>
                {/* Title */}
                {item.auto
                  ?<div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:14,fontWeight:600,color:T.gold}}>{item.title}</span>
                      <span style={{fontSize:11,background:T.goldLight,color:T.gold,padding:"2px 7px",borderRadius:20,fontWeight:600}}>auto</span>
                    </div>
                  :<input value={item.title} onChange={e=>up(item.id,"title",e.target.value)} placeholder="Description" style={iS}/>
                }
                {/* Amount input */}
                <input value={item.amount} onChange={e=>up(item.id,"amount",e.target.value.replace(/[^\d.]/g,""))} placeholder="0"
                  readOnly={item.auto} style={{...iS,textAlign:"right",background:item.auto?"#F8F1E0":"#fff",color:item.auto?T.gold:T.text}}/>
                {/* Per toggle */}
                <select value={item.perYear?"year":"month"} onChange={e=>up(item.id,"perYear",e.target.value==="year")}
                  disabled={item.auto}
                  style={{...iS,cursor:item.auto?"default":"pointer",background:item.auto?"#F8F1E0":"#fff",color:item.auto?T.gold:T.text,textAlign:"center",padding:"9px 6px"}}>
                  <option value="year">/ Year</option>
                  <option value="month">/ Month</option>
                </select>
                {/* Total for period */}
                <div style={{textAlign:"right"}}>
                  <span style={{fontSize:15,fontWeight:700,color:T.gold}}>{fmtD(totalForPeriod(item))}</span>
                </div>
                {item.auto
                  ?<div style={{textAlign:"center",fontSize:12,color:T.textTert}}>🔒</div>
                  :<button onClick={()=>delItem(item.id)} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:20,lineHeight:1,textAlign:"center"}}>×</button>
                }
              </div>
            ))}
          </div>
          <button onClick={addItem} style={{marginTop:12,width:"100%",padding:"13px",borderRadius:T.radiusSm,background:"transparent",border:`2px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontSize:14,fontFamily:"inherit",fontWeight:500}}>+ Add Line Item</button>
        </div>
        <div style={{background:T.card,borderTop:`1px solid ${T.border}`,padding:"18px 28px",flexShrink:0}}>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
            {loc.filter(i=>n(i.amount)>0).map(item=>(
              <div key={item.id} style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:14,color:T.textSub}}>{item.title||"(unnamed)"} <span style={{fontSize:12,color:T.textTert}}>· {item.perYear?`$${fmtD(n(item.amount)).replace("$","")}/yr`:`$${fmtD(n(item.amount)).replace("$","")}/mo`}</span></span>
                <span style={{fontSize:14,fontWeight:600,color:T.gold}}>{fmtD(totalForPeriod(item))}</span>
              </div>
            ))}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderTop:`2px solid ${T.gold}`,paddingTop:12,marginTop:4}}>
              <span style={{fontSize:16,fontWeight:700,color:T.text}}>Total Holding Costs ({months} months)</span>
              <span style={{fontSize:20,fontWeight:800,color:T.gold}}>{fmtD(grandTotal)}</span>
            </div>
          </div>
          <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
            <button onClick={onClose} style={{padding:"12px 24px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:15}}>Cancel</button>
            <button onClick={()=>{onChange(loc,grandTotal);onClose();}} style={{padding:"12px 28px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:15,boxShadow:`0 2px 10px ${T.gold}55`}}>Save — {fmtD(grandTotal)}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Financing Popup sub-components (outside function scope to avoid React #31) ─

// ─── ActualField — shows $USD formatted, click to edit ───────────────────────
function ActualField({value, onChange, label, up}){
  const[editing,setEditing]=useState(false);
  const[raw,setRaw]=useState(value||"");
  const amt=n(value||0);
  const commit=()=>{setEditing(false);onChange(raw);};
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",borderTop:`1px solid ${T.border}`}}>
      <span style={{fontSize:14,color:T.text}}>{label}</span>
      {editing
        ?<input autoFocus value={raw} onChange={e=>setRaw(numIn(e.target.value))}
            onBlur={commit} onKeyDown={e=>e.key==="Enter"&&commit()}
            style={{width:140,padding:"5px 8px",borderRadius:6,border:`1.5px solid ${T.gold}`,background:T.goldLight,color:T.text,fontSize:14,outline:"none",textAlign:"right",fontFamily:"inherit"}}/>
        :<span onClick={()=>{setRaw(value||"");setEditing(true);}}
            style={{fontSize:14,fontWeight:500,color:hasVal(value)?T.text:T.textTert,cursor:"pointer",minWidth:120,textAlign:"right",display:"inline-block"}}>
            {hasVal(value)?fmtD(amt):"tap to enter"}
          </span>
      }
    </div>
  );
}


// ─── Financing Popup — full overlay, matches Buying/Selling/Holding popup style ─
function FinancingPopup({fin, onSave, onClose}){
  const pp=n(fin.purchasePrice), rehab=n(fin.rehabCosts), holdMonths=n(fin.holdPeriod)||6;
  const holdItems=fin.holdingCostItems||[];
  const insAmt=n((holdItems.find(i=>i.title==="Insurance")||{}).amount)||0;

  const[hmPct,    setHmPct]    =useState(fin.hmLoanPct||"90");
  const[rehabPct, setRehabPct] =useState(fin.rehabFinPct||"100");
  const[hmRate,   setHmRate]   =useState(fin.hmRate||"9");
  const[hmOrigPct,setHmOrigPct]=useState(fin.hmOrigPct||"0");
  const[hmDocFee, setHmDocFee] =useState(fin.hmDocFee||"1000");
  const[gapRate,  setGapRate]  =useState(fin.gapRate||"15");

  const hmLoan       =Math.round(pp*(n(hmPct)/100));
  const hmRehabLoan  =Math.round(rehab*(n(rehabPct)/100));
  const hmTotal      =hmLoan+hmRehabLoan;
  const hmOrigFee    =Math.round(hmTotal*(n(hmOrigPct)/100));
  const hmDoc        =n(hmDocFee);
  const hmMonthlyInt =Math.round(hmLoan*(n(hmRate)/100)/12);
  const hmIntReserve =Math.round(hmMonthlyInt*holdMonths);
  const downPmt      =Math.round(pp*(1-n(hmPct)/100));
  const rehabGap     =Math.round(rehab*(1-n(rehabPct)/100));
  const buyingTotal  =fin.buyingCostItems?.length>0?calcBuyingTotal(fin.buyingCostItems,fin.purchasePrice):Math.round(pp*0.025);
  const gapPrincipal =downPmt+rehabGap+buyingTotal+hmIntReserve+hmOrigFee+hmDoc;
  const gapBalloon   =Math.round(gapPrincipal*(n(gapRate)/100)/12*holdMonths);
  const totalIntCost =hmIntReserve+hmOrigFee+hmDoc+gapBalloon;

  const bdr=`1px solid ${T.border}`;
  const iRow={display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 18px",borderTop:bdr};
  const iLbl={fontSize:13,color:T.text};
  const iVal={fontSize:13,fontWeight:600,color:T.gold};
  const iField=(label,val,set,sfx)=>(
    <div style={{...iRow}}>
      <span style={iLbl}>{label}</span>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <input value={val} onChange={e=>set(e.target.value.replace(/[^\d.]/g,""))}
          style={{width:72,padding:"4px 8px",borderRadius:6,border:bdr,background:T.bg,color:T.text,fontSize:13,outline:"none",textAlign:"right",fontFamily:"inherit"}}/>
        <span style={{fontSize:12,color:T.textSub,width:60}}>{sfx}</span>
      </div>
    </div>
  );

  function save(){
    onSave({hmLoanPct:hmPct,hmRate,hmOrigPct,hmDocFee,rehabFinPct:rehabPct,gapRate,
      locLoan:String(gapPrincipal),hmLoan:String(hmTotal),
      locInterest:String(gapBalloon),hmInterest:String(hmIntReserve)});
    onClose();
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
      <div style={{background:T.bg,borderRadius:22,width:"min(560px,94vw)",maxHeight:"90vh",boxShadow:T.shadowMd,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        <div style={{padding:"18px 22px",background:T.card,borderBottom:bdr,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:T.text}}>Financing Breakdown</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2}}>Purchase {fmtD(pp)} · Rehab {fmtD(rehab)} · {holdMonths} mo hold</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        <div style={{flex:1,overflowY:"auto"}}>
          {/* HM section */}
          <div style={{padding:"10px 18px 4px",background:T.card,marginTop:1}}>
            <div style={{fontSize:11,fontWeight:700,color:T.blue,textTransform:"uppercase",letterSpacing:"0.07em"}}>Hard Money Loan</div>
          </div>
          <div style={{background:T.card}}>
            {iField("Loan % of Purchase",hmPct,setHmPct,"%")}
            {iField("Rehab Financing",rehabPct,setRehabPct,"% of rehab")}
            {iField("Interest Rate",hmRate,setHmRate,"% / yr")}
            {iField("Origination Fee",hmOrigPct,setHmOrigPct,"% (0=none)")}
            {iField("Doc Fee",hmDocFee,setHmDocFee,"$")}
            <div style={{...iRow,background:"#EBF4FF"}}><span style={{fontSize:13,color:T.blue,fontWeight:600}}>Total HM Loan</span><span style={{fontSize:13,fontWeight:700,color:T.blue}}>{fmtD(hmTotal)}</span></div>
            <div style={iRow}><span style={iLbl}>Monthly Interest</span><span style={iVal}>{fmtD(hmMonthlyInt)}/mo</span></div>
            <div style={iRow}><span style={iLbl}>Interest Reserve ({holdMonths} mo)</span><span style={iVal}>{fmtD(hmIntReserve)}</span></div>
          </div>

          {/* Gap section */}
          <div style={{padding:"12px 18px 4px",background:T.card}}>
            <div style={{fontSize:11,fontWeight:700,color:"#5AC8FA",textTransform:"uppercase",letterSpacing:"0.07em"}}>Gap / Outside Capital</div>
          </div>
          <div style={{background:T.card}}>
            {iField("Gap Rate (balloon at exit)",gapRate,setGapRate,"% / yr")}
            <div style={iRow}><span style={iLbl}>Down Payment ({(100-n(hmPct)).toFixed(0)}%)</span><span style={iVal}>{fmtD(downPmt)}</span></div>
            {rehabGap>0&&<div style={iRow}><span style={iLbl}>Rehab Gap ({(100-n(rehabPct)).toFixed(0)}%)</span><span style={iVal}>{fmtD(rehabGap)}</span></div>}
            <div style={iRow}><span style={iLbl}>Buying Costs</span><span style={iVal}>{fmtD(buyingTotal)}</span></div>
            <div style={iRow}><span style={iLbl}>HM Interest Reserve</span><span style={iVal}>{fmtD(hmIntReserve)}</span></div>
            {hmOrigFee>0&&<div style={iRow}><span style={iLbl}>HM Origination Fee</span><span style={iVal}>{fmtD(hmOrigFee)}</span></div>}
            <div style={iRow}><span style={iLbl}>HM Doc Fee</span><span style={iVal}>{fmtD(hmDoc)}</span></div>
            {insAmt>0&&<div style={iRow}><span style={iLbl}>Insurance Premium</span><span style={iVal}>{fmtD(insAmt)}</span></div>}
            <div style={{...iRow,background:"#EAF9FD"}}><span style={{fontSize:13,fontWeight:700,color:"#0EA5C5"}}>Total Capital to Raise</span><span style={{fontSize:13,fontWeight:700,color:"#0EA5C5"}}>{fmtD(gapPrincipal)}</span></div>
            <div style={{...iRow,background:"#FFF8F0"}}><span style={{fontSize:13,color:T.textSub}}>Gap Balloon Interest — at sale</span><span style={{fontSize:13,fontWeight:600,color:T.orange}}>{fmtD(gapBalloon)}</span></div>
          </div>

          {/* Summary */}
          <div style={{padding:"12px 18px 4px",background:T.card}}>
            <div style={{fontSize:11,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:"0.07em"}}>Summary</div>
          </div>
          <div style={{background:T.card,paddingBottom:6}}>
            <div style={{...iRow,background:T.goldLight,borderTop:`2px solid ${T.gold}`}}>
              <span style={{fontSize:13,fontWeight:600,color:T.gold}}>HM Loan + Gap Principal</span>
              <span style={{fontSize:14,fontWeight:700,color:T.gold}}>{fmtD(hmTotal+gapPrincipal)}</span>
            </div>
            <div style={{...iRow,background:T.goldLight}}>
              <span style={{fontSize:13,fontWeight:600,color:T.gold}}>Total Debt Service</span>
              <span style={{fontSize:14,fontWeight:700,color:T.gold}}>{fmtD(totalIntCost)}</span>
            </div>
          </div>
        </div>

        <div style={{padding:"14px 22px",background:T.card,borderTop:bdr,flexShrink:0,display:"flex",justifyContent:"flex-end",gap:10}}>
          <button onClick={onClose} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,fontWeight:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          <button onClick={save} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            Save Financing
          </button>
        </div>
      </div>
    </div>
  );
}

function PopupRow({label,value,onOpen}){
  return(
    <div onClick={onOpen} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 16px",borderTop:`1px solid ${T.border}`,cursor:"pointer"}}
      onMouseEnter={e=>e.currentTarget.style.background="#FAFAFA"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <span style={{fontSize:14,color:T.text}}>{label}</span>
      <span style={{fontSize:14,color:T.blue,fontWeight:500}}>{value}</span>
    </div>
  );
}

// ─── Property Info section helpers (shared by PropDetail and LeadDetail) ─────
function SectionHdr({icon,label,color}){
  return(
    <div style={{padding:"10px 18px",background:color,display:"flex",alignItems:"center",justifyContent:"center",gap:7,borderRadius:`${T.radius}px ${T.radius}px 0 0`}}>
      <span style={{fontSize:13}}>{icon}</span>
      <span style={{fontSize:11,fontWeight:700,color:T.text,letterSpacing:"0.06em"}}>{label}</span>
    </div>
  );
}
function DateRow({label,value,onChange,icon}){
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",borderTop:`1px solid ${T.border}`}}>
      <span style={{fontSize:13,color:T.textSub,display:"flex",alignItems:"center",gap:6}}>{icon&&<span style={{fontSize:12}}>{icon}</span>}{label}</span>
      <input type="date" value={value||""} onChange={e=>onChange(e.target.value)}
        style={{fontSize:13,fontWeight:600,color:value?T.text:T.textTert,padding:"4px 8px",borderRadius:6,border:`1px solid ${T.border}`,background:T.bg,outline:"none",fontFamily:"inherit",cursor:"pointer"}}/>
    </div>
  );
}

// ─── Task Contact Popup ───────────────────────────────────────────────────────
function TaskContactPopup({role, contact, allContacts, onSet, onClose}){
  const[mode,setMode]=useState(contact?"view":"pick"); // view | pick | new
  const[newName,setNewName]=useState("");
  const[newPhone,setNewPhone]=useState("");
  const[newEmail,setNewEmail]=useState("");
  const[newRole2,setNewRole2]=useState(role||"");
  const found=allContacts.find(c=>c.name===contact)||null;
  const iS2={width:"100%",padding:"8px 10px",borderRadius:8,border:`1px solid ${T.border}`,background:T.bg,color:T.text,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
      <div style={{background:"#fff",borderRadius:20,width:"min(400px,92vw)",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",overflow:"hidden"}}>
        {/* Header */}
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:T.goldLight}}>
          <div style={{fontSize:13,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:"0.06em"}}>{role}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        {mode==="view"&&found&&(
          <div style={{padding:20}}>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
              <div style={{width:52,height:52,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:20,color:"#fff"}}>{found.name[0]}</div>
              <div><div style={{fontSize:17,fontWeight:700,color:T.text}}>{found.name}</div><div style={{fontSize:13,color:T.textSub}}>{found.role}</div></div>
            </div>
            {found.phone&&<div style={{display:"flex",gap:10,alignItems:"center",padding:"10px 0",borderTop:`1px solid ${T.border}`}}>
              <span style={{fontSize:13,color:T.textSub,width:60}}>Phone</span><span style={{fontSize:14,fontWeight:600,color:T.text}}>{found.phone}</span>
            </div>}
            {found.email&&<div style={{display:"flex",gap:10,alignItems:"center",padding:"10px 0",borderTop:`1px solid ${T.border}`}}>
              <span style={{fontSize:13,color:T.textSub,width:60}}>Email</span><span style={{fontSize:14,color:T.blue}}>{found.email}</span>
            </div>}
            <div style={{marginTop:16,display:"flex",gap:8}}>
              <button onClick={()=>setMode("pick")} style={{flex:1,padding:"9px",borderRadius:10,background:T.bg,border:`1px solid ${T.border}`,color:T.text,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>Change</button>
              <button onClick={onClose} style={{flex:1,padding:"9px",borderRadius:10,background:T.gold,border:"none",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700}}>Done</button>
            </div>
          </div>
        )}

        {mode==="pick"&&(
          <div style={{padding:20}}>
            <div style={{fontSize:13,color:T.textSub,marginBottom:12}}>Select from your directory or add new:</div>
            <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:200,overflowY:"auto",marginBottom:12}}>
              {allContacts.map(c=>(
                <div key={c.id||c.name} onClick={()=>{onSet(c.name);setMode("view");}}
                  style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:10,background:contact===c.name?T.goldLight:T.bg,cursor:"pointer",border:`1px solid ${contact===c.name?T.gold:T.border}`}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.goldLight} onMouseLeave={e=>e.currentTarget.style.background=contact===c.name?T.goldLight:T.bg}>
                  <div style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:13,color:"#fff"}}>{c.name[0]}</div>
                  <div><div style={{fontSize:13,fontWeight:600,color:T.text}}>{c.name}</div><div style={{fontSize:11,color:T.textSub}}>{c.role}</div></div>
                </div>
              ))}
            </div>
            <button onClick={()=>setMode("new")} style={{width:"100%",padding:"9px",borderRadius:10,background:"transparent",border:`1.5px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>+ Add New Contact</button>
          </div>
        )}

        {mode==="new"&&(
          <div style={{padding:20,display:"flex",flexDirection:"column",gap:10}}>
            <div style={{fontSize:13,fontWeight:600,color:T.text,marginBottom:4}}>New Contact</div>
            <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Full name *" style={iS2}/>
            <input value={newRole2} onChange={e=>setNewRole2(e.target.value)} placeholder="Role / company" style={iS2}/>
            <input value={newPhone} onChange={e=>setNewPhone(e.target.value)} placeholder="Phone" style={iS2}/>
            <input value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="Email" style={iS2}/>
            <div style={{display:"flex",gap:8,marginTop:4}}>
              <button onClick={()=>setMode("pick")} style={{flex:1,padding:"9px",borderRadius:10,background:T.bg,border:`1px solid ${T.border}`,color:T.text,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>Back</button>
              <button onClick={()=>{if(!newName.trim())return;onSet(newName.trim(),{name:newName.trim(),role:newRole2,phone:newPhone,email:newEmail});setMode("view");}}
                style={{flex:1,padding:"9px",borderRadius:10,background:T.gold,border:"none",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700}}>Save & Use</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Grid row helpers for the Projected | Actual table ───────────────────────
// Responsive column template: on phones the number columns shrink to a % of the
// row (instead of fixed 160px) so the Actual column no longer runs off-screen.
const finCols=(showActual,isMobile)=>isMobile
  ?(showActual?"minmax(0,1fr) 31% 31%":"minmax(0,1fr) 42%")
  :(showActual?"1fr 160px 160px":"1fr 160px");
function RowHdr({label,color,showActual}){
  const isMobile=useIsMobile();
  return(
    <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderTop:`1px solid ${T.border}`,background:T.bg}}>
      <div style={{gridColumn:showActual?"1 / span 3":"1 / span 2",padding:isMobile?"9px 12px 5px":"9px 18px 5px",display:"flex",alignItems:"center",gap:7}}>
        <span style={{width:3,height:12,borderRadius:2,background:color,display:"inline-block"}}/>
        <span style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</span>
      </div>
    </div>
  );
}
function DateGridRow({label,value,onChange,showActual}){
  const isMobile=useIsMobile();
  return(
    <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderTop:`1px solid ${T.border}`}}>
      <div style={{padding:isMobile?"9px 12px":"9px 18px",fontSize:13,color:T.text}}>{label}</div>
      {!isMobile&&<div/>}
      {/* On mobile the date has no Projected value, so let it use both number columns for room. */}
      <div style={{gridColumn:isMobile?"2 / span 2":"auto",padding:isMobile?"6px 12px 6px 0":"6px 14px",textAlign:"right",minWidth:0,overflow:"hidden"}}>
        <input type="date" value={value||""} onChange={e=>onChange(e.target.value)}
          style={{fontSize:12,padding:"4px 7px",borderRadius:6,border:`1px solid ${T.border}`,background:T.bg,color:T.text,outline:"none",fontFamily:"inherit",cursor:"pointer",width:isMobile?"100%":"auto",minWidth:0,maxWidth:"100%",boxSizing:"border-box"}}/>
      </div>
    </div>
  );
}
function EditGridRow({label,pVal,pEdit,aVal,aEdit,showActual,readOnlyActual,suffix,dim,dimP}){
  const isMobile=useIsMobile();
  const[editingP,setEditingP]=useState(false);
  const[editingA,setEditingA]=useState(false);
  const[rawP,setRawP]=useState("");
  const[rawA,setRawA]=useState("");
  const inS={width:"100%",padding:"5px 8px",borderRadius:6,border:`1.5px solid ${T.gold}`,background:T.goldLight,color:T.text,fontSize:13,outline:"none",textAlign:"right",fontFamily:"inherit",boxSizing:"border-box"};
  const pColor=dimP?T.textTert:(dim?T.textTert:T.text);
  return(
    <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderTop:`1px solid ${T.border}`}}>
      <div style={{padding:isMobile?"9px 12px":"9px 18px",fontSize:13,color:dim?T.textTert:T.text}}>{label}</div>
      <div style={{padding:isMobile?"6px 8px":"6px 14px",textAlign:"right"}}>
        {editingP
          ?<input autoFocus value={rawP} onChange={e=>setRawP(e.target.value.replace(/[^\d.]/g,""))}
              onBlur={()=>{setEditingP(false);pEdit(rawP);}} onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
              style={inS}/>
          :<span onClick={()=>{setRawP(String(pVal||""));setEditingP(true);}} style={{fontSize:13,color:pColor,cursor:"pointer"}}>{suffix?`${pVal||0} ${suffix}`:fmtD(n(pVal))}</span>}
      </div>
      {showActual&&<div style={{padding:isMobile?"6px 8px":"6px 14px",textAlign:"right"}}>
        {readOnlyActual?<span style={{fontSize:13,color:T.textTert}}>—</span>:
        editingA
          ?<input autoFocus value={rawA} onChange={e=>setRawA(numIn(e.target.value))}
              onBlur={()=>{setEditingA(false);aEdit(rawA);}} onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
              style={inS}/>
          :<span onClick={()=>{setRawA(String(aVal??""));setEditingA(true);}} style={{fontSize:13,fontWeight:hasVal(aVal)?600:400,color:hasVal(aVal)?T.green:T.textTert,cursor:"pointer"}}>{hasVal(aVal)?(suffix?`${aVal} ${suffix}`:fmtD(n(aVal))):"tap to enter"}</span>}
      </div>}
    </div>
  );
}
function PopupGridRow({label,pVal,onOpenP,aVal,aEdit,onOpenA,showActual,aIsPopup,dimP}){
  const isMobile=useIsMobile();
  const[editingA,setEditingA]=useState(false);
  const[rawA,setRawA]=useState("");
  const inS={width:"100%",padding:"5px 8px",borderRadius:6,border:`1.5px solid ${T.gold}`,background:T.goldLight,color:T.text,fontSize:13,outline:"none",textAlign:"right",fontFamily:"inherit",boxSizing:"border-box"};
  return(
    <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderTop:`1px solid ${T.border}`}}>
      <div style={{padding:isMobile?"9px 12px":"9px 18px",fontSize:13,color:T.text}}>{label}</div>
      <div onClick={onOpenP} style={{padding:isMobile?"9px 8px":"9px 14px",textAlign:"right",fontSize:13,color:dimP?T.textTert:T.blue,fontWeight:500,cursor:"pointer"}}>{fmtD(pVal)} ›</div>
      {showActual&&<div style={{padding:aIsPopup?(isMobile?"9px 8px":"9px 14px"):(isMobile?"6px 8px":"6px 14px"),textAlign:"right"}}>
        {aIsPopup
          ? <span onClick={onOpenA} style={{fontSize:13,fontWeight:500,color:T.green,cursor:"pointer"}}>{n(aVal)!==0?fmtD(n(aVal))+" ›":"tap to enter ›"}</span>
          : editingA
            ?<input autoFocus value={rawA} onChange={e=>setRawA(numIn(e.target.value))}
                onBlur={()=>{setEditingA(false);aEdit(rawA);}} onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                style={inS}/>
            :<span onClick={()=>{setRawA(String(aVal??""));setEditingA(true);}} style={{fontSize:13,fontWeight:hasVal(aVal)?600:400,color:hasVal(aVal)?T.green:T.textTert,cursor:"pointer"}}>{hasVal(aVal)?fmtD(n(aVal)):"tap to enter"}</span>}
      </div>}
    </div>
  );
}
function TotalGridRow({label,pVal,aVal,showActual,color,dimP}){
  const isMobile=useIsMobile();
  const c=color||T.gold;
  return(
    <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderTop:`2px solid ${c}`,background:c+"14"}}>
      <div style={{padding:isMobile?"11px 12px":"11px 18px",fontSize:14,fontWeight:700,color:dimP?T.textTert:c}}>{label}</div>
      <div style={{padding:isMobile?"11px 8px":"11px 14px",fontSize:14,fontWeight:700,color:dimP?T.textTert:c,textAlign:"right"}}>{fmtD(pVal)}</div>
      {showActual&&<div style={{padding:isMobile?"11px 8px":"11px 14px",fontSize:14,fontWeight:700,color:aVal!==null?c:T.textTert,textAlign:"right"}}>{aVal!==null?fmtD(aVal):"—"}</div>}
    </div>
  );
}

// ─── Actual Financing Popup — simple, user enters real loan amounts/rates ─────
function ActualFinancingPopup({f, liveHmTotal, liveGapPrinc, actualHoldMonths, locDraws=[], sellingDate, onSave, onClose}){
  // Auto-matched line of credit for this property → projected interest to a sell date.
  const[assumedSell,setAssumedSell]=useState(sellingDate||new Date().toISOString().slice(0,10));
  const locRows=(locDraws||[]).map(d=>{const end=d.paybackDate||assumedSell;const days=daysBetween(d.dateFunded,end);return {...d,end,days,interest:(Number(d.amount)||0)*(LOC_RATE/365)*days};}).sort((a,b)=>String(a.dateFunded||"").localeCompare(String(b.dateFunded||"")));
  const locFunded=locRows.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const locInterest=locRows.reduce((s,r)=>s+r.interest,0);
  const[hmLoanAmt, setHmLoanAmt] = useState(f.acHmLoanAmt||String(liveHmTotal));
  const[hmRate,    setHmRate]    = useState(f.acHmRate!==undefined?f.acHmRate:String(f.hmRate||9));
  const[hmOrigPct, setHmOrigPct] = useState(f.acHmOrigPct!==undefined?f.acHmOrigPct:String(f.hmOrigPct||0));
  const[hmDocFee,  setHmDocFee]  = useState(f.acHmDocFee!==undefined?f.acHmDocFee:String(f.hmDocFee||1000));
  const[gapLoanAmt,setGapLoanAmt]= useState(f.acGapLoanAmt||String(liveGapPrinc));
  const[gapRate,   setGapRate]   = useState(f.acGapRate!==undefined?f.acGapRate:String(f.gapRate||15));
  const[hmIntOverride, setHmIntOverride]   = useState(f.acHmInterestOverride||"");
  const[gapIntOverride,setGapIntOverride]  = useState(f.acGapInterestOverride||"");

  const months = actualHoldMonths||n(f.holdPeriod)||0;
  const hmMonthlyInt = Math.round(n(hmLoanAmt)*(n(hmRate)/100)/12);
  const hmOrigFee = Math.round(n(hmLoanAmt)*(n(hmOrigPct)/100));
  const calcHmInterest = Math.round(hmMonthlyInt*months)+hmOrigFee+n(hmDocFee);
  const calcGapBalloon = Math.round(n(gapLoanAmt)*(n(gapRate)/100)/12*months);
  const finalHmInt = hmIntOverride!==""?n(hmIntOverride):calcHmInterest;
  const finalGapInt = gapIntOverride!==""?n(gapIntOverride):calcGapBalloon;
  const totalDebt = finalHmInt+finalGapInt;

  const bdr=`1px solid ${T.border}`;
  const iRow={display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 18px",borderTop:bdr};
  const iLbl={fontSize:13,color:T.text};
  const iVal={fontSize:13,fontWeight:600,color:T.green};
  const iField=(label,val,set,sfx,note)=>(
    <div style={iRow}>
      <div>
        <div style={iLbl}>{label}</div>
        {note&&<div style={{fontSize:11,color:T.textTert,marginTop:1}}>{note}</div>}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <input value={val} onChange={e=>set(e.target.value.replace(/[^\d.]/g,""))}
          style={{width:80,padding:"4px 8px",borderRadius:6,border:bdr,background:T.bg,color:T.text,fontSize:13,outline:"none",textAlign:"right",fontFamily:"inherit"}}/>
        <span style={{fontSize:12,color:T.textSub,width:55}}>{sfx}</span>
      </div>
    </div>
  );

  function save(){
    onSave({
      acHmLoanAmt:hmLoanAmt, acHmRate:hmRate, acHmOrigPct:hmOrigPct, acHmDocFee:hmDocFee,
      acGapLoanAmt:gapLoanAmt, acGapRate:gapRate,
      acHmInterestOverride:hmIntOverride, acGapInterestOverride:gapIntOverride,
      hmInterest:String(finalHmInt), locInterest:String(finalGapInt), locLoan:gapLoanAmt,
    });
    onClose();
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
      <div style={{background:T.bg,borderRadius:22,width:"min(560px,94vw)",maxHeight:"90vh",boxShadow:T.shadowMd,display:"flex",flexDirection:"column",overflow:"hidden"}}>

        <div style={{padding:"18px 22px",background:T.card,borderBottom:bdr,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:T.text}}>Actual Financing</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2}}>{months} months actual hold · enter what you really borrowed</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{padding:"10px 18px 4px",background:T.card,marginTop:1}}>
            <div style={{fontSize:11,fontWeight:700,color:T.blue,textTransform:"uppercase",letterSpacing:"0.07em"}}>Hard Money Loan</div>
          </div>
          <div style={{background:T.card}}>
            {iField("Loan Amount",hmLoanAmt,setHmLoanAmt,"$","defaults to projected")}
            {iField("Interest Rate",hmRate,setHmRate,"% / yr")}
            {iField("Origination Fee",hmOrigPct,setHmOrigPct,"%")}
            {iField("Doc Fee",hmDocFee,setHmDocFee,"$")}
            <div style={iRow}><span style={iLbl}>Calculated Interest + Fees</span><span style={iVal}>{fmtD(calcHmInterest)}</span></div>
            {iField("Override Total HM Interest",hmIntOverride,setHmIntOverride,"$","leave blank to use calculated")}
          </div>

          <div style={{padding:"12px 18px 4px",background:T.card}}>
            <div style={{fontSize:11,fontWeight:700,color:"#5AC8FA",textTransform:"uppercase",letterSpacing:"0.07em"}}>Gap / Outside Capital</div>
          </div>
          {/* Auto-matched private line of credit for this property (from the Financial Section) */}
          {locDraws.length>0&&(()=>{const gcol="1fr 84px 84px";return(
            <div style={{margin:"8px 16px 4px",background:"#fff",border:`1px solid ${T.gold}`,borderRadius:12,overflow:"hidden",boxShadow:T.shadow}}>
              <div style={{padding:"9px 14px",background:T.goldLight,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                <div style={{fontSize:11.5,fontWeight:800,color:T.gold,textTransform:"uppercase",letterSpacing:"0.05em"}}>Matched Line of Credit</div>
                <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:T.textSub,whiteSpace:"nowrap"}}>If sold by
                  <input type="date" value={assumedSell} onChange={e=>setAssumedSell(e.target.value)} style={{padding:"3px 6px",borderRadius:6,border:bdr,background:"#fff",fontSize:12,fontFamily:"inherit",color:T.text}}/>
                </label>
              </div>
              <div style={{display:"grid",gridTemplateColumns:gcol,gap:10,padding:"7px 14px 4px",fontSize:9,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                <span>Lender · Funded</span><span style={{textAlign:"right"}}>Amount</span><span style={{textAlign:"right"}}>Interest</span>
              </div>
              {locRows.map((r,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:gcol,gap:10,padding:"7px 14px",borderTop:`1px solid ${T.border}`,alignItems:"center"}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.funderName||"—"}</div>
                    <div style={{fontSize:10.5,color:T.textTert}}>{finFmtDate(r.dateFunded)}{r.paybackDate?` → paid`:` · ${r.days}d`}</div>
                  </div>
                  <div style={{fontSize:13,fontWeight:600,color:T.text,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtD(r.amount)}</div>
                  <div style={{fontSize:13,fontWeight:700,color:T.gold,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtD(r.interest)}</div>
                </div>
              ))}
              <div style={{display:"grid",gridTemplateColumns:gcol,gap:10,padding:"9px 14px",borderTop:`2px solid ${T.gold}`,background:T.goldLight,alignItems:"center"}}>
                <span style={{fontSize:11,fontWeight:700,color:T.textSub}}>{locRows.length} draw{locRows.length===1?"":"s"}</span>
                <span style={{fontSize:14,fontWeight:800,color:T.text,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtD(locFunded)}</span>
                <span style={{fontSize:14,fontWeight:800,color:T.gold,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>{fmtD(locInterest)}</span>
              </div>
              <div style={{padding:"10px 14px",borderTop:`1px solid ${T.border}`}}>
                <button onClick={()=>{setGapLoanAmt(String(Math.round(locFunded)));setGapIntOverride(String(Math.round(locInterest)));}} style={{width:"100%",padding:"9px",borderRadius:8,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:12.5,cursor:"pointer",fontFamily:"inherit"}}>Use as gap financing&nbsp;↓</button>
              </div>
            </div>
          );})()}
          <div style={{background:T.card,paddingBottom:6}}>
            {iField("Gap Loan Amount",gapLoanAmt,setGapLoanAmt,"$","defaults to projected")}
            {iField("Gap Rate",gapRate,setGapRate,"% / yr")}
            <div style={iRow}><span style={iLbl}>Calculated Balloon</span><span style={iVal}>{fmtD(calcGapBalloon)}</span></div>
            {iField("Override Gap Balloon Paid",gapIntOverride,setGapIntOverride,"$","leave blank to use calculated")}
            <div style={{...iRow,background:T.goldLight,borderTop:`2px solid ${T.gold}`}}>
              <span style={{fontSize:14,fontWeight:700,color:T.gold}}>Total Debt Service</span>
              <span style={{fontSize:15,fontWeight:800,color:T.gold}}>{fmtD(totalDebt)}</span>
            </div>
          </div>
        </div>

        <div style={{padding:"14px 22px",background:T.card,borderTop:bdr,flexShrink:0,display:"flex",justifyContent:"flex-end",gap:10}}>
          <button onClick={onClose} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,fontWeight:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          <button onClick={save} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.green,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
            Save Actual Financing
          </button>
        </div>
      </div>
    </div>
  );
}

function FinOverview({property,onUpdate}){
  const isMobile=useIsMobile();
  const { draws } = useData();
  const f=property.financials;
  // Auto-match this property's private-lender draws from the Financial Section
  // (by explicit link or strong address match) — surfaced in the Financing popup.
  const locDraws=drawsForProperty(property,draws);
  const up=(k,v)=>onUpdate(property.id,"financials",{...f,[k]:v});
  const upMany=(ch)=>onUpdate(property.id,"financials",{...f,...ch});
  const[showBuying,setShowBuying]=useState(false);
  const[showSelling,setShowSelling]=useState(false);
  const[showHolding,setShowHolding]=useState(false);
  const[showActualSelling,setShowActualSelling]=useState(false);
  const[showActualFinancing,setShowActualFinancing]=useState(false);
  const[showFinancingP,setShowFinancingP]=useState(false);
  const[showActual,setShowActual]=useState(!!f.useActualProfit);

  const buyingItems=f.buyingCostItems||[];
  const buyingTotal=buyingItems.length>0?calcBuyingTotal(buyingItems,f.purchasePrice):n(f.buyingCosts)||0;
  const sellingItems=f.sellingCostItems||[];
  const holdingItems=f.holdingCostItems||[];
  const holdPeriodMonths=n(f.holdPeriod)||0;

  function calcSelling(sp){
    return sellingItems.length>0
      ?sellingItems.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>{
          if(i.autoType==="commission")return s+Math.round(n(sp)*(parseFloat(i.commissionPct||0)/100));
          if(i.autoType==="tax"){const rtf=calcNJRTF(n(sp));return i.resp==="Seller Pays"?s+rtf.total:i.resp==="Split"?s+Math.round(rtf.total/2):s;}
          return s+n(i.amount);
        },0)
      :n(f.sellingCosts)||0;
  }
  function calcHolding(months){
    return holdingItems.length>0
      ?holdingItems.reduce((s,i)=>s+(i.perYear?n(i.amount)/12:n(i.amount))*months,0)
      :n(f.annualHoldingCosts)||0;
  }

  const sellingTotal=calcSelling(f.salePrice);
  const holdingTotal=calcHolding(holdPeriodMonths);
  const totalCosts=n(f.purchasePrice)+buyingTotal+n(f.rehabCosts)+holdingTotal;

  const liveHmLoan    = Math.round(n(f.purchasePrice)*(n(f.hmLoanPct||90)/100));
  const liveHmMonthly = Math.round(liveHmLoan*(n(f.hmRate||9)/100)/12);
  const liveHmReserve = Math.round(liveHmMonthly*holdPeriodMonths);
  const liveRehabLoan = Math.round(n(f.rehabCosts)*(n(f.rehabFinPct||100)/100));
  const liveHmTotal   = liveHmLoan+liveRehabLoan;
  const liveHmOrigFee = Math.round(liveHmTotal*(n(f.hmOrigPct||0)/100));
  const liveHmDoc     = n(f.hmDocFee||1000);
  const liveGapPrinc  = Math.round(n(f.purchasePrice)*(1-n(f.hmLoanPct||90)/100))
                      + Math.round(n(f.rehabCosts)*(1-n(f.rehabFinPct||100)/100))
                      + buyingTotal+liveHmReserve+liveHmOrigFee+liveHmDoc;
  const liveGapBalloon= Math.round(liveGapPrinc*(n(f.gapRate||15)/100)/12*holdPeriodMonths);
  const hmInterestFinal = n(f.hmInterest)||liveHmReserve;
  const locInterestFinal= n(f.locInterest)||liveGapBalloon;
  const debtService=hmInterestFinal+locInterestFinal;
  const equityRequired = n(f.locLoan)||liveGapPrinc;
  const _fp=finProfit(f);                 // single source of truth (matches Portfolio)
  const netProfit=_fp.netProfit;

  // ── Actual hold period from dates ──
  const actualHoldMonths=f.purchaseDate&&f.sellingDate
    ?parseFloat(((new Date(f.sellingDate)-new Date(f.purchaseDate))/(1000*60*60*24*30.44)).toFixed(1))
    :holdPeriodMonths;

  // ── Actual acquisition & costs — plain user-entered numbers, no formulas ──
  const acPP     = n(f.actualPurchasePrice);
  const acBuying = n(f.actualBuyingCosts);
  const acRehab  = n(f.actualRehabCosts);
  const acHolding= n(f.actualHoldingCosts);
  const acCosts  = acPP+acBuying+acRehab+acHolding;

  // ── Actual selling costs — own popup, blank by default ──
  const acSalePrice=n(f.actualSalePrice);
  const acSellingItems=f.actualSellingCostItems||[];
  const acSelling=acSellingItems.length>0
    ?acSellingItems.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>{
        if(i.autoType==="commission")return s+Math.round(acSalePrice*(parseFloat(i.commissionPct||0)/100));
        if(i.autoType==="tax"){const rtf=calcNJRTF(acSalePrice);return i.resp==="Seller Pays"?s+rtf.total:i.resp==="Split"?s+Math.round(rtf.total/2):s;}
        return s+n(i.amount);
      },0)
    :n(f.actualSellingCosts)||0;

  // ── Actual financing — defaults to projected rate/terms, fully overridable ──
  const acHmLoanAmt   = n(f.acHmLoanAmt)||liveHmTotal;
  const acHmRate       = f.acHmRate!==undefined?n(f.acHmRate):n(f.hmRate||9);
  const acHmOrigPct    = f.acHmOrigPct!==undefined?n(f.acHmOrigPct):n(f.hmOrigPct||0);
  const acHmDocAmt     = f.acHmDocFee!==undefined?n(f.acHmDocFee):n(f.hmDocFee||1000);
  const acGapLoanAmt   = n(f.acGapLoanAmt)||equityRequired;
  const acGapRate      = f.acGapRate!==undefined?n(f.acGapRate):n(f.gapRate||15);
  const acHmMonthlyInt = Math.round(acHmLoanAmt*(acHmRate/100)/12);
  const acHmInterest   = f.acHmInterestOverride!==undefined&&f.acHmInterestOverride!==""
    ? n(f.acHmInterestOverride)
    : Math.round(acHmMonthlyInt*actualHoldMonths)+Math.round(acHmLoanAmt*(acHmOrigPct/100))+acHmDocAmt;
  const acGapBalloon   = f.acGapInterestOverride!==undefined&&f.acGapInterestOverride!==""
    ? n(f.acGapInterestOverride)
    : Math.round(acGapLoanAmt*(acGapRate/100)/12*actualHoldMonths);
  const acDebt = acHmInterest+acGapBalloon;

  const acNet = _fp.acNet;                 // single source of truth (matches Portfolio)

  const iS={padding:"5px 8px",borderRadius:6,border:`1px solid ${T.border}`,background:"#fff",color:T.text,fontSize:13,outline:"none",textAlign:"right",fontFamily:"inherit",boxSizing:"border-box"};

  return(
    <div style={{background:T.bg,minHeight:"100%",padding:"24px 28px"}}>
      {showBuying&&<BuyingCostsPopup items={buyingItems} purchasePrice={f.purchasePrice} currentResp={f.transferTaxResp} onChange={(items,total,resp,taxAmt)=>upMany({buyingCostItems:items,buyingCosts:String(total),buyingTransferTax:String(taxAmt||0),transferTaxResp:resp})} onClose={()=>setShowBuying(false)}/>}
      {showSelling&&<SellingCostsPopup items={sellingItems} salePrice={f.salePrice} currentResp={f.transferTaxResp} onChange={(items,total)=>upMany({sellingCostItems:items,sellingCosts:String(total)})} onClose={()=>setShowSelling(false)}/>}
      {showHolding&&<HoldingCostsPopup items={holdingItems} holdPeriod={f.holdPeriod} onChange={(items,total)=>upMany({holdingCostItems:items,annualHoldingCosts:String(total)})} onClose={()=>setShowHolding(false)}/>}
      {showActualSelling&&<SellingCostsPopup items={acSellingItems} salePrice={f.actualSalePrice||f.salePrice} currentResp={f.transferTaxResp} onChange={(items,total)=>upMany({actualSellingCostItems:items,actualSellingCosts:String(total)})} onClose={()=>setShowActualSelling(false)}/>}
      {showFinancingP&&<FinancingPopup fin={f} onSave={(vals)=>upMany(vals)} onClose={()=>setShowFinancingP(false)}/>}
      {showActualFinancing&&<ActualFinancingPopup f={f} liveHmTotal={liveHmTotal} liveGapPrinc={equityRequired} actualHoldMonths={actualHoldMonths} locDraws={locDraws} sellingDate={f.sellingDate}
        onSave={(vals)=>upMany(vals)} onClose={()=>setShowActualFinancing(false)}/>}

      {/* Toggle bar */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20,justifyContent:"center",flexWrap:"wrap"}}>
        <div onClick={()=>setShowActual(v=>!v)}
          style={{display:"inline-flex",alignItems:"center",gap:10,background:showActual?T.green+"22":T.bg,border:`1.5px solid ${showActual?T.green:T.border}`,borderRadius:20,padding:"7px 18px",cursor:"pointer"}}>
          <div style={{width:18,height:18,borderRadius:9,background:showActual?T.green:"#ccc",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {showActual&&<span style={{color:"#fff",fontSize:12,lineHeight:1}}>✓</span>}
          </div>
          <span style={{fontSize:13,fontWeight:600,color:showActual?T.green:T.textSub}}>
            {showActual?"Showing Actual Column":"Show Actual Column"}
          </span>
        </div>
        {showActual&&<div onClick={()=>up("useActualProfit",!f.useActualProfit)}
          style={{display:"inline-flex",alignItems:"center",gap:10,background:f.useActualProfit?T.gold+"22":T.bg,border:`1.5px solid ${f.useActualProfit?T.gold:T.border}`,borderRadius:20,padding:"7px 18px",cursor:"pointer"}}>
          <div style={{width:18,height:18,borderRadius:9,background:f.useActualProfit?T.gold:"#ccc",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            {f.useActualProfit&&<span style={{color:"#fff",fontSize:12,lineHeight:1}}>✓</span>}
          </div>
          <span style={{fontSize:13,fontWeight:600,color:f.useActualProfit?T.gold:T.textSub}}>
            {f.useActualProfit?"Using Actual in Portfolio":"Use Actual in Portfolio"}
          </span>
        </div>}
      </div>
      {f.useActualProfit&&<div style={{textAlign:"center",fontSize:12,color:T.gold,marginBottom:14,marginTop:-12}}>Actual net profit now feeds Portfolio Overview totals · projected numbers shown faded for reference</div>}

      <div style={{maxWidth:showActual?900:520,margin:"0 auto"}}>
        <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden"}}>

          {/* Column headers */}
          <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderBottom:`1px solid ${T.border}`,background:"#FAFAFA"}}>
            <div style={{padding:isMobile?"12px 12px":"12px 18px",fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.06em"}}>Line Item</div>
            <div style={{padding:isMobile?"12px 8px":"12px 14px",fontSize:11,fontWeight:700,color:T.blue,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Projected</div>
            {showActual&&<div style={{padding:isMobile?"12px 8px":"12px 14px",fontSize:11,fontWeight:700,color:T.green,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Actual</div>}
          </div>

          {/* ── Transaction Dates (only matters for actual, but shown when actual is on) ── */}
          {showActual&&(<>
            <RowHdr label="Transaction Dates" color={T.purple} showActual={showActual}/>
            <DateGridRow label="Purchase Date" value={f.purchaseDate} onChange={v=>up("purchaseDate",v)} showActual={showActual}/>
            <DateGridRow label="Sell Date" value={f.sellingDate} onChange={v=>up("sellingDate",v)} showActual={showActual}/>
            {f.purchaseDate&&f.sellingDate&&(
              <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderTop:`1px solid ${T.border}`,background:T.goldLight}}>
                <div style={{padding:isMobile?"9px 12px":"9px 18px",fontSize:13,fontWeight:600,color:T.gold}}>Hold Period</div>
                <div style={{padding:isMobile?"9px 8px":"9px 14px",fontSize:13,fontWeight:600,color:T.gold,textAlign:"right"}}>{holdPeriodMonths} mo</div>
                <div style={{padding:isMobile?"9px 8px":"9px 14px",fontSize:13,fontWeight:700,color:T.gold,textAlign:"right"}}>{actualHoldMonths} mo</div>
              </div>
            )}
          </>)}

          {/* ── Acquisition & Costs ── */}
          <RowHdr label="Acquisition & Costs" color={T.gold} showActual={showActual}/>
          <EditGridRow label="Purchase Price" pVal={n(f.purchasePrice)} pEdit={v=>up("purchasePrice",v)}
            aVal={f.actualPurchasePrice} aEdit={v=>up("actualPurchasePrice",v)} showActual={showActual} dimP={f.useActualProfit}/>
          <PopupGridRow label="Buying Costs" pVal={buyingTotal} onOpenP={()=>setShowBuying(true)}
            aVal={f.actualBuyingCosts} aEdit={v=>up("actualBuyingCosts",v)} showActual={showActual} dimP={f.useActualProfit}/>
          <EditGridRow label="Rehab Costs" pVal={n(f.rehabCosts)} pEdit={v=>up("rehabCosts",v)}
            aVal={f.actualRehabCosts} aEdit={v=>up("actualRehabCosts",v)} showActual={showActual} dimP={f.useActualProfit}/>
          <PopupGridRow label="Holding Costs" pVal={holdingTotal} onOpenP={()=>setShowHolding(true)}
            aVal={f.actualHoldingCosts} aEdit={v=>up("actualHoldingCosts",v)} showActual={showActual} dimP={f.useActualProfit}/>
          <TotalGridRow label="Total Costs" pVal={totalCosts} aVal={showActual&&acCosts!==0?acCosts:null} showActual={showActual} dimP={f.useActualProfit}/>

          {/* ── Financing ── */}
          <RowHdr label="Financing" color={T.blue} showActual={showActual}/>
          <EditGridRow label="Hold Period" pVal={f.holdPeriod||"0"} pEdit={v=>up("holdPeriod",v.replace(/[^\d.]/g,""))}
            aVal={null} showActual={showActual} readOnlyActual suffix="months" dimP={f.useActualProfit}/>
          <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderTop:`1px solid ${T.border}`}}>
            <div onClick={()=>setShowFinancingP(true)} style={{padding:isMobile?"11px 12px":"11px 18px",fontSize:14,color:f.useActualProfit?T.textTert:T.text,cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.parentElement.style.background="#FAFAFA"} onMouseLeave={e=>e.currentTarget.parentElement.style.background="transparent"}>
              Financing Details
            </div>
            <div onClick={()=>setShowFinancingP(true)} style={{padding:isMobile?"11px 8px":"11px 14px",fontSize:13,color:f.useActualProfit?T.textTert:T.blue,fontWeight:500,textAlign:"right",cursor:"pointer"}}>
              HM {fmtD(liveHmTotal)} · Gap {fmtD(equityRequired)} ›
            </div>
            {showActual&&<div onClick={()=>setShowActualFinancing(true)} style={{padding:isMobile?"11px 8px":"11px 14px",fontSize:13,color:T.green,fontWeight:500,textAlign:"right",cursor:"pointer"}}>
              {f.acHmLoanAmt||f.acGapLoanAmt?`HM ${fmtD(acHmLoanAmt)} · Gap ${fmtD(acGapLoanAmt)} ›`:"Tap to enter ›"}
            </div>}
          </div>
          <TotalGridRow label="Total Debt Service" pVal={debtService} aVal={showActual&&(f.acHmLoanAmt||f.acGapLoanAmt)?acDebt:null} showActual={showActual} color={T.gold} dimP={f.useActualProfit}/>

          {/* ── Revenue ── */}
          <RowHdr label="Revenue" color={T.green} showActual={showActual}/>
          <EditGridRow label="Sale Price" pVal={n(f.salePrice)} pEdit={v=>up("salePrice",v)}
            aVal={f.actualSalePrice} aEdit={v=>up("actualSalePrice",v)} showActual={showActual} dimP={f.useActualProfit}/>

          {/* ── Selling Costs ── */}
          <RowHdr label="Selling Costs" color={T.red} showActual={showActual}/>
          <PopupGridRow label="Commission + Transfer Tax" pVal={sellingTotal} onOpenP={()=>setShowSelling(true)}
            aVal={acSelling} onOpenA={()=>setShowActualSelling(true)} showActual={showActual} aIsPopup dimP={f.useActualProfit}/>

          {/* ── Net Profit ── */}
          <div style={{display:"grid",gridTemplateColumns:finCols(showActual,isMobile),borderTop:`2px solid ${netProfit>=0?T.green:T.red}`,background:netProfit>=0?"#EDFBF1":"#FFF0EF"}}>
            <div style={{padding:isMobile?"15px 12px":"15px 18px",fontSize:15,fontWeight:700,color:f.useActualProfit?T.textTert:(netProfit>=0?T.green:T.red)}}>Net Profit</div>
            <div style={{padding:isMobile?"15px 8px":"15px 14px",fontSize:isMobile?15:17,fontWeight:800,color:f.useActualProfit?T.textTert:(netProfit>=0?T.green:T.red),textAlign:"right"}}>{fmtD(netProfit)}</div>
            {showActual&&<div style={{padding:isMobile?"15px 8px":"15px 14px",fontSize:isMobile?15:17,fontWeight:800,color:acSalePrice>0?(acNet>=0?T.green:T.red):T.textTert,textAlign:"right"}}>{acSalePrice>0?fmtD(acNet):"—"}</div>}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Property Detail ──────────────────────────────────────────────────────────
const PTABS=["Financial Overview","QuickBooks","Property Info","Tasks","Contacts","Files","Showings"];

// ─── Showings tab — pull ShowingTime calendar feed, match to this property ─────
function showingMatchesProperty(text,p){
  const a=`${p.address||""} ${p.city||""}`;
  const hn=qbHouseNum(a),thn=qbHouseNum(text||"");
  if(!hn||!thn||hn!==thn)return false;
  const words=new Set(qbStreetWords(a));
  return qbStreetWords(text||"").some(w=>words.has(w));
}
function fmtShowingTime(s){
  if(!s)return "";
  const d=new Date(s);
  if(isNaN(d.getTime()))return s;
  return d.toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
}
// A showing's phone field may contain more than one number — split them out so each
// gets its own call / text actions.
const parseShowingPhones=(raw)=>String(raw||"").split(/[,/;]|\bor\b/i).map(x=>x.trim()).filter(x=>x.replace(/[^\d]/g,"").length>=7);
const showingFirstName=(name)=>{const n=(name||"").trim().split(/\s+/)[0];return n||"there";};
// The two text-message templates (auto-fill the agent's first name + the address).
function showingMessage(kind,agentName,address){
  const fn=showingFirstName(agentName);
  if(kind==="followup")
    return `Hey ${fn}, Eli again — just following up to see your client's interest and whether we can expect an offer. Thanks!`;
  return `Hi ${fn}, Eli from Goldstone Properties. I believe you showed your client ${address}. I'm actually the owner of the property — Esther is my full-time employee. Just wanted to touch base and see how the showing went.`;
}
const showingSms=(phone,body)=>{
  const clean=(phone||"").replace(/[^\d+]/g,"");
  const sep=(typeof navigator!=="undefined"&&/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent))?"&":"?"; // iOS wants &body=
  return `sms:${clean}${sep}body=${encodeURIComponent(body)}`;
};
// Lead disposition for a showing agent, ranked hottest → coldest (unset sorts last).
const SHOWING_LEADS=[
  {key:"offer",label:"🔥 Expecting an offer",short:"Expecting offer",color:"#15803D",bg:"#EDFBF1"},
  {key:"interest",label:"Expressed interest",short:"Interested",color:"#B45309",bg:"#FEF3C7"},
  {key:"not",label:"Not interested",short:"Not interested",color:"#B91C1C",bg:"#FEE2E2"},
];
const showingLeadRank=(k)=>{const i=SHOWING_LEADS.findIndex(x=>x.key===k);return i<0?99:i;};
const showingKey=(s)=>String(s.uid||`${s.ts||""}-${s.summary||s.start||""}`);
// Renders one property's showings from an already-loaded feed: upcoming + past
// (past ranked by lead disposition), each row with call/text templates. Shared by
// the per-property Showings tab and the top-level Showings page.
function PropertyShowings({property,showings,onUpdate,flush}){
  const all=showings||[];
  const address=`${property.address}${property.city?`, ${property.city}`:""}`;
  const leadMap=property.showingLeads||{};
  const customLeads=property.customLeads||[];
  // Persist right away (don't wait on the debounced sync) so a lead never gets lost
  // if the app is refreshed/backgrounded moments later.
  const saveNow=()=>{if(flush)setTimeout(flush,0);};
  const setLead=(s,val)=>{const next={...leadMap};if(val)next[showingKey(s)]=val;else delete next[showingKey(s)];onUpdate(property.id,"showingLeads",next);saveNow();};
  const[hideNot,setHideNot]=useState(()=>{try{return localStorage.getItem("gs_hideNotInterested")==="1";}catch{return false;}});
  const toggleHide=()=>setHideNot(v=>{const n=!v;try{localStorage.setItem("gs_hideNotInterested",n?"1":"0");}catch{}return n;});
  const mine=all.filter(s=>showingMatchesProperty(s.location||s.summary||"",property)).map(s=>({...s,ts:s.start?new Date(s.start).getTime():0}));
  const cutoff=Date.now()-3600000;
  const upcoming=mine.filter(s=>s.ts>=cutoff).sort((a,b)=>a.ts-b.ts);
  const past=mine.filter(s=>s.ts<cutoff).sort((a,b)=>{
    const ra=showingLeadRank(leadMap[showingKey(a)]),rb=showingLeadRank(leadMap[showingKey(b)]);
    return ra!==rb?ra-rb:b.ts-a.ts;
  });
  const[showAdd,setShowAdd]=useState(false);
  const[draft,setDraft]=useState({name:"",phone:""});
  const addLead=()=>{const name=draft.name.trim(),phone=draft.phone.trim();if(!name&&!phone)return;onUpdate(property.id,"customLeads",[...customLeads,{id:Date.now(),name,phone,at:new Date().toISOString(),lead:""}]);setDraft({name:"",phone:""});setShowAdd(false);saveNow();};
  const removeLead=(id)=>{onUpdate(property.id,"customLeads",customLeads.filter(l=>l.id!==id));saveNow();};
  const setCustomStatus=(id,val)=>{onUpdate(property.id,"customLeads",customLeads.map(l=>l.id===id?{...l,lead:val}:l));saveNow();};
  const actBtn={display:"inline-flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:T.radiusSm,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit",textDecoration:"none",whiteSpace:"nowrap"};
  const leadSelect=(value,onChange,lead)=>(
    <select value={value} onChange={onChange} style={{padding:"5px 9px",borderRadius:20,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",outline:"none",border:`1px solid ${lead?lead.color:T.border}`,background:lead?lead.bg:"#fff",color:lead?lead.color:T.textSub}}>
      <option value="">Set lead status…</option>
      {SHOWING_LEADS.map(l=><option key={l.key} value={l.key}>{l.short}</option>)}
    </select>
  );
  // Actions for one phone number — plain Text (no template) + the two templates.
  const phoneActions=(ph,name)=>(
    <div style={{marginTop:8}}>
      <div style={{fontSize:12,color:T.textSub,marginBottom:5}}>{ph}</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <a href={`tel:${ph.replace(/[^\d+]/g,"")}`} style={{...actBtn,background:"#fff",border:`1px solid ${T.border}`,color:T.textSub}}>📞 Call</a>
        <a href={`sms:${ph.replace(/[^\d+]/g,"")}`} style={{...actBtn,background:"#EDFBF1",border:`1px solid ${T.green}`,color:"#15803D"}}>💬 Text</a>
        <a href={showingSms(ph,showingMessage("initial",name,address))} style={{...actBtn,background:T.goldLight,border:`1px solid ${T.gold}`,color:"#b8912e"}}>Initial</a>
        <a href={showingSms(ph,showingMessage("followup",name,address))} style={{...actBtn,background:"#EBF4FF",border:`1px solid ${T.blue}`,color:T.blue}}>Follow-up</a>
      </div>
    </div>
  );
  const Row=(s)=>{
    const phones=parseShowingPhones(s.phone);
    const leadKey=leadMap[showingKey(s)]||"";
    const lead=SHOWING_LEADS.find(l=>l.key===leadKey);
    return(
    <div key={s.uid||s.ts+s.summary} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"11px 16px",borderTop:`1px solid ${T.border}`,background:lead?lead.bg+"66":"transparent"}}>
      <div style={{width:7,height:7,borderRadius:4,background:/cancel|declin/i.test(s.status)?T.red:T.green,flexShrink:0,marginTop:5}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:14,fontWeight:600,color:T.text}}>{fmtShowingTime(s.start)}</div>
        {(s.agent||phones.length>0)&&(
          <div style={{fontSize:13,color:T.text,marginTop:2}}>
            {s.agent&&<span style={{fontWeight:500}}>{s.agent}</span>}
            {s.broker&&<span style={{color:T.textSub}}> · {s.broker}</span>}
          </div>
        )}
        {s.email&&<div><a href={`mailto:${s.email}`} style={{fontSize:12,color:T.textSub,textDecoration:"none"}}>{s.email}</a></div>}
        <div style={{marginTop:8}}>{leadSelect(leadKey,e=>setLead(s,e.target.value),lead)}</div>
        {phones.map((ph,i)=><div key={i}>{phoneActions(ph,s.agent)}</div>)}
        {!s.agent&&phones.length===0&&<div style={{fontSize:12,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.summary||s.location}</div>}
      </div>
      {s.status&&<span style={{fontSize:10,fontWeight:700,color:T.textTert,textTransform:"uppercase",flexShrink:0,marginTop:3}}>{s.status}</span>}
    </div>
    );
  };
  const LeadRow=(l)=>{
    const lead=SHOWING_LEADS.find(x=>x.key===l.lead);
    const phones=parseShowingPhones(l.phone);
    return(
    <div key={l.id} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"11px 16px",borderTop:`1px solid ${T.border}`,background:lead?lead.bg+"66":"transparent"}}>
      <div style={{width:7,height:7,borderRadius:4,background:T.gold,flexShrink:0,marginTop:5}}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:14,fontWeight:600,color:T.text}}>{l.name||"(no name)"}</div>
        <div style={{marginTop:8}}>{leadSelect(l.lead||"",e=>setCustomStatus(l.id,e.target.value),lead)}</div>
        {phones.map((ph,i)=><div key={i}>{phoneActions(ph,l.name)}</div>)}
        {phones.length===0&&<div style={{fontSize:12,color:T.textTert,marginTop:6}}>No phone number.</div>}
      </div>
      <button onClick={()=>removeLead(l.id)} title="Remove lead" style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0}}>×</button>
    </div>
    );
  };
  const inpS={width:"100%",padding:"9px 11px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  const notNot=(leadKey)=>!hideNot||leadKey!=="not";
  const upcomingShown=upcoming.filter(s=>notNot(leadMap[showingKey(s)]));
  const pastShown=past.filter(s=>notNot(leadMap[showingKey(s)]));
  const leadsShown=customLeads.filter(l=>notNot(l.lead));
  const hiddenCount=(past.length-pastShown.length)+(customLeads.length-leadsShown.length)+(upcoming.length-upcomingShown.length);
  return(<>
    <label style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:12.5,color:T.textSub,cursor:"pointer"}}>
      <input type="checkbox" checked={hideNot} onChange={toggleHide} style={{width:16,height:16,cursor:"pointer",accentColor:T.gold}}/>
      Hide "not interested" leads{hideNot&&hiddenCount>0?` (${hiddenCount} hidden)`:""}
    </label>
    {upcomingShown.length>0&&<Card style={{marginBottom:12}}><GHeader label="Upcoming"/>{upcomingShown.map(Row)}</Card>}
    {pastShown.length>0&&<Card style={{marginBottom:12}}><GHeader label="Past"/>{pastShown.slice(0,40).map(Row)}</Card>}
    {mine.length===0&&<Card style={{marginBottom:12}}><div style={{padding:"18px 16px",textAlign:"center",color:T.textTert,fontSize:13}}>No showings matched this property's address yet.</div></Card>}
    {/* Custom leads you add by hand */}
    <Card>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px 10px"}}>
        <div style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.06em"}}>Leads you added</div>
        {!showAdd&&<button onClick={()=>setShowAdd(true)} style={{padding:"5px 12px",borderRadius:20,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>+ Add lead</button>}
      </div>
      {showAdd&&(
        <div style={{padding:"6px 16px 12px",display:"flex",flexDirection:"column",gap:8,borderTop:`1px solid ${T.border}`}}>
          <input autoFocus value={draft.name} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} placeholder="Name (agent or buyer)" style={inpS}/>
          <input value={draft.phone} onChange={e=>setDraft(d=>({...d,phone:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addLead()} placeholder="Phone number" inputMode="tel" style={inpS}/>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>{setShowAdd(false);setDraft({name:"",phone:""});}} style={{padding:"8px 14px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>Cancel</button>
            <button onClick={addLead} disabled={!draft.name.trim()&&!draft.phone.trim()} style={{padding:"8px 18px",borderRadius:T.radiusSm,background:(draft.name.trim()||draft.phone.trim())?T.gold:T.border,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>Add lead</button>
          </div>
        </div>
      )}
      {customLeads.length===0&&!showAdd&&<div style={{padding:"6px 16px 16px",fontSize:12.5,color:T.textTert}}>Add a lead to call or text a buyer/agent who isn't in your ShowingTime feed.</div>}
      {leadsShown.map(LeadRow)}
    </Card>
  </>);
}
// Count showings from the feed that match a property (used for headers/sorting).
const matchedShowings=(showings,p)=>(showings||[]).filter(s=>showingMatchesProperty(s.location||s.summary||"",p)).map(s=>({...s,ts:s.start?new Date(s.start).getTime():0}));
function ShowingsTab({property,onUpdate}){
  const { isAdmin }=useAuth();
  const { flushProps }=useData();
  const[status,setStatus]=useState(null);
  const[showings,setShowings]=useState(null);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[urlInput,setUrlInput]=useState("");
  const[saving,setSaving]=useState(false);

  useEffect(()=>{qbAuthFetch("/api/showings/status").then(setStatus).catch(()=>setStatus({configured:false}));},[]);
  const load=useCallback(()=>{setLoading(true);setError("");qbAuthFetch("/api/showings").then(d=>setShowings(d.showings||[])).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
  useEffect(()=>{if(status&&status.configured)load();},[status,load]);

  const save=async()=>{
    if(!urlInput.trim())return;setSaving(true);setError("");
    try{await qbAuthFetch("/api/showings/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({icsUrl:urlInput.trim()})});setStatus({configured:true});}
    catch(e){setError(e.message);}
    setSaving(false);
  };

  const wrap={padding:24,maxWidth:680,margin:"0 auto"};
  const btn={padding:"9px 16px",borderRadius:T.radiusSm,border:"none",background:T.gold,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"};

  if(!status) return <div style={{...wrap,color:T.textSub,fontSize:14}}>Loading…</div>;

  if(!status.configured) return(
    <div style={wrap}>
      <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>Connect ShowingTime</div>
      <div style={{fontSize:13,color:T.textSub,marginBottom:14,lineHeight:1.5}}>Paste your ShowingTime <strong>Calendar Sync Link</strong> (in ShowingTime: Profile → Calendar Sync → Sync Now). This connects showings for <em>all</em> your properties — you only do it once.</div>
      {!isAdmin
        ?<div style={{fontSize:13,color:T.textTert}}>Ask an admin to connect ShowingTime.</div>
        :(<>
          <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} placeholder="webcal://showingti.me/cal/…"
            style={{width:"100%",padding:"11px 13px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:12}}/>
          <button onClick={save} disabled={saving} style={btn}>{saving?"Connecting…":"Connect"}</button>
        </>)}
      {error&&<div style={{marginTop:12,color:T.red,fontSize:13}}>{error}</div>}
    </div>
  );

  const all=showings||[];
  const mineCount=matchedShowings(all,property).length;
  return(
    <div style={wrap}>
      <div style={{display:"flex",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:13,color:T.textSub}}>{mineCount} showing{mineCount!==1?"s":""} for this property <span style={{color:T.textTert}}>· {all.length} in feed</span></div>
        <button onClick={load} style={{marginLeft:"auto",padding:"7px 14px",borderRadius:T.radiusSm,background:T.goldLight,color:T.gold,border:`1px solid ${T.gold}`,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>↻ Refresh</button>
      </div>
      {loading&&<div style={{color:T.textSub,fontSize:14,padding:12}}>Loading showings…</div>}
      {error&&<div style={{marginBottom:12,padding:"10px 12px",background:"#FFF0EF",border:`1px solid ${T.red}`,borderRadius:T.radiusSm,color:T.red,fontSize:13}}>{error}</div>}
      <PropertyShowings property={property} showings={all} onUpdate={onUpdate} flush={flushProps}/>
      {mineCount>0&&<div style={{marginTop:12,fontSize:12,color:T.textTert,textAlign:"center"}}>Live from ShowingTime · matched by address</div>}
    </div>
  );
}
// ─── Showings page — every on-market property's showings in one schedule ───────
function ShowingsPage(){
  const { sharedProps, setSharedProps, flushProps }=useData();
  const { isAdmin }=useAuth();
  const isMobile=useIsMobile();
  const[status,setStatus]=useState(null);
  const[showings,setShowings]=useState(null);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[urlInput,setUrlInput]=useState("");
  const[saving,setSaving]=useState(false);
  const[selId,setSelId]=useState(null);
  const[search,setSearch]=useState("");
  const[showConn,setShowConn]=useState(false);
  const[copied,setCopied]=useState(false);
  useEffect(()=>{qbAuthFetch("/api/showings/status").then(setStatus).catch(()=>setStatus({configured:false}));},[]);
  const load=useCallback(()=>{setLoading(true);setError("");qbAuthFetch("/api/showings").then(d=>setShowings(d.showings||[])).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);
  useEffect(()=>{if(status&&status.configured)load();},[status,load]);
  const save=async()=>{
    if(!urlInput.trim())return;setSaving(true);setError("");
    try{await qbAuthFetch("/api/showings/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({icsUrl:urlInput.trim()})});setStatus({configured:true});}
    catch(e){setError(e.message);}
    setSaving(false);
  };
  const onUpdate=(id,key,val)=>setSharedProps(prev=>prev.map(p=>p.id===id?{...p,[key]:val}:p));

  const wrap={padding:"18px 16px 40px",maxWidth:600,margin:"0 auto",width:"100%",boxSizing:"border-box"};
  if(!status) return <div style={{...wrap,color:T.textSub,fontSize:14}}>Loading…</div>;
  if(!status.configured) return(
    <div style={wrap}>
      <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>Connect ShowingTime</div>
      <div style={{fontSize:13,color:T.textSub,marginBottom:14,lineHeight:1.5}}>Paste your ShowingTime <strong>Calendar Sync Link</strong> (in ShowingTime: Profile → Calendar Sync → Sync Now). This connects showings for <em>all</em> your properties — you only do it once.</div>
      {!isAdmin
        ?<div style={{fontSize:13,color:T.textTert}}>Ask an admin to connect ShowingTime.</div>
        :(<>
          <input value={urlInput} onChange={e=>setUrlInput(e.target.value)} placeholder="webcal://showingti.me/cal/…"
            style={{width:"100%",padding:"11px 13px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",marginBottom:12}}/>
          <button onClick={save} disabled={saving} style={{padding:"9px 16px",borderRadius:T.radiusSm,border:"none",background:T.gold,color:"#fff",fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{saving?"Connecting…":"Connect"}</button>
        </>)}
      {error&&<div style={{marginTop:12,color:T.red,fontSize:13}}>{error}</div>}
    </div>
  );

  const all=showings||[];
  const cutoff=Date.now()-3600000;
  const rows=sharedProps.filter(p=>!p.archived&&(p.status==="On Market"||p.status==="In Closing"))
    .map(p=>{
      const mine=matchedShowings(all,p);
      const upTs=mine.filter(s=>s.ts>=cutoff).map(s=>s.ts).sort((a,b)=>a-b);
      return {p,total:mine.length,upcoming:upTs.length,next:upTs[0]??Infinity};
    })
    .sort((a,b)=>a.next-b.next||b.total-a.total||a.p.address.localeCompare(b.p.address));
  const totalUpcoming=rows.reduce((n,x)=>n+x.upcoming,0);
  const q=search.toLowerCase();
  const list=rows.filter(x=>(x.p.address+" "+(x.p.city||"")).toLowerCase().includes(q));
  // Effective selection: honor a tapped property, else default to the first on desktop.
  const selMeta=(selId&&list.find(x=>x.p.id===selId))||(!isMobile?list[0]:null)||null;
  const sel=selMeta?.p||null;
  const iS={width:"100%",padding:"7px 10px 7px 28px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};

  return(
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* Left: property list */}
      <div style={{width:isMobile?"100%":340,flexShrink:0,display:isMobile&&sel?"none":"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${T.border}`,background:T.card,overflow:"hidden"}}>
        <div style={{padding:"14px 14px 10px",borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontWeight:700,fontSize:15,color:T.text}}>Showings</div>
              <div style={{fontSize:11.5,color:T.textSub,marginTop:1}}>{totalUpcoming} upcoming · {rows.length} on market</div>
            </div>
            <button onClick={load} title="Refresh" style={{padding:"6px 12px",borderRadius:T.radiusSm,background:T.goldLight,color:T.gold,border:`1px solid ${T.gold}`,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>↻</button>
          </div>
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:T.textTert,fontSize:14,pointerEvents:"none"}}>⌕</span>
            <input placeholder="Search properties…" value={search} onChange={e=>setSearch(e.target.value)} style={iS}/>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {loading&&<div style={{padding:16,color:T.textSub,fontSize:13}}>Loading showings…</div>}
          {error&&<div style={{margin:12,padding:"10px 12px",background:"#FFF0EF",border:`1px solid ${T.red}`,borderRadius:T.radiusSm,color:T.red,fontSize:12.5}}>{error}</div>}
          {!loading&&list.length===0&&<div style={{padding:24,textAlign:"center",color:T.textTert,fontSize:13}}>{rows.length===0?"No properties are on market.":"No matches."}</div>}
          {list.map(({p,total,upcoming})=>{
            const active=sel&&sel.id===p.id;
            const addr=`${p.address}${p.city?`, ${p.city}`:""}`;
            const sc=SC[p.status]||{};
            return(
              <div key={p.id} onClick={()=>setSelId(p.id)} style={{padding:"11px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,background:active?T.goldLight:"transparent",borderLeft:active?`3px solid ${T.gold}`:"3px solid transparent"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{flex:1,minWidth:0,fontWeight:active?700:600,fontSize:13,color:active?T.gold:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{addr}</span>
                  {upcoming>0&&<span style={{minWidth:18,height:18,padding:"0 5px",borderRadius:9,background:T.gold,color:"#fff",fontSize:10.5,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{upcoming}</span>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginTop:3}}>
                  {p.status&&<span style={{fontSize:9,fontWeight:700,color:sc.color,background:sc.bg,padding:"2px 7px",borderRadius:20}}>{p.status}</span>}
                  <span style={{fontSize:11,color:T.textSub}}>{upcoming>0?`${upcoming} upcoming`:total>0?"No upcoming":"No showings yet"}{total>0?` · ${total} total`:""}</span>
                </div>
              </div>
            );
          })}
        </div>
        {isAdmin&&status.configured&&(
          <div style={{padding:"10px 14px",borderTop:`1px solid ${T.border}`,fontSize:11,color:T.textTert,flexShrink:0}}>
            <div style={{display:"flex",gap:12,alignItems:"center"}}>
              <span style={{color:T.green,fontWeight:600}}>● ShowingTime connected</span>
              {status.icsUrl&&<span onClick={()=>setShowConn(v=>!v)} style={{color:T.blue,cursor:"pointer",fontWeight:600}}>{showConn?"Hide link":"Show link"}</span>}
              <span onClick={()=>{setStatus({configured:false});setShowConn(false);}} style={{color:T.blue,cursor:"pointer",fontWeight:600}}>Change</span>
            </div>
            {showConn&&status.icsUrl&&(
              <div style={{marginTop:8,display:"flex",gap:6,alignItems:"center"}}>
                <input readOnly value={status.icsUrl} onFocus={e=>e.target.select()} style={{flex:1,minWidth:0,fontSize:11,padding:"7px 9px",border:`1px solid ${T.border}`,borderRadius:8,background:T.bg,color:T.text,outline:"none",fontFamily:"inherit"}}/>
                <button onClick={()=>{if(navigator.clipboard)navigator.clipboard.writeText(status.icsUrl).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);});}} style={{padding:"7px 12px",borderRadius:8,background:copied?T.green:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:11,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>{copied?"✓":"Copy"}</button>
              </div>
            )}
          </div>
        )}
      </div>
      {/* Right: selected property's showings */}
      <div style={{flex:1,display:isMobile&&!sel?"none":"flex",flexDirection:"column",overflow:"hidden",background:T.bg}}>
        {sel?(()=>{
          const sc=SC[sel.status]||{};
          const addr=`${sel.address}${sel.city?`, ${sel.city}`:""}`;
          return(
            <>
              <div style={{padding:"12px 16px",background:T.card,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                {isMobile&&<button onClick={()=>setSelId(null)} style={{background:"none",border:"none",color:T.gold,fontWeight:600,fontSize:15,cursor:"pointer",fontFamily:"inherit",padding:"2px 4px",flexShrink:0}}>‹</button>}
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:15,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{addr}</div>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2}}>
                    {sel.status&&<span style={{fontSize:9.5,fontWeight:700,color:sc.color,background:sc.bg,padding:"2px 8px",borderRadius:20}}>{sel.status}</span>}
                    <span style={{fontSize:11.5,color:T.textSub}}>{selMeta.upcoming} upcoming · {selMeta.total} total</span>
                  </div>
                </div>
                <button onClick={load} title="Refresh" style={{padding:"7px 14px",borderRadius:T.radiusSm,background:T.goldLight,color:T.gold,border:`1px solid ${T.gold}`,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>↻ Refresh</button>
              </div>
              <div style={{flex:1,overflowY:"auto",padding:"14px 16px"}}>
                <PropertyShowings key={sel.id} property={sel} showings={all} onUpdate={onUpdate} flush={flushProps}/>
                <div style={{marginTop:12,fontSize:12,color:T.textTert,textAlign:"center"}}>Live from ShowingTime · matched by address</div>
              </div>
            </>
          );
        })():(
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:T.textSub}}>
            <div style={{width:64,height:64,borderRadius:18,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>👁️</div>
            <div style={{fontSize:16,fontWeight:600}}>Select a property</div>
            <div style={{fontSize:13,color:T.textTert}}>Choose a property to see its showings</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── QuickBooks tab — map a property to its QB project, view P&L, import actuals ─
// Heuristic bucketing of expense accounts into the app's Actual fields.
function qbBucket(name){
  const s=(name||"").toLowerCase();
  const has=(...k)=>k.some(x=>s.includes(x));
  if(has("purchase","acquisition","property cost"))return "purchase";
  if(has("rehab","construction","renov","repair","improvement","contractor","material","labor","demo"))return "rehab";
  // Debt service / financing — kept in its OWN bucket (never lumped into buying) and
  // never imported, because the app computes debt service from its own formula.
  if(has("debt","interest","financ","loan","principal","amortiz","points","origination","lender","mortgage","note payment","p&i"))return "debt";
  if(has("holding","carry","utilit","property tax","insurance"))return "holding";
  if(has("commission","realtor","selling","staging","marketing","disposition","broker"))return "selling";
  if(has("buying","closing","title","escrow","recording","transfer tax","attorney","legal","inspection","appraisal","survey"))return "buying";
  return "buying"; // default other expenses into buying/misc
}

// ─── Address ↔ QuickBooks-project matching ──────────────────────────────────
// Street-type words + directionals + unit markers we ignore when comparing an
// address to a QuickBooks project name (names are rarely formatted identically).
const QB_STOP=new Set(["st","street","ave","avenue","rd","road","dr","drive","ln","lane","ct","court","blvd","boulevard","pl","place","ter","terrace","way","cir","circle","hwy","highway","pkwy","parkway","sq","square","trl","trail","apt","unit","ste","suite","fl","floor","n","s","e","w","north","south","east","west"]);
const qbNorm=(s)=>(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const qbTokens=(s)=>qbNorm(s).split(" ").filter(Boolean);
const qbHouseNum=(s)=>{const m=qbNorm(s).match(/\b(\d+)\b/);return m?m[1]:null;};
const qbStreetWords=(s)=>qbTokens(s).filter(t=>!/^\d+$/.test(t)&&!QB_STOP.has(t));
// Score 0..1 for how well a property address matches a QB project name.
function qbMatchScore(address,name){
  const addr=qbNorm(address),nm=qbNorm(name);
  if(!addr||!nm)return 0;
  let score=0;
  const an=qbHouseNum(address),pn=qbHouseNum(name);
  if(an&&pn&&an===pn)score+=0.5;                       // same house number = strong signal
  const aw=qbStreetWords(address),nw=new Set(qbTokens(name));
  if(aw.length){
    const hits=aw.filter(w=>nw.has(w)).length;
    score+=0.5*(hits/aw.length);                        // street-word overlap
  }
  const street=aw.join(" ");
  if(street&&nm.includes(street))score=Math.max(score,0.85); // full street contained
  return Math.min(1,score);
}
// Confidence label for a match score, shown next to suggested projects.
const qbConfidence=(s)=>s>=0.85?"High match":s>=0.6?"Likely match":"Possible match";
// In-app support contact — shown on the QuickBooks tab so users can reach us for help.
const SUPPORT_EMAIL="elihassan16@gmail.com";
function QbSupport(){
  return(
    <div style={{fontSize:12,color:"#888"}}>
      Need help with QuickBooks? <a href={`mailto:${SUPPORT_EMAIL}?subject=Goldstone%20QuickBooks%20support`} style={{color:"#b8912e",fontWeight:600}}>Contact support</a>
    </div>
  );
}
// Which breakdown lines get written into the Actual columns on Import / Auto-sync.
// A line is included unless the user has explicitly unchecked it, so existing
// properties (no saved selection) keep the old "import everything" behaviour.
const QB_IMPORT_KEYS=["income","purchase","buying","rehab","holding","selling"];
const qbImportSel=(property)=>{const saved=property.qbImportFields||{};return QB_IMPORT_KEYS.reduce((m,k)=>{m[k]=saved[k]!==false;return m;},{});};

function QuickBooksTab({property,onUpdate}){
  const isMobile=useIsMobile();
  const[status,setStatus]=useState(null);
  const[projects,setProjects]=useState(null);
  const[sel,setSel]=useState(property.qbProjectId||"");
  const[pnl,setPnl]=useState(null);
  const[txns,setTxns]=useState(null);        // transaction-level detail for drill-down
  const[openBucket,setOpenBucket]=useState("");// which cost bucket is expanded
  const[txSort,setTxSort]=useState("vendor"); // vendor | date | amount
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[flash,setFlash]=useState("");
  const autoSync=property.qbAutoSync===true; // default OFF — opt in per property to mirror Actuals to QuickBooks
  const importSel=qbImportSel(property);      // which breakdown lines feed the Actual columns
  const toggleImport=(key)=>onUpdate(property.id,"qbImportFields",{...importSel,[key]:!importSel[key]});
  const selCount=QB_IMPORT_KEYS.filter(k=>importSel[k]).length;
  const autoPicked=useRef(false);             // guard: only auto-select a project once
  const autoImported=useRef(null);            // guard: auto-import once per fresh P&L load

  useEffect(()=>{fetch("/api/quickbooks/status").then(r=>r.json()).then(setStatus).catch(()=>setStatus({configured:false,connected:false}));},[]);

  useEffect(()=>{
    if(!status?.connected||projects)return;
    qbAuthFetch("/api/quickbooks/projects").then(d=>setProjects(d.items||[])).catch(e=>setError(e.message));
  },[status,projects]);

  // Ranked suggested projects for this property's address (best first).
  const suggestions=useMemo(()=>{
    if(!projects)return [];
    return projects
      .map(p=>({...p,score:qbMatchScore(property.address,p.name)}))
      .filter(p=>p.score>=0.34)
      .sort((a,b)=>b.score-a.score)
      .slice(0,3);
  },[projects,property.address]);

  const pick=useCallback((id)=>{
    setSel(id);
    const p=(projects||[]).find(x=>x.id===id);
    onUpdate(property.id,"qbProjectId",id);
    onUpdate(property.id,"qbProjectName",p?.name||"");
  },[projects,property.id,onUpdate]);

  // Auto-select a project on first load only when we're highly confident.
  useEffect(()=>{
    if(property.qbProjectId||!projects||autoPicked.current)return;
    const best=suggestions[0];
    if(best&&best.score>=0.7){autoPicked.current=true;pick(best.id);setFlash(`✓ Auto-matched to "${best.name}" from your address.`);}
  },[projects,suggestions,property.qbProjectId,pick]);

  const loadPnl=useCallback((id)=>{
    if(!id)return;setLoading(true);setError("");setPnl(null);setTxns(null);setOpenBucket("");
    autoImported.current=null; // allow a fresh auto-sync for this load
    qbAuthFetch(`/api/quickbooks/pnl?customerId=${encodeURIComponent(id)}`).then(setPnl).catch(e=>setError(e.message)).finally(()=>setLoading(false));
    qbAuthFetch(`/api/quickbooks/transactions?customerId=${encodeURIComponent(id)}`).then(d=>setTxns(d.items||[])).catch(()=>setTxns([]));
  },[]);
  useEffect(()=>{if(sel)loadPnl(sel);},[sel,loadPnl]);

  const applyImport=useCallback((data,{auto}={})=>{
    if(!data)return;
    const f=property.financials||{};const b={purchase:0,rehab:0,buying:0,holding:0,debt:0,selling:0};
    (data.rows||[]).forEach(r=>{if(r.section==="Income")return;b[qbBucket(r.name)]+=r.amount;});
    const sel=qbImportSel(property);                 // only write the checked lines
    const ch={};
    // Only write a field when QuickBooks actually has a value (non-zero). A QuickBooks 0
    // (e.g. no sale recorded yet) must NEVER overwrite a number you already entered — that
    // was wiping the actual Sale Price on re-import / auto-sync. Negative totals (credits
    // you booked in QuickBooks) DO import, so a net credit shows as a negative actual.
    const put=(key,val)=>{if(val!==0)ch[key]=String(Math.round(val));};
    if(sel.income)  put("actualSalePrice",data.income||0);
    if(sel.purchase)put("actualPurchasePrice",b.purchase);
    if(sel.rehab)   put("actualRehabCosts",b.rehab);
    if(sel.buying)  put("actualBuyingCosts",b.buying);
    if(sel.holding&&b.holding!==0){ch.actualHoldingCosts=String(Math.round(b.holding));ch.actualHoldingCostItems=[];}
    if(sel.selling) put("actualSellingCosts",b.selling);
    // Debt service / interest is intentionally NOT imported — the app has its own formula.
    if(Object.keys(ch).length===0){
      if(!auto){
        const anyChecked=QB_IMPORT_KEYS.some(k=>sel[k]);
        setFlash(!anyChecked
          ?"No lines are checked to import — check the lines you want below, then Import again."
          :"QuickBooks returned $0 for every checked line on this project — nothing to import. Make sure the property is mapped to the right QuickBooks project and that its costs are tagged to that project.");
      }
      return;
    }
    ch.useActualProfit=true;
    onUpdate(property.id,"financials",{...f,...ch});
    setFlash(auto?"↻ Auto-synced the selected QuickBooks lines into your Actual columns.":"✓ Imported the selected lines into the Actual columns — check Financial Overview.");
  },[property.id,property.financials,property.qbImportFields,onUpdate]);
  const doImport=()=>applyImport(pnl,{auto:false});

  // Auto-sync: whenever fresh numbers load for a mapped project, mirror them into
  // the Actual columns (unless the user turned auto-sync off for this property).
  useEffect(()=>{
    if(!pnl||!sel||!autoSync)return;
    if(autoImported.current===sel)return;
    autoImported.current=sel;
    applyImport(pnl,{auto:true});
  },[pnl,sel,autoSync]);// eslint-disable-line

  // Cost-bucket totals from the P&L (already-correct signed amounts).
  const bucketTotals=useMemo(()=>{
    const b={purchase:0,buying:0,rehab:0,holding:0,debt:0,selling:0};
    (pnl?.rows||[]).forEach(r=>{if(r.section==="Income")return;b[qbBucket(r.name)]+=r.amount;});
    return b;
  },[pnl]);
  // Account names that are Income, so we don't file sale transactions under a cost bucket.
  const incomeAccts=useMemo(()=>new Set((pnl?.rows||[]).filter(r=>r.section==="Income").map(r=>(r.name||"").toLowerCase())),[pnl]);
  // Group each transaction into its bucket for the drill-down lists.
  const txByBucket=useMemo(()=>{
    const m={income:[],purchase:[],buying:[],rehab:[],holding:[],debt:[],selling:[]};
    (txns||[]).forEach(t=>{
      const k=incomeAccts.has((t.account||"").toLowerCase())?"income":qbBucket(t.account);
      (m[k]||m.buying).push(t);
    });
    return m;
  },[txns,incomeAccts]);
  const sortTx=useCallback((list)=>{
    const c=[...list];
    if(txSort==="vendor")c.sort((a,b)=>(a.vendor||"~").localeCompare(b.vendor||"~"));
    else if(txSort==="amount")c.sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount));
    else c.sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    return c;
  },[txSort]);
  // Fixed display order the user asked for (income first, then costs in order).
  const BUCKET_ROWS=[
    {key:"income",label:"Sale Price / Income",total:pnl?.income||0},
    {key:"purchase",label:"Purchase Price",total:bucketTotals.purchase},
    {key:"buying",label:"Buying Costs",total:bucketTotals.buying},
    {key:"rehab",label:"Rehab Costs",total:bucketTotals.rehab},
    {key:"holding",label:"Holding Costs",total:bucketTotals.holding},
    {key:"debt",label:"Debt Service / Interest",total:bucketTotals.debt,noImport:true},
    {key:"selling",label:"Selling Costs",total:bucketTotals.selling},
  ];

  const wrap={padding:24,maxWidth:680,margin:"0 auto"};
  if(!status)return <div style={{...wrap,color:T.textSub,fontSize:14}}>Loading…</div>;
  if(!status.configured)return <div style={{...wrap,color:T.textSub,fontSize:14}}>QuickBooks isn't set up yet.</div>;
  if(!status.connected)return(
    <div style={{...wrap,textAlign:"center"}}>
      <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>Connect QuickBooks</div>
      <div style={{fontSize:14,color:T.textSub,marginBottom:16}}>Link your QuickBooks company to see each project's numbers here.</div>
      <button onClick={()=>{window.location.href="/api/quickbooks/connect";}} style={{padding:"11px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:15,cursor:"pointer",fontFamily:"inherit"}}>Connect QuickBooks</button>
      <QbSupport/>
    </div>
  );

  const money=(v)=>fmtD(v);

  return(
    <div style={wrap}>
      {/* Project mapping */}
      <Card style={{marginBottom:16}}>
        <div style={{padding:"14px 16px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{fontSize:13,fontWeight:700,color:T.text}}>QuickBooks Project</div>
          <select value={sel} onChange={e=>pick(e.target.value)} style={{flex:1,minWidth:180,padding:"8px 10px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:13,fontFamily:"inherit",background:"#fff"}}>
            <option value="">— Select a project —</option>
            {(projects||[]).map(p=>{const sg=suggestions.find(s=>s.id===p.id);return <option key={p.id} value={p.id}>{sg?"★ ":""}{p.name}{p.isProject?"":" (customer)"}{sg?` — ${qbConfidence(sg.score)}`:""}</option>;})}
          </select>
          {sel&&<button onClick={()=>loadPnl(sel)} style={{padding:"8px 12px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,background:T.bg,color:T.textSub,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>↻</button>}
        </div>
        {!projects&&<div style={{padding:"0 16px 14px",fontSize:12,color:T.textTert}}>Loading projects…</div>}
        {/* Suggested matches — shown until a project is picked */}
        {projects&&!sel&&suggestions.length>0&&(
          <div style={{padding:"0 16px 14px"}}>
            <div style={{fontSize:12,fontWeight:700,color:T.textSub,marginBottom:8}}>Suggested match{suggestions.length>1?"es":""} for {property.address}</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {suggestions.map(s=>(
                <button key={s.id} onClick={()=>pick(s.id)} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"10px 12px",borderRadius:T.radiusSm,border:`1px solid ${s.score>=0.7?T.green:T.border}`,background:s.score>=0.7?"#EDFBF1":"#fff",cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                  <span style={{fontSize:13,fontWeight:600,color:T.text}}>{s.name}</span>
                  <span style={{fontSize:11,fontWeight:700,color:s.score>=0.7?T.green:T.textSub,whiteSpace:"nowrap"}}>{qbConfidence(s.score)} · Use →</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* Auto-sync toggle — mirror QuickBooks into Actual columns on every open */}
        {sel&&(
          <div style={{padding:"0 16px 14px",display:"flex",alignItems:"center",gap:8}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:T.textSub}}>
              <input type="checkbox" checked={autoSync} onChange={e=>onUpdate(property.id,"qbAutoSync",e.target.checked)} style={{cursor:"pointer"}}/>
              Auto-sync: automatically update the checked lines into Actuals every time this project loads
            </label>
          </div>
        )}
      </Card>

      {error&&<div style={{marginBottom:14,padding:"10px 12px",background:"#FFF0EF",border:`1px solid ${T.red}`,borderRadius:T.radiusSm,color:T.red,fontSize:13}}>
        <div style={{marginBottom:8,wordBreak:"break-word"}}>{error}</div>
        <button onClick={()=>{window.location.href="/api/quickbooks/connect";}} style={{padding:"6px 12px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Reconnect QuickBooks</button>
        <div style={{marginTop:8,fontSize:12}}><QbSupport/></div>
      </div>}
      {flash&&<div style={{marginBottom:14,padding:"10px 12px",background:"#EDFBF1",border:`1px solid ${T.green}`,borderRadius:T.radiusSm,color:T.green,fontSize:13,fontWeight:600}}>{flash}</div>}

      {loading&&<div style={{padding:20,color:T.textSub,fontSize:14}}>Loading QuickBooks numbers…</div>}

      {!loading&&pnl&&(
        <>
          {/* Import button */}
          <button onClick={doImport} disabled={selCount===0} style={{width:"100%",padding:"12px",borderRadius:T.radiusSm,background:selCount===0?T.border:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:15,cursor:selCount===0?"default":"pointer",fontFamily:"inherit",marginBottom:8,boxShadow:selCount===0?"none":`0 2px 10px ${T.gold}55`}}>
            ↓ Import {selCount===QB_IMPORT_KEYS.length?"all lines":`${selCount} selected line${selCount!==1?"s":""}`} into Actual columns
          </button>
          {/* Diagnostic — what QuickBooks actually returned for this project. */}
          <div style={{fontSize:11,color:T.textTert,textAlign:"center",marginBottom:16}}>
            Mapped to <b style={{color:T.textSub}}>{property.qbProjectName||"(unnamed project)"}</b> · {(pnl.rows||[]).filter(r=>r.section!=="Income").length} cost line{(pnl.rows||[]).filter(r=>r.section!=="Income").length!==1?"s":""} · {(txns||[]).length} transaction{(txns||[]).length!==1?"s":""} · {selCount} of {QB_IMPORT_KEYS.length} lines checked
            {selCount===0&&<span style={{color:T.red}}> — no lines checked, so Import is off. Check some lines below.</span>}
          </div>

          {/* Summary — fixed 3-column grid so amounts never wrap onto each other */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:isMobile?6:10,marginBottom:16}}>
            {[["Income",pnl.income,T.green],["Expenses",(pnl.expenses||0)+(pnl.cogs||0),T.red],["Net",pnl.netIncome,pnl.netIncome>=0?T.green:T.red]].map(([l,v,c])=>(
              <div key={l} style={{minWidth:0,background:T.bg,borderRadius:T.radiusSm,padding:isMobile?"10px 10px":"12px 14px"}}>
                <div style={{fontSize:11,color:T.textSub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>{l}</div>
                <div style={{fontSize:isMobile?14:18,fontWeight:800,color:c,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{money(v)}</div>
              </div>
            ))}
          </div>

          {/* Ordered breakdown — tap a line to drill into its transactions */}
          <Card style={{marginBottom:12}}>
            <GHeader label="Breakdown"/>
            <div style={{padding:"8px 16px 2px",fontSize:11,color:T.textTert}}>Checked lines import into your Actual columns (and auto-sync). Uncheck any you'd rather keep manual. Tap a line to see its transactions.</div>
            {BUCKET_ROWS.map(row=>{
              const list=txByBucket[row.key]||[];
              const open=openBucket===row.key;
              return(
                <div key={row.key} style={{borderTop:`1px solid ${T.border}`}}>
                  <div style={{display:"flex",alignItems:"center"}}>
                  {row.noImport
                    ? <span title="Debt service is never imported — the app uses its own debt service formula" style={{margin:"0 2px 0 14px",width:16,flexShrink:0,textAlign:"center",fontSize:12,color:T.textTert}}>—</span>
                    : <input type="checkbox" checked={importSel[row.key]} onChange={()=>toggleImport(row.key)}
                        title={importSel[row.key]?"This line imports into Actuals — uncheck to keep it manual":"Excluded from Import — check to include it"}
                        style={{margin:"0 2px 0 14px",width:16,height:16,flexShrink:0,cursor:"pointer",accentColor:T.gold}}/>}
                  <button onClick={()=>setOpenBucket(open?"":row.key)} style={{flex:1,minWidth:0,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"12px 16px 12px 10px",background:open?T.bg:"transparent",border:"none",cursor:"pointer",fontFamily:"inherit",textAlign:"left",opacity:row.noImport?0.6:(importSel[row.key]?1:0.45)}}>
                    <span style={{fontSize:14,color:T.text,display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:T.textTert,fontSize:11,display:"inline-block",transform:open?"rotate(90deg)":"none",transition:"transform .15s"}}>▶</span>
                      {row.label}
                      {list.length>0&&<span style={{fontSize:11,color:T.textTert}}>({list.length})</span>}
                      {row.noImport&&<span style={{fontSize:10,color:T.textTert,fontStyle:"italic"}}>· not imported</span>}
                    </span>
                    <span style={{fontSize:14,fontWeight:700,color:row.key==="income"?T.green:T.text}}>{money(row.total)}</span>
                  </button>
                  </div>
                  {open&&(
                    <div style={{padding:"0 16px 12px"}}>
                      {txns===null?(
                        <div style={{fontSize:12,color:T.textTert,padding:"8px 0"}}>Loading transactions…</div>
                      ):list.length===0?(
                        <div style={{fontSize:12,color:T.textTert,padding:"8px 0"}}>No transactions in this line.</div>
                      ):(
                        <>
                          <div style={{display:"flex",gap:6,margin:"4px 0 8px"}}>
                            <span style={{fontSize:11,color:T.textTert,alignSelf:"center"}}>Sort:</span>
                            {[["vendor","Vendor"],["date","Date"],["amount","Amount"]].map(([k,l])=>(
                              <button key={k} onClick={()=>setTxSort(k)} style={{padding:"4px 10px",borderRadius:20,border:`1px solid ${txSort===k?T.gold:T.border}`,background:txSort===k?T.goldLight:"#fff",color:txSort===k?T.gold:T.textSub,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
                            ))}
                          </div>
                          {sortTx(list).map((t,i)=>(
                            <div key={i} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"8px 0",borderTop:i?`1px solid ${T.border}`:"none"}}>
                              <div style={{minWidth:0}}>
                                <div style={{fontSize:13,color:T.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.vendor||t.type||"—"}</div>
                                <div style={{fontSize:11,color:T.textTert,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{[t.date,t.type,t.memo].filter(Boolean).join(" · ")}</div>
                              </div>
                              <span style={{fontSize:13,fontWeight:600,color:T.text,whiteSpace:"nowrap"}}>{money(t.amount)}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
          <div style={{fontSize:12,color:T.textTert,textAlign:"center",marginTop:8}}>Numbers come live from QuickBooks. Use the checkboxes to choose which lines Import writes into the Actual columns.</div>
        </>
      )}
      {!loading&&sel&&!pnl&&!error&&<div style={{padding:20,color:T.textTert,fontSize:14}}>No data for this project yet.</div>}
      {!sel&&<div style={{padding:20,color:T.textTert,fontSize:14}}>Pick the QuickBooks project for this property to see its numbers.</div>}
      <div style={{textAlign:"center",marginTop:20}}><QbSupport/></div>
    </div>
  );
}

// ─── Files tab — browse a property's OneDrive/SharePoint folder in-app ─────────
function fmtBytes(b){if(!b&&b!==0)return"";if(b<1024)return b+" B";const k=b/1024;if(k<1024)return Math.round(k)+" KB";const m=k/1024;return (m<10?m.toFixed(1):Math.round(m))+" MB";}
// Pick an icon by file type so a spreadsheet, image, PDF, etc. are easy to tell apart.
function fileIcon(name="",mime=""){
  const ext=(name.split(".").pop()||"").toLowerCase();
  const is=(...l)=>l.includes(ext);
  if(mime.startsWith("image/")||is("jpg","jpeg","png","gif","heic","heif","webp","bmp","tiff","svg"))return "🖼️";
  if(ext==="pdf"||mime==="application/pdf")return "📕";
  if(is("xls","xlsx","xlsm","csv","numbers")||mime.includes("spreadsheet"))return "📊";
  if(is("doc","docx","pages","rtf","odt")||mime.includes("word"))return "📘";
  if(is("ppt","pptx","key","odp")||mime.includes("presentation"))return "📙";
  if(mime.startsWith("video/")||is("mp4","mov","avi","mkv","webm"))return "🎬";
  if(mime.startsWith("audio/")||is("mp3","m4a","wav","aac","ogg"))return "🎵";
  if(is("zip","rar","7z","tar","gz"))return "🗜️";
  if(is("txt","md"))return "📃";
  return "📄";
}
function FilesTab({property,onUpdate}){
  const od=useOneDrive();
  const folder=property.filesFolder||null;      // {driveId,id,name} — picked in-app
  const link=property.filesShareLink||"";        // legacy pasted share link
  const connected=!!((folder&&folder.driveId&&folder.id)||link);
  const[stack,setStack]=useState([]);
  const[items,setItems]=useState([]);
  const[loading,setLoading]=useState(false);
  const[error,setError]=useState("");
  const[uploading,setUploading]=useState(0);
  const fileRef=useRef(null);
  // picker
  const[pStack,setPStack]=useState([]);          // [] = choose a location
  const[pItems,setPItems]=useState([]);
  const[pLoading,setPLoading]=useState(false);
  const[showPaste,setShowPaste]=useState(false);
  const[linkInput,setLinkInput]=useState("");
  const[siteMode,setSiteMode]=useState(false);   // SharePoint site search
  const[siteQ,setSiteQ]=useState("");
  const[sites,setSites]=useState(null);
  const[siteBusy,setSiteBusy]=useState(false);

  const loadFrom=useCallback(async(driveId,itemId,newStack)=>{
    setLoading(true);setError("");
    try{const kids=await od.listChildren(driveId,itemId);setItems(kids);if(newStack)setStack(newStack);}
    catch(e){setError(e.message||"Couldn't load files.");}
    setLoading(false);
  },[od]);

  const loadRoot=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      if(folder&&folder.driveId&&folder.id){
        setStack([{driveId:folder.driveId,id:folder.id,name:folder.name||"Files"}]);
        setItems(await od.listChildren(folder.driveId,folder.id));
      }else if(link){
        const root=await od.resolveShareLink(link);
        if(!root.driveId){setError("Couldn't read that folder link. Make sure it's a OneDrive/SharePoint 'Copy link' URL to a folder.");setLoading(false);return;}
        setStack([{driveId:root.driveId,id:root.id,name:root.name||"Files"}]);
        setItems(root.children&&root.children.length?root.children:await od.listChildren(root.driveId,root.id));
      }
    }catch(e){setError(e.message||"Couldn't open this folder.");}
    setLoading(false);
  },[od,folder,link]);

  useEffect(()=>{if(od.ready&&od.isConnected&&connected&&stack.length===0)loadRoot();},[od.ready,od.isConnected,connected]);// eslint-disable-line

  const[copiedId,setCopiedId]=useState("");
  const[deletingId,setDeletingId]=useState("");
  const shareItem=async(it)=>{
    const url=it.webUrl;if(!url)return;
    if(navigator.share){try{await navigator.share({title:it.name,url});}catch{/* cancelled */}return;}
    try{await navigator.clipboard.writeText(url);setCopiedId(it.id);setTimeout(()=>setCopiedId(c=>c===it.id?"":c),1500);}
    catch{window.prompt("Copy this link:",url);}
  };
  const cur=stack[stack.length-1];
  const openFolder=(f)=>loadFrom(cur.driveId,f.id,[...stack,{driveId:cur.driveId,id:f.id,name:f.name}]);
  const goTo=(idx)=>loadFrom(stack[idx].driveId,stack[idx].id,stack.slice(0,idx+1));
  const refresh=()=>cur&&loadFrom(cur.driveId,cur.id,null);
  const uploadToFolder=useCallback(async(file)=>{
    if(!file||!cur)return;
    setUploading(1);setError("");
    let up=file;
    if(!file.name||!/\.[a-z0-9]+$/i.test(file.name)){const ext=((file.type||"").split("/")[1]||"png").replace("jpeg","jpg");up=new File([file],`pasted-${Date.now()}.${ext}`,{type:file.type||"application/octet-stream"});}
    try{await od.uploadFile(cur.driveId,cur.id,up,(p)=>setUploading(p||1));refresh();}
    catch(err){setError(err.message||"Upload failed.");}
    setUploading(0);
  },[cur,od,refresh]);
  const onPick=async(e)=>{
    const file=e.target.files&&e.target.files[0];
    if(fileRef.current)fileRef.current.value="";
    await uploadToFolder(file);
  };
  const onFilesDrop=(e)=>{const file=e.dataTransfer?.files?.[0];if(!file)return;e.preventDefault();uploadToFolder(file);};
  const removeItem=async(it)=>{
    if(!cur||!it)return;
    if(!window.confirm(`Delete "${it.name}"?${it.folder?" This deletes the folder and everything in it." : ""}\n\nIt moves to the SharePoint/OneDrive recycle bin.`))return;
    setDeletingId(it.id);setError("");
    try{await od.deleteItem(cur.driveId,it.id);setItems(prev=>prev.filter(x=>x.id!==it.id));}
    catch(e){setError(e.message||"Couldn't delete that item.");}
    setDeletingId("");
  };
  // Paste a file (from email, WhatsApp Web, etc.) to upload it into the open folder.
  useEffect(()=>{
    if(!connected||!cur)return;
    const onPaste=(e)=>{
      const items=e.clipboardData?.items||[];let file=null;
      for(const it of items){if(it.kind==="file"){const f=it.getAsFile();if(f){file=f;break;}}}
      if(!file&&e.clipboardData?.files?.length)file=e.clipboardData.files[0];
      if(!file)return;
      e.preventDefault();uploadToFolder(file);
    };
    window.addEventListener("paste",onPaste);
    return ()=>window.removeEventListener("paste",onPaste);
  },[connected,cur,uploadToFolder]);

  // ── Picker actions ──
  const openMyOneDrive=async()=>{setPLoading(true);setError("");try{const r=await od.myDriveRoot();setPStack([{driveId:r.driveId,id:r.rootId,name:"My OneDrive"}]);setPItems(r.items);}catch(e){setError(e.message);}setPLoading(false);};
  const openShared=async()=>{setPLoading(true);setError("");try{const rows=await od.sharedWithMe();setPStack([{name:"Shared with me",virtual:true}]);setPItems(rows);}catch(e){setError(e.message);}setPLoading(false);};
  const pTop=pStack[pStack.length-1];
  const pEnter=async(f)=>{const driveId=f.driveId||pTop.driveId;setPLoading(true);setError("");try{const kids=await od.listChildren(driveId,f.id);setPStack([...pStack,{driveId,id:f.id,name:f.name}]);setPItems(kids);}catch(e){setError(e.message);}setPLoading(false);};
  const pGoTo=async(idx)=>{const t=pStack[idx];if(t.virtual){openShared();return;}setPLoading(true);setError("");try{const kids=await od.listChildren(t.driveId,t.id);setPStack(pStack.slice(0,idx+1));setPItems(kids);}catch(e){setError(e.message);}setPLoading(false);};
  const useThisFolder=()=>{if(pTop&&pTop.driveId&&pTop.id){onUpdate(property.id,"filesFolder",{driveId:pTop.driveId,id:pTop.id,name:pTop.name});onUpdate(property.id,"filesShareLink","");}};
  const doSiteSearch=async()=>{setSiteBusy(true);setError("");try{setSites(await od.searchSites(siteQ));}catch(e){setError(e.message);setSites([]);}setSiteBusy(false);};
  const pickSite=async(s)=>{setPLoading(true);setError("");try{const r=await od.siteDriveRoot(s.id);setPStack([{driveId:r.driveId,id:r.rootId,name:s.name}]);setPItems(r.items);setSiteMode(false);}catch(e){setError(e.message);}setPLoading(false);};

  const btn={padding:"8px 14px",borderRadius:T.radiusSm,border:`1px solid ${T.gold}`,background:T.goldLight,color:T.gold,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"};
  const wrap={padding:24,maxWidth:680,margin:"0 auto"};

  if(!od.ready) return <div style={{...wrap,color:T.textSub,fontSize:14}}>Connecting to Microsoft…</div>;

  if(!od.isConnected) return(
    <div style={{...wrap,textAlign:"center"}}>
      <div style={{width:60,height:60,borderRadius:16,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,margin:"20px auto 14px"}}>📁</div>
      <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:6}}>Connect your files</div>
      <div style={{fontSize:14,color:T.textSub,marginBottom:18,lineHeight:1.5}}>Sign in with your Microsoft account to browse this property's OneDrive / SharePoint files here.</div>
      <button onClick={()=>od.signIn().catch(e=>setError(e.message||"Sign-in cancelled."))} style={{...btn,padding:"11px 22px",fontSize:15,background:T.gold,color:"#fff",border:"none"}}>Connect Microsoft</button>
      {error&&<div style={{marginTop:14,color:T.red,fontSize:13}}>{error}</div>}
    </div>
  );

  // ── Folder picker (shown until a folder is connected) ──
  if(!connected) return(
    <div style={wrap}>
      <div style={{fontSize:16,fontWeight:700,color:T.text,marginBottom:4}}>Pick this property's folder</div>
      <div style={{fontSize:13,color:T.textSub,marginBottom:14,lineHeight:1.5}}>Browse to the folder and tap <strong>Use this folder</strong>. You only do this once per property.</div>
      {error&&<div style={{marginBottom:12,padding:"10px 12px",background:"#FFF0EF",border:`1px solid ${T.red}`,borderRadius:T.radiusSm,color:T.red,fontSize:13}}>{error}</div>}

      {pStack.length===0&&siteMode?(
        <div>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <span onClick={()=>{setSiteMode(false);setSites(null);}} style={{fontSize:13,color:T.blue,cursor:"pointer",fontWeight:600}}>‹ Locations</span>
            <span style={{fontSize:13,color:T.text,fontWeight:600}}>/ SharePoint sites</span>
          </div>
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <input value={siteQ} onChange={e=>setSiteQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSiteSearch()} placeholder="Search sites (e.g. Goldstone)"
              style={{flex:1,minWidth:200,padding:"10px 12px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
            <button onClick={doSiteSearch} style={{...btn,background:T.gold,color:"#fff",border:"none"}}>Search</button>
          </div>
          <Card>
            {siteBusy&&<div style={{padding:"18px 16px",color:T.textSub,fontSize:14}}>Searching…</div>}
            {!siteBusy&&sites&&sites.length===0&&<div style={{padding:"20px 16px",textAlign:"center",color:T.textTert,fontSize:13}}>No sites found. Try part of the site name.</div>}
            {!siteBusy&&(sites||[]).map((s,i)=>(
              <div key={s.id} onClick={()=>pickSite(s)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",borderTop:i===0?"none":`1px solid ${T.border}`}}>
                <span style={{fontSize:20}}>🏢</span>
                <div style={{flex:1,minWidth:0,fontSize:14,fontWeight:500,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                <span style={{fontSize:16,color:T.textTert}}>›</span>
              </div>
            ))}
          </Card>
        </div>
      ):pStack.length===0?(
        <Card>
          <div onClick={openMyOneDrive} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",cursor:"pointer"}}>
            <span style={{fontSize:22}}>📁</span><div style={{fontSize:15,fontWeight:600,color:T.text}}>My OneDrive</div>
          </div>
          <div onClick={openShared} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",cursor:"pointer",borderTop:`1px solid ${T.border}`}}>
            <span style={{fontSize:22}}>🤝</span><div style={{fontSize:15,fontWeight:600,color:T.text}}>Shared with me</div>
          </div>
          <div onClick={()=>setSiteMode(true)} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",cursor:"pointer",borderTop:`1px solid ${T.border}`}}>
            <span style={{fontSize:22}}>🏢</span><div style={{fontSize:15,fontWeight:600,color:T.text}}>SharePoint sites <span style={{fontSize:12,fontWeight:400,color:T.textTert}}>(shared drives)</span></div>
          </div>
        </Card>
      ):(<>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
          <span onClick={()=>{setPStack([]);setPItems([]);}} style={{fontSize:13,color:T.blue,cursor:"pointer",fontWeight:600}}>‹ Locations</span>
          {pStack.map((s,i)=>(<span key={i} style={{display:"flex",alignItems:"center",gap:4,fontSize:13}}><span style={{color:T.textTert}}>/</span><span onClick={()=>pGoTo(i)} style={{color:i===pStack.length-1?T.text:T.blue,fontWeight:i===pStack.length-1?600:400,cursor:"pointer",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span></span>))}
          {pTop&&pTop.driveId&&pTop.id&&<button onClick={useThisFolder} style={{...btn,marginLeft:"auto",background:T.gold,color:"#fff",border:"none"}}>✓ Use this folder</button>}
        </div>
        <Card>
          {pLoading&&<div style={{padding:"18px 16px",color:T.textSub,fontSize:14}}>Loading…</div>}
          {!pLoading&&pItems.filter(it=>it.folder).length===0&&<div style={{padding:"20px 16px",textAlign:"center",color:T.textTert,fontSize:13}}>No sub-folders here.{pTop&&pTop.driveId?" You can still tap “Use this folder” above.":""}</div>}
          {!pLoading&&pItems.filter(it=>it.folder).map((it,i)=>(
            <div key={it.id} onClick={()=>pEnter(it)} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",cursor:"pointer",borderTop:i===0?"none":`1px solid ${T.border}`}}>
              <span style={{fontSize:20}}>📁</span>
              <div style={{flex:1,minWidth:0,fontSize:14,fontWeight:500,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
              <span style={{fontSize:16,color:T.textTert}}>›</span>
            </div>
          ))}
        </Card>
      </>)}

      <div style={{marginTop:14,fontSize:12,color:T.textTert}}>
        Can't find it? <span onClick={()=>setShowPaste(v=>!v)} style={{color:T.blue,cursor:"pointer"}}>Paste a share link instead</span>
      </div>
      {showPaste&&(
        <div style={{marginTop:8,display:"flex",gap:8,flexWrap:"wrap"}}>
          <input value={linkInput} onChange={e=>setLinkInput(e.target.value)} placeholder="https://…sharepoint.com/… or https://1drv.ms/…"
            style={{flex:1,minWidth:220,padding:"10px 12px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
          <button onClick={()=>{if(linkInput.trim())onUpdate(property.id,"filesShareLink",linkInput.trim());}} style={{...btn,background:T.gold,color:"#fff",border:"none"}}>Save</button>
        </div>
      )}
      <div style={{marginTop:14,fontSize:12,color:T.textTert}}>Signed in as {od.displayName} · <span onClick={()=>od.signOut()} style={{color:T.blue,cursor:"pointer"}}>Disconnect</span></div>
    </div>
  );

  return(
    <div style={wrap} onDrop={onFilesDrop} onDragOver={e=>e.preventDefault()}>
      {/* toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:12}}>
        <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:4,flexWrap:"wrap",fontSize:13}}>
          {stack.map((s,i)=>(
            <span key={i} style={{display:"flex",alignItems:"center",gap:4}}>
              {i>0&&<span style={{color:T.textTert}}>/</span>}
              <span onClick={()=>goTo(i)} style={{color:i===stack.length-1?T.text:T.blue,fontWeight:i===stack.length-1?600:400,cursor:"pointer",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
            </span>
          ))}
        </div>
        <button onClick={refresh} style={btn}>↻</button>
        <button onClick={()=>fileRef.current&&fileRef.current.click()} style={{...btn,background:T.gold,color:"#fff",border:"none"}}>↑ Upload</button>
        <input ref={fileRef} type="file" onChange={onPick} style={{display:"none"}}/>
      </div>

      {uploading>0&&<div style={{marginBottom:12,fontSize:13,color:T.gold}}>Uploading… {uploading}%<div style={{height:4,background:T.goldLight,borderRadius:4,marginTop:4,overflow:"hidden"}}><div style={{height:"100%",width:`${uploading}%`,background:T.gold}}/></div></div>}
      {error&&<div style={{marginBottom:12,padding:"10px 12px",background:"#FFF0EF",border:`1px solid ${T.red}`,borderRadius:T.radiusSm,color:T.red,fontSize:13}}>{error}</div>}

      <Card>
        {loading&&<div style={{padding:"18px 16px",color:T.textSub,fontSize:14}}>Loading…</div>}
        {!loading&&items.length===0&&<div style={{padding:"24px 16px",textAlign:"center",color:T.textTert,fontSize:14}}>This folder is empty.</div>}
        {!loading&&items.map((it,i)=>{
          const isFolder=!!it.folder;
          const dl=it["@microsoft.graph.downloadUrl"];
          return(
            <div key={it.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 16px",borderTop:i===0?"none":`1px solid ${T.border}`}}>
              <span style={{fontSize:20,flexShrink:0}}>{isFolder?"📁":fileIcon(it.name,it.file?.mimeType)}</span>
              <div style={{flex:1,minWidth:0,cursor:"pointer"}} onClick={()=>isFolder?openFolder(it):window.open(it.webUrl,"_blank","noopener")}>
                <div style={{fontSize:14,fontWeight:500,color:isFolder?T.text:T.blue,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.name}</div>
                <div style={{fontSize:11,color:T.textTert}}>{isFolder?`${it.folder.childCount||0} items`:fmtBytes(it.size)}{it.lastModifiedDateTime?` · ${new Date(it.lastModifiedDateTime).toLocaleDateString()}`:""}</div>
              </div>
              {!isFolder&&dl&&<a href={dl} style={{fontSize:12,color:T.gold,fontWeight:600,textDecoration:"none",flexShrink:0}}>Download</a>}
              <button onClick={()=>shareItem(it)} title="Share link" style={{background:"none",border:"none",cursor:it.webUrl?"pointer":"default",color:copiedId===it.id?T.green:T.textSub,padding:"4px 6px",display:"flex",alignItems:"center",gap:4,flexShrink:0,fontFamily:"inherit",fontSize:11,fontWeight:600,opacity:it.webUrl?1:0.4}}>{copiedId===it.id?"✓ Copied":ICONS.share}</button>
              <button onClick={()=>removeItem(it)} disabled={deletingId===it.id} title="Delete" style={{background:"none",border:"none",cursor:deletingId===it.id?"default":"pointer",color:T.textTert,padding:"4px 6px",display:"flex",alignItems:"center",flexShrink:0,fontFamily:"inherit",fontSize:14,opacity:deletingId===it.id?0.5:1}} onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textTert}>{deletingId===it.id?"…":"🗑"}</button>
            </div>
          );
        })}
      </Card>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12}}>
        <button onClick={()=>{onUpdate(property.id,"filesFolder",null);onUpdate(property.id,"filesShareLink","");setStack([]);setItems([]);setLinkInput("");setPStack([]);setPItems([]);}} style={{background:"none",border:"none",color:T.textTert,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Change folder</button>
        <span style={{fontSize:12,color:T.textTert}}>{od.displayName} · <span onClick={()=>od.signOut()} style={{color:T.blue,cursor:"pointer"}}>Disconnect</span></span>
      </div>
    </div>
  );
}
function PropDetail({property,onUpdate,onArchive}){
  const { contacts: CONTACTS, teamMembers: TEAM_MEMBERS } = useData();
  const isMobile=useIsMobile();
  const[tab,setTab]=useState("Financial Overview");
  const[taskPopup,setTaskPopup]=useState(null);
  // Showings tab only shows while the property is actively On Market / In Closing.
  const showShowings=property.status==="On Market"||property.status==="In Closing";
  // No QuickBooks file exists until the property is bought, so hide the QB tab while Under Contract.
  const showQB=property.status!=="Under Contract";
  const tabs=useMemo(()=>PTABS.filter(t=>(t!=="Showings"||showShowings)&&(t!=="QuickBooks"||showQB)),[showShowings,showQB]);
  useEffect(()=>{ if(!tabs.includes(tab)) setTab("Financial Overview"); },[tabs,tab]);
  const sc=SC[property.status]||{color:"#64748B",bg:"#F1F5F9"};
  const upP=(k,v)=>onUpdate(property.id,"propertyInfo",{...property.propertyInfo,[k]:v});
  const addTask=()=>onUpdate(property.id,"tasks",[...(property.tasks||[]),{id:Date.now(),text:"",status:"Not Started",assignee:""}]);
  const upTask=(tid,k,v)=>onUpdate(property.id,"tasks",property.tasks.map(t=>t.id===tid?{...t,[k]:v}:t));
  const delTask=(tid)=>onUpdate(property.id,"tasks",property.tasks.filter(t=>t.id!==tid));
  const linked=CONTACTS.filter(c=>property.contacts.includes(c.id));
  const avail=CONTACTS.filter(c=>!property.contacts.includes(c.id));
  const addC=(cid)=>onUpdate(property.id,"contacts",[...property.contacts,cid]);
  const remC=(cid)=>onUpdate(property.id,"contacts",property.contacts.filter(id=>id!==cid));
  const iS={width:"100%",padding:"9px 12px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  const full=`${property.address}${property.city?`, ${property.city}`:""}${property.state?`, ${property.state}`:""}${property.zip?` ${property.zip}`:""}`;
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg}}>
      <div style={{background:T.card,borderBottom:`1px solid ${T.border}`,padding:"18px 24px 0",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,marginBottom:10}}>
          <div style={{fontSize:20,fontWeight:700,color:T.text,letterSpacing:"-0.3px"}}>{full}</div>
          {onArchive&&<button onClick={()=>{if(window.confirm("Archive this property?\n\nIt will be hidden from your lists and permanently deleted after 60 days. You can restore it any time before then from Settings → Archived Properties.")) onArchive(property.id);}}
            style={{flexShrink:0,padding:"7px 14px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.textSub,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Archive</button>}
        </div>
        <div style={{marginBottom:14}}>
          <StatusPicker value={property.status} onChange={v=>onUpdate(property.id,"status",v)}/>
        </div>
        <div style={{display:"flex",background:T.bg,borderRadius:10,padding:3,gap:2,maxWidth:"100%",overflowX:"auto",WebkitOverflowScrolling:"touch",scrollbarWidth:"none"}}>
          {tabs.map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{flex:"0 0 auto",whiteSpace:"nowrap",padding:"7px 16px",borderRadius:8,border:"none",background:tab===t?T.card:"transparent",color:tab===t?T.text:T.textSub,fontWeight:tab===t?600:400,fontSize:13,cursor:"pointer",fontFamily:"inherit",boxShadow:tab===t?"0 1px 3px rgba(0,0,0,0.12)":"none",transition:"all 0.15s"}}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {tab==="Financial Overview"&&<FinOverview property={property} onUpdate={onUpdate}/>}
        {tab==="Property Info"&&(()=>{
          const pi=property.propertyInfo;
          const fullAddr=`${property.address}${property.city?`, ${property.city}`:""}${property.state?`, ${property.state}`:""}${property.zip?` ${property.zip}`:""}`;
          const mapsUrl=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}`;
          const zillowUrl=`https://www.zillow.com/homes/${encodeURIComponent(fullAddr.replace(/,/g,""))}_rb/`;

          return(
            <div style={{padding:24,maxWidth:620,margin:"0 auto"}}>
              <div style={{textAlign:"center",marginBottom:20}}>
                <div style={{fontSize:18,fontWeight:700,color:T.text}}>Property Info</div>
                <div style={{fontSize:13,color:T.blue,marginTop:2}}>Location and key details</div>
              </div>

              {/* Address */}
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
                <SectionHdr icon="🏠" label="ADDRESS" color="#EAF1FF"/>
                <div style={{padding:"16px 16px 10px",textAlign:"center"}}>
                  <div style={{fontSize:15,fontWeight:700,color:T.text}}>{fullAddr}</div>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",borderTop:`1px solid ${T.border}`}}>
                  <span style={{fontSize:13,color:T.textSub,display:"flex",alignItems:"center",gap:6}}>🔒 Lockbox Code</span>
                  <input value={pi.lockboxCode} onChange={e=>upP("lockboxCode",e.target.value)} placeholder="—"
                    style={{fontFamily:"monospace",letterSpacing:"0.15em",fontSize:14,fontWeight:600,color:T.text,padding:"4px 10px",borderRadius:6,border:`1px solid ${T.border}`,background:T.bg,outline:"none",textAlign:"right",width:100}}/>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"center",padding:"12px 16px 16px"}}>
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",borderRadius:20,border:`1px solid ${T.blue}`,color:T.blue,fontSize:13,fontWeight:600,textDecoration:"none"}}>📍 Maps</a>
                  <a href={zillowUrl} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",borderRadius:20,border:`1px solid ${T.blue}`,color:T.blue,fontSize:13,fontWeight:600,textDecoration:"none"}}>↗ Zillow</a>
                </div>
              </div>

              {/* Purchase Date Actual */}
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
                <SectionHdr icon="📅" label="PURCHASE DATE (ACTUAL)" color="#EAF1FF"/>
                <DateRow label="Date" value={property.financials.purchaseDate} onChange={v=>onUpdate(property.id,"financials",{...property.financials,purchaseDate:v})}/>
              </div>

              {/* Closing Date Scheduled */}
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
                <SectionHdr icon="📅" label="CLOSING DATE (SCHEDULED)" color="#E9F9EE"/>
                <DateRow label="Date" value={pi.closingDateScheduled} onChange={v=>upP("closingDateScheduled",v)}/>
              </div>

              {/* Dropbox Link */}
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
                <SectionHdr icon="📦" label="DROPBOX LINK" color="#FFF1E6"/>
                <div style={{padding:"14px 16px"}}>
                  {pi.dropboxLink
                    ?<a href={pi.dropboxLink} target="_blank" rel="noopener noreferrer" style={{fontSize:13,color:T.blue,wordBreak:"break-all"}}>{pi.dropboxLink}</a>
                    :<div style={{fontSize:13,color:T.textTert,textAlign:"center"}}>No link set</div>}
                  <input value={pi.dropboxLink||""} onChange={e=>upP("dropboxLink",e.target.value)} placeholder="Paste Dropbox link…"
                    style={{...iS,marginTop:8,fontSize:12}}/>
                </div>
              </div>

              {/* Sale Timeline */}
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
                <SectionHdr icon="📄" label="SALE TIMELINE" color="#F7EFFE"/>
                <DateRow icon="📅" label="Selling Date" value={property.financials.sellingDate} onChange={v=>onUpdate(property.id,"financials",{...property.financials,sellingDate:v})}/>
                <DateRow icon="📅" label="Mortgage Commitment" value={pi.mortgageCommitment} onChange={v=>upP("mortgageCommitment",v)}/>
                <DateRow icon="📅" label="Inspection Due" value={pi.inspectionDue} onChange={v=>upP("inspectionDue",v)}/>
              </div>

              <Card><GHeader label="Notes"/><div style={{padding:"4px 16px 16px"}}><textarea style={{...iS,minHeight:120,resize:"vertical",lineHeight:1.7}} value={pi.notes} onChange={e=>upP("notes",e.target.value)}/></div></Card>
            </div>
          );
        })()}
        {tab==="Tasks"&&(()=>{
          const allTasks=property.tasks||[];
          const tasks=allTasks.filter(t=>!t.deleted);
          const done=tasks.filter(t=>t.status==="Completed").length;
          const inProg=tasks.filter(t=>t.status==="In Progress").length;
          const na=tasks.filter(t=>t.status==="N/A").length;
          const total=tasks.length;
          const pct=total>0?Math.round((done/total)*100):0;
          return(
            <div style={{padding:24}}>
              {/* Progress bar */}
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,padding:"18px 22px",marginBottom:20}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:15,fontWeight:700,color:T.text}}>Task Progress</div>
                  <div style={{fontSize:20,fontWeight:800,color:T.green}}>{pct}%</div>
                </div>
                <div style={{height:10,borderRadius:5,background:T.bg,overflow:"hidden",marginBottom:10}}>
                  <div style={{height:"100%",borderRadius:5,background:`linear-gradient(90deg,${T.green},#22C55E)`,width:`${pct}%`,transition:"width 0.4s"}}/>
                </div>
                <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
                  {[["Completed",done,T.green],["In Progress",inProg,T.orange],["N/A",na,T.textTert],["Remaining",total-done-inProg-na,T.textSub]].map(([l,v,c])=>(
                    <div key={l} style={{fontSize:12,color:c}}><span style={{fontWeight:700}}>{v}</span> {l}</div>
                  ))}
                </div>
              </div>

              <PropertyTaskList property={property}/>
            </div>
          );
        })()}
        {tab==="Contacts"&&(
          <div style={{padding:24}}>
            <Card style={{marginBottom:16}}><GHeader label="Linked Contacts"/>
              <div style={{padding:"4px 0 8px"}}>
                {linked.length===0&&<div style={{fontSize:14,color:T.textTert,padding:"12px 16px"}}>No contacts linked yet.</div>}
                {linked.map((c,i)=>(
                  <div key={c.id} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderTop:i===0?"none":`1px solid ${T.border}`}}>
                    <div style={{width:40,height:40,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:15,color:"#fff",flexShrink:0}}>{c.name[0]}</div>
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:15,color:T.text}}>{c.name}</div><div style={{fontSize:13,color:T.textSub}}>{c.role} · {c.phone}</div></div>
                    <button onClick={()=>remC(c.id)} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>Remove</button>
                  </div>
                ))}
              </div>
            </Card>
            {avail.length>0&&(
              <Card><GHeader label="Add from Contacts"/>
                <div style={{padding:"4px 0 8px"}}>
                  {avail.map((c,i)=>(
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderTop:i===0?"none":`1px solid ${T.border}`}}>
                      <div style={{width:40,height:40,borderRadius:"50%",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:15,color:T.textSub,flexShrink:0}}>{c.name[0]}</div>
                      <div style={{flex:1}}><div style={{fontWeight:600,fontSize:15,color:T.textSub}}>{c.name}</div><div style={{fontSize:13,color:T.textTert}}>{c.role} · {c.phone}</div></div>
                      <button onClick={()=>addC(c.id)} style={{padding:"6px 16px",borderRadius:20,background:T.goldLight,border:`1px solid ${T.gold}`,color:T.gold,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>+ Add</button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
        {tab==="Files"&&<FilesTab property={property} onUpdate={onUpdate}/>}
        {tab==="QuickBooks"&&<QuickBooksTab property={property} onUpdate={onUpdate}/>}
        {tab==="Showings"&&<ShowingsTab property={property} onUpdate={onUpdate}/>}
      </div>
    </div>
  );
}

// ─── Sort Modal ───────────────────────────────────────────────────────────────
function SortModal({order,hidden,onSave,onClose}){
  const[loc,setLoc]=useState([...order]);
  const[hiddenLoc,setHiddenLoc]=useState(new Set(hidden||[]));
  const move=(i,dir)=>{const j=i+dir;if(j<0||j>=loc.length)return;const next=[...loc];[next[i],next[j]]=[next[j],next[i]];setLoc(next);};
  const toggle=(status)=>setHiddenLoc(prev=>{const n=new Set(prev);n.has(status)?n.delete(status):n.add(status);return n;});
  const allVisible=loc.every(s=>!hiddenLoc.has(s));
  const arrowBtn={width:30,height:28,borderRadius:7,border:`1px solid ${T.border}`,background:"#fff",cursor:"pointer",fontSize:13,color:T.textSub,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"inherit",padding:0};
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,backdropFilter:"blur(4px)",padding:16,boxSizing:"border-box"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:T.card,borderRadius:20,padding:"24px 22px",width:400,maxWidth:"100%",maxHeight:"88vh",boxShadow:T.shadowMd,display:"flex",flexDirection:"column"}}>
        <div style={{fontWeight:700,fontSize:18,marginBottom:4,color:T.text}}>Sort & Filter Statuses</div>
        <div style={{fontSize:13,color:T.textSub,marginBottom:12}}>Use the arrows to set the order. Uncheck a status to hide it from the list.</div>
        <button onClick={()=>setHiddenLoc(allVisible?new Set(loc):new Set())} style={{alignSelf:"flex-start",background:"none",border:"none",color:T.blue,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600,padding:"2px 0",marginBottom:10}}>{allVisible?"Hide all":"Show all"}</button>
        <div style={{display:"flex",flexDirection:"column",gap:8,overflowY:"auto"}}>
          {loc.map((status,i)=>{
            const s=SC[status]||{color:"#64748B",bg:"#F1F5F9"};
            const visible=!hiddenLoc.has(status);
            return(
              <div key={status} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,opacity:visible?1:0.5}}>
                <input type="checkbox" checked={visible} onChange={()=>toggle(status)} style={{width:18,height:18,flexShrink:0,cursor:"pointer",accentColor:T.gold}}/>
                <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:T.text}}>{status}</span>
                <span style={{padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:s.bg,color:s.color,whiteSpace:"nowrap"}}>{status}</span>
                <div style={{display:"flex",gap:4,flexShrink:0}}>
                  <button onClick={()=>move(i,-1)} disabled={i===0} title="Move up" style={{...arrowBtn,opacity:i===0?0.35:1,cursor:i===0?"default":"pointer"}}>▲</button>
                  <button onClick={()=>move(i,1)} disabled={i===loc.length-1} title="Move down" style={{...arrowBtn,opacity:i===loc.length-1?0.35:1,cursor:i===loc.length-1?"default":"pointer"}}>▼</button>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"10px 20px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Cancel</button>
          <button onClick={()=>{onSave(loc,[...hiddenLoc]);onClose();}} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// ─── Properties Page ──────────────────────────────────────────────────────────
function PropertiesPage({sharedProps,setSharedProps,initialSelId,onNavConsumed,onArchive}){
  const { leads, setLeads }=useData();
  const props=sharedProps.filter(p=>!p.archived&&p.status!=="New Leads"); // New Leads live in the Leads section
  const setProps=setSharedProps;
  const isMobile=useIsMobile();
  const[selId,setSelId]=useState(initialSelId||null);
  useEffect(()=>{if(initialSelId){setSelId(initialSelId);onNavConsumed&&onNavConsumed();}},[initialSelId]);
  const[search,setSearch]=useState("");
  // Which statuses to show (empty = all). Persisted per device so it survives reload.
  const[viewStatuses,setViewStatuses]=useState(()=>new Set(loadPref("gs_propView",[]).filter(s=>PROP_ORDER.includes(s))));
  useEffect(()=>savePref("gs_propView",[...viewStatuses]),[viewStatuses]);
  const toggleView=(s)=>setViewStatuses(prev=>{const n=new Set(prev);n.has(s)?n.delete(s):n.add(s);return n;});
  const[showAdd,setShowAdd]=useState(false);
  const[form,setForm]=useState({addr:"",city:"",state:"NJ",zip:"",status:"Under Contract"});
  const sel=props.find(p=>p.id===selId);
  // Setting a property's status to "New Leads" moves it back into the Leads section.
  const moveToLeads=(p)=>{
    const pi=p.propertyInfo||{};
    const base=mkLead({address:p.address,city:p.city,state:p.state,zip:p.zip});
    const lead={...base,leadStatus:"New Leads",financials:{...(p.financials||{})},
      info:{...base.info,type:pi.type||"",beds:pi.beds||"",baths:pi.baths||"",sqft:pi.sqft||"",yearBuilt:pi.yearBuilt||""},
      propertyInfo:{...base.propertyInfo,lockboxCode:pi.lockboxCode||"",dropboxLink:pi.dropboxLink||""},
      tasks:p.tasks||[],contacts:p.contacts||[],notes:pi.notes||base.notes};
    setLeads(prev=>[...prev,lead]);
    setProps(prev=>prev.filter(x=>x.id!==p.id));
    setSelId(null);
  };
  const upProp=(id,key,val)=>{
    if(key==="status"&&val==="New Leads"){const p=props.find(x=>x.id===id);if(p){moveToLeads(p);return;}}
    setProps(prev=>prev.map(p=>p.id===id?{...p,[key]:val}:p));
  };
  // One-time cleanup: any property still sitting at "New Leads" status belongs in the
  // Leads section — move it there (skip if a lead with that address already exists).
  const migratedRef=useRef(false);
  useEffect(()=>{
    if(migratedRef.current)return;
    const strays=sharedProps.filter(p=>!p.archived&&p.status==="New Leads");
    if(!strays.length)return;
    migratedRef.current=true;
    const known=new Set((leads||[]).map(l=>(l.address||"").trim().toLowerCase()));
    strays.forEach(p=>{
      if(known.has((p.address||"").trim().toLowerCase())){setProps(prev=>prev.filter(x=>x.id!==p.id));}
      else{known.add((p.address||"").trim().toLowerCase());moveToLeads(p);}
    });
  });// eslint-disable-line
  const sorted=useMemo(()=>{
    const q=search.toLowerCase();
    return [...props].filter(p=>(viewStatuses.size===0||viewStatuses.has(p.status))&&(p.address+" "+p.city).toLowerCase().includes(q)).sort((a,b)=>{
      const ai=PROP_ORDER.indexOf(a.status),bi=PROP_ORDER.indexOf(b.status);
      return(ai===-1?999:ai)!==(bi===-1?999:bi)?(ai===-1?999:ai)-(bi===-1?999:bi):a.address.localeCompare(b.address);
    });
  },[props,search,viewStatuses]);
  const grouped=useMemo(()=>{const out=[];let last=null;sorted.forEach(p=>{if(p.status!==last){out.push({type:"h",status:p.status});last=p.status;}out.push({type:"p",...p});});return out;},[sorted]);
  function addProp(){
    if(!form.addr.trim())return;
    const p={id:Date.now(),address:form.addr,city:form.city,state:form.state,zip:form.zip,status:form.status,financials:{purchasePrice:"",buyingCosts:"",buyingTransferTax:"",transferTaxResp:"Seller Pays",rehabCosts:"",annualHoldingCosts:"",holdPeriod:"",fundingSource:"",salePrice:"",sellingCosts:"",sellingTransferTax:"",actualPurchasePrice:"",actualBuyingCosts:"",actualRehabCosts:"",purchaseDate:"",sellingDate:"",locLoan:"",locInterest:"",hmLoan:"",hmInterest:"",actualSalePrice:"",actualSellingCosts:"",actualSellingTransferTax:"",buyingCostItems:[{id:1,title:"Title Cost",autoType:"title",auto:true,resp:"Buyer Pays"},{id:2,title:"Transfer Tax",autoType:"tax",auto:true,resp:"Seller Pays"},{id:3,title:"Miscellaneous",autoType:null,auto:false,resp:"Buyer Pays",amount:"1000"}],sellingCostItems:[{id:1,title:"Commission",autoType:"commission",auto:true,resp:"Seller Pays",commissionPct:"2"},{id:2,title:"Transfer Tax",autoType:"tax",auto:true,resp:"Seller Pays"},{id:3,title:"Miscellaneous",autoType:null,auto:false,resp:"Seller Pays",amount:"2000"}],holdingCostItems:[{id:1,title:"Property Taxes",amount:"",perYear:true,auto:false},{id:2,title:"Insurance",amount:"",perYear:true,auto:false},{id:3,title:"Utilities",amount:"150",perMonth:true,auto:true},{id:4,title:"Miscellaneous",amount:"200",perMonth:true,auto:false}]},propertyInfo:{type:"",beds:"",baths:"",sqft:"",yearBuilt:"",lot:"",parcel:"",lockboxCode:"",lockboxLocation:"",notes:""},tasks:[],contacts:[]};
    setProps(prev=>[...prev,p]);setSelId(p.id);setShowAdd(false);setForm({addr:"",city:"",state:"NJ",zip:"",status:"Under Contract"});
  }
  const iS={width:"100%",padding:"10px 12px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  return(
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      <div style={{width:isMobile?"100%":276,flexShrink:0,display:isMobile&&sel?"none":"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${T.border}`,background:T.card,overflow:"hidden"}}>
        <div style={{padding:"14px 14px 10px",borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div><div style={{fontWeight:700,fontSize:15,color:T.text}}>Properties</div><div style={{fontSize:11,color:T.textSub,marginTop:1}}>{viewStatuses.size>0?`${sorted.length} shown · ${props.length} total`:`${props.length} total`}</div></div>
            <button onClick={()=>setShowAdd(true)} style={{width:32,height:32,borderRadius:8,background:T.gold,border:"none",cursor:"pointer",color:"#fff",fontWeight:700,fontSize:20,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
          </div>
          <div style={{position:"relative",marginBottom:8}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:T.textTert,fontSize:15,pointerEvents:"none"}}>⌕</span>
            <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} style={{...iS,paddingLeft:28,fontSize:13,padding:"7px 10px 7px 28px"}}/>
          </div>
          <MultiSelect placeholder="All statuses" options={PROP_ORDER.map(s=>({value:s,label:s}))} selected={viewStatuses} onToggle={toggleView} style={{width:"100%"}}/>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {grouped.map((item,i)=>{
            if(item.type==="h"){const s=SC[item.status]||{color:"#64748B"};const cnt=sorted.filter(p=>p.status===item.status).length;return <div key={`h${i}`} style={{padding:"9px 14px 4px",background:T.bg,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:8}}><span style={{width:7,height:7,borderRadius:"50%",background:s.color,flexShrink:0}}/><span style={{fontSize:10,fontWeight:700,color:s.color,textTransform:"uppercase",letterSpacing:"0.07em",flex:1}}>{item.status}</span><span style={{fontSize:10,color:T.textTert,fontWeight:600}}>{cnt}</span></div>;}
            const isActive=item.id===selId;
            return <div key={item.id} onClick={()=>setSelId(item.id)} style={{padding:"11px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,background:isActive?T.goldLight:"transparent",borderLeft:isActive?`3px solid ${T.gold}`:"3px solid transparent",transition:"background 0.12s"}}><div style={{fontWeight:isActive?600:400,fontSize:13,color:isActive?T.gold:T.text,lineHeight:1.3}}>{item.address}</div><div style={{fontSize:12,color:T.textSub,marginTop:3}}>{item.city}{item.city&&item.state?", ":""}{item.state}{item.zip?" "+item.zip:""}</div></div>;
          })}
        </div>
      </div>
      <div style={{flex:1,display:isMobile&&!sel?"none":"flex",flexDirection:"column",overflow:"hidden"}}>
        {isMobile&&sel&&<button onClick={()=>setSelId(null)} style={{display:"flex",alignItems:"center",gap:4,padding:"11px 14px",background:T.card,border:"none",borderBottom:`1px solid ${T.border}`,color:T.gold,fontWeight:600,fontSize:15,fontFamily:"inherit",cursor:"pointer",flexShrink:0,textAlign:"left",minHeight:44}}>‹ All properties</button>}
        {sel?<PropDetail property={sel} onUpdate={upProp} onArchive={onArchive?(id)=>{onArchive(id);setSelId(null);}:undefined}/>:
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bg,gap:14}}>
            <div style={{width:64,height:64,borderRadius:18,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🏠</div>
            <div style={{fontSize:16,fontWeight:600,color:T.textSub}}>Select a property</div>
            <div style={{fontSize:13,color:T.textTert}}>Choose from the list on the left to view details</div>
          </div>}
      </div>
      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(4px)"}}>
          <div style={{background:T.card,borderRadius:20,padding:28,width:460,boxShadow:T.shadowMd}}>
            <div style={{fontWeight:700,fontSize:18,marginBottom:20,color:T.text}}>New Property</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Street Address</div><input style={iS} value={form.addr} onChange={e=>setForm(f=>({...f,addr:e.target.value}))} placeholder="123 Main St" autoFocus/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 70px 90px",gap:10}}>
                <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>City</div><input style={iS} value={form.city} onChange={e=>setForm(f=>({...f,city:e.target.value}))}/></div>
                <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>State</div><input style={iS} value={form.state} onChange={e=>setForm(f=>({...f,state:e.target.value}))}/></div>
                <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Zip</div><input style={iS} value={form.zip} onChange={e=>setForm(f=>({...f,zip:e.target.value}))}/></div>
              </div>
              <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Status</div><select style={iS} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{PROP_ORDER.map(s=><option key={s}>{s}</option>)}</select></div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:24,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowAdd(false)} style={{padding:"10px 20px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Cancel</button>
              <button onClick={addProp} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Add Property</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New Leads Page ───────────────────────────────────────────────────────────
const LEAD_STATUS={"New Leads":{color:"#FF3B30",bg:"#FFF0EF"}};
// mkLead and INIT_LEADS now live in src/seed.js (mkLead is imported above).
// Leads are loaded from Supabase via useData().

function LeadDetail({lead,onUpdate}){
  const { contacts: CONTACTS } = useData();
  const[tab,setTab]=useState("Financial Overview");
  const f=lead.financials;
  const up=(k,v)=>onUpdate(lead.id,"financials",{...f,[k]:v});
  const upMany=(ch)=>onUpdate(lead.id,"financials",{...f,...ch});
  const upI=(k,v)=>onUpdate(lead.id,"info",{...lead.info,[k]:v});
  const pi=lead.propertyInfo||{lockboxCode:"",dropboxLink:""};
  const upPI=(k,v)=>onUpdate(lead.id,"propertyInfo",{...pi,[k]:v});
  const addTask=()=>onUpdate(lead.id,"tasks",[...(lead.tasks||[]),{id:Date.now(),text:"",done:false,assignee:""}]);
  const upTask=(tid,k,v)=>onUpdate(lead.id,"tasks",(lead.tasks||[]).map(t=>t.id===tid?{...t,[k]:v}:t));
  const delTask=(tid)=>onUpdate(lead.id,"tasks",(lead.tasks||[]).filter(t=>t.id!==tid));
  const linked=CONTACTS.filter(c=>(lead.contacts||[]).includes(c.id));
  const avail=CONTACTS.filter(c=>!(lead.contacts||[]).includes(c.id));
  const addC=(cid)=>onUpdate(lead.id,"contacts",[...(lead.contacts||[]),cid]);
  const remC=(cid)=>onUpdate(lead.id,"contacts",(lead.contacts||[]).filter(id=>id!==cid));

  const[showBuying,setShowBuying]=useState(false);
  const[showSelling,setShowSelling]=useState(false);
  const[showHolding,setShowHolding]=useState(false);
  const[showFinancingP,setShowFinancingP]=useState(false);

  const buyingItems=f.buyingCostItems||[];
  const buyingTotal=buyingItems.length>0?calcBuyingTotal(buyingItems,f.purchasePrice):n(f.buyingCosts)||0;
  const sellingItems=f.sellingCostItems||[];
  const holdingItems=f.holdingCostItems||[];
  const holdPeriodMonths=n(f.holdPeriod)||0;

  const sellingTotal=sellingItems.length>0
    ?sellingItems.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>{
        if(i.autoType==="commission")return s+Math.round(n(f.salePrice)*(parseFloat(i.commissionPct||0)/100));
        if(i.autoType==="tax"){const rtf=calcNJRTF(n(f.salePrice));return i.resp==="Seller Pays"?s+rtf.total:i.resp==="Split"?s+Math.round(rtf.total/2):s;}
        return s+n(i.amount);
      },0)
    :n(f.sellingCosts)||0;
  const holdingTotal=holdingItems.length>0
    ?holdingItems.reduce((s,i)=>s+(i.perYear?n(i.amount)/12:n(i.amount))*holdPeriodMonths,0)
    :n(f.annualHoldingCosts)||0;
  const totalCosts=n(f.purchasePrice)+buyingTotal+n(f.rehabCosts)+holdingTotal;

  const liveHmLoan   =Math.round(n(f.purchasePrice)*(n(f.hmLoanPct||90)/100));
  const liveRehabLoan=Math.round(n(f.rehabCosts)*(n(f.rehabFinPct||100)/100));
  const liveHmTotal  =liveHmLoan+liveRehabLoan;
  const liveHmMonthly=Math.round(liveHmLoan*(n(f.hmRate||9)/100)/12);
  const liveHmReserve=Math.round(liveHmMonthly*holdPeriodMonths);
  const liveHmOrigFee=Math.round(liveHmTotal*(n(f.hmOrigPct||0)/100));
  const liveHmDoc    =n(f.hmDocFee||1000);
  const liveGapPrinc =Math.round(n(f.purchasePrice)*(1-n(f.hmLoanPct||90)/100))
                     +Math.round(n(f.rehabCosts)*(1-n(f.rehabFinPct||100)/100))
                     +buyingTotal+liveHmReserve+liveHmOrigFee+liveHmDoc;
  const liveGapBalloon=Math.round(liveGapPrinc*(n(f.gapRate||15)/100)/12*holdPeriodMonths);
  const hmInterestFinal=n(f.hmInterest)||liveHmReserve;
  const locInterestFinal=n(f.locInterest)||liveGapBalloon;
  const debtService=hmInterestFinal+locInterestFinal;
  const equityRequired=n(f.locLoan)||liveGapPrinc;
  const netProfit=n(f.salePrice)-sellingTotal-debtService-totalCosts;

  const iS={width:"100%",padding:"9px 12px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  const full=`${lead.address}${lead.city?`, ${lead.city}`:""}${lead.state?`, ${lead.state}`:""}${lead.zip?` ${lead.zip}`:""}`;
  const mapsUrl=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(full)}`;
  const zillowUrl=`https://www.zillow.com/homes/${encodeURIComponent(full.replace(/,/g,""))}_rb/`;

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg}}>
      {showBuying&&<BuyingCostsPopup items={buyingItems} purchasePrice={f.purchasePrice} currentResp={f.transferTaxResp} onChange={(items,total,resp,taxAmt)=>upMany({buyingCostItems:items,buyingCosts:String(total),buyingTransferTax:String(taxAmt||0),transferTaxResp:resp})} onClose={()=>setShowBuying(false)}/>}
      {showSelling&&<SellingCostsPopup items={sellingItems} salePrice={f.salePrice} currentResp={f.transferTaxResp} onChange={(items,total)=>upMany({sellingCostItems:items,sellingCosts:String(total)})} onClose={()=>setShowSelling(false)}/>}
      {showHolding&&<HoldingCostsPopup items={holdingItems} holdPeriod={f.holdPeriod} onChange={(items,total)=>upMany({holdingCostItems:items,annualHoldingCosts:String(total)})} onClose={()=>setShowHolding(false)}/>}
      {showFinancingP&&<FinancingPopup fin={f} onSave={(vals)=>upMany(vals)} onClose={()=>setShowFinancingP(false)}/>}

      <div style={{background:T.card,borderBottom:`1px solid ${T.border}`,padding:"18px 24px 0",flexShrink:0}}>
        <div style={{fontSize:20,fontWeight:700,color:T.text,letterSpacing:"-0.3px",marginBottom:6}}>{full}</div>
        <div style={{fontSize:13,color:T.textSub,marginBottom:10}}>Lead added {lead.dateAdded||"—"}</div>
        <div style={{marginBottom:14}}>
          <span style={{padding:"6px 14px",borderRadius:20,background:"#FFF0EF",color:T.red,border:"1.5px solid #FF3B3033",fontWeight:700,fontSize:12}}>New Leads</span>
        </div>
        <div style={{display:"flex",background:T.bg,borderRadius:10,padding:3,gap:2,width:"fit-content"}}>
          {["Financial Overview","Property Info","Tasks","Contacts"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{padding:"7px 18px",borderRadius:8,border:"none",background:tab===t?T.card:"transparent",color:tab===t?T.text:T.textSub,fontWeight:tab===t?600:400,fontSize:13,cursor:"pointer",fontFamily:"inherit",boxShadow:tab===t?"0 1px 3px rgba(0,0,0,0.12)":"none",transition:"all 0.15s"}}>{t}</button>
          ))}
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {tab==="Financial Overview"&&(
          <div style={{background:T.bg,minHeight:"100%",padding:"24px 28px"}}>
            <div style={{maxWidth:520,margin:"0 auto"}}>
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden"}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 160px",borderBottom:`1px solid ${T.border}`,background:"#FAFAFA"}}>
                  <div style={{padding:"12px 18px",fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.06em"}}>Line Item</div>
                  <div style={{padding:"12px 14px",fontSize:11,fontWeight:700,color:T.blue,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Projected</div>
                </div>

                <RowHdr label="Acquisition & Costs" color={T.gold} showActual={false}/>
                <EditGridRow label="Purchase Price (Offer)" pVal={n(f.purchasePrice)} pEdit={v=>up("purchasePrice",v)} showActual={false}/>
                <PopupGridRow label="Buying Costs" pVal={buyingTotal} onOpenP={()=>setShowBuying(true)} showActual={false}/>
                <EditGridRow label="Rehab Costs (Est.)" pVal={n(f.rehabCosts)} pEdit={v=>up("rehabCosts",v)} showActual={false}/>
                <PopupGridRow label="Holding Costs" pVal={holdingTotal} onOpenP={()=>setShowHolding(true)} showActual={false}/>
                <TotalGridRow label="Total Costs" pVal={totalCosts} showActual={false}/>

                <RowHdr label="Financing" color={T.blue} showActual={false}/>
                <EditGridRow label="Hold Period" pVal={f.holdPeriod||"0"} pEdit={v=>up("holdPeriod",v.replace(/[^\d.]/g,""))} showActual={false} suffix="months"/>
                <div style={{display:"grid",gridTemplateColumns:"1fr 160px",borderTop:`1px solid ${T.border}`}}>
                  <div onClick={()=>setShowFinancingP(true)} style={{padding:"11px 18px",fontSize:14,color:T.text,cursor:"pointer"}}
                    onMouseEnter={e=>e.currentTarget.parentElement.style.background="#FAFAFA"} onMouseLeave={e=>e.currentTarget.parentElement.style.background="transparent"}>
                    Financing Details
                  </div>
                  <div onClick={()=>setShowFinancingP(true)} style={{padding:"11px 14px",fontSize:13,color:T.blue,fontWeight:500,textAlign:"right",cursor:"pointer"}}>
                    HM {fmtD(liveHmTotal)} · Gap {fmtD(equityRequired)} ›
                  </div>
                </div>
                <TotalGridRow label="Total Debt Service" pVal={debtService} showActual={false} color={T.gold}/>

                <RowHdr label="Revenue" color={T.green} showActual={false}/>
                <EditGridRow label="Target Sale Price (ARV)" pVal={n(f.salePrice)} pEdit={v=>up("salePrice",v)} showActual={false}/>

                <RowHdr label="Selling Costs" color={T.red} showActual={false}/>
                <PopupGridRow label="Commission + Transfer Tax" pVal={sellingTotal} onOpenP={()=>setShowSelling(true)} showActual={false}/>

                <div style={{display:"grid",gridTemplateColumns:"1fr 160px",borderTop:`2px solid ${netProfit>=0?T.green:T.red}`,background:netProfit>=0?"#EDFBF1":"#FFF0EF"}}>
                  <div style={{padding:"15px 18px",fontSize:15,fontWeight:700,color:netProfit>=0?T.green:T.red}}>Projected Profit</div>
                  <div style={{padding:"15px 14px",fontSize:17,fontWeight:800,color:netProfit>=0?T.green:T.red,textAlign:"right"}}>{fmtD(netProfit)}</div>
                </div>
              </div>
            </div>
          </div>
        )}
        {tab==="Property Info"&&(
          <div style={{padding:24,maxWidth:620,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:18,fontWeight:700,color:T.text}}>Property Info</div>
              <div style={{fontSize:13,color:T.blue,marginTop:2}}>Location and key details</div>
            </div>

            {/* Address */}
            <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
              <SectionHdr icon="🏠" label="ADDRESS" color="#EAF1FF"/>
              <div style={{padding:"16px 16px 10px",textAlign:"center"}}>
                <div style={{fontSize:15,fontWeight:700,color:T.text}}>{full}</div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 16px",borderTop:`1px solid ${T.border}`}}>
                <span style={{fontSize:13,color:T.textSub,display:"flex",alignItems:"center",gap:6}}>🔒 Lockbox Code</span>
                <input value={pi.lockboxCode} onChange={e=>upPI("lockboxCode",e.target.value)} placeholder="—"
                  style={{fontFamily:"monospace",letterSpacing:"0.15em",fontSize:14,fontWeight:600,color:T.text,padding:"4px 10px",borderRadius:6,border:`1px solid ${T.border}`,background:T.bg,outline:"none",textAlign:"right",width:100}}/>
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"center",padding:"12px 16px 16px"}}>
                <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",borderRadius:20,border:`1px solid ${T.blue}`,color:T.blue,fontSize:13,fontWeight:600,textDecoration:"none"}}>📍 Maps</a>
                <a href={zillowUrl} target="_blank" rel="noopener noreferrer" style={{display:"flex",alignItems:"center",gap:6,padding:"7px 16px",borderRadius:20,border:`1px solid ${T.blue}`,color:T.blue,fontSize:13,fontWeight:600,textDecoration:"none"}}>↗ Zillow</a>
              </div>
            </div>

            {/* Purchase Date Actual */}
            <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
              <SectionHdr icon="📅" label="PURCHASE DATE (ACTUAL)" color="#EAF1FF"/>
              <DateRow label="Date" value={f.purchaseDate} onChange={v=>up("purchaseDate",v)}/>
            </div>

            {/* Closing Date Scheduled */}
            <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
              <SectionHdr icon="📅" label="CLOSING DATE (SCHEDULED)" color="#E9F9EE"/>
              <DateRow label="Date" value={pi.closingDateScheduled} onChange={v=>upPI("closingDateScheduled",v)}/>
            </div>

            {/* Dropbox Link */}
            <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
              <SectionHdr icon="📦" label="DROPBOX LINK" color="#FFF1E6"/>
              <div style={{padding:"14px 16px"}}>
                {pi.dropboxLink
                  ?<a href={pi.dropboxLink} target="_blank" rel="noopener noreferrer" style={{fontSize:13,color:T.blue,wordBreak:"break-all"}}>{pi.dropboxLink}</a>
                  :<div style={{fontSize:13,color:T.textTert,textAlign:"center"}}>No link set</div>}
                <input value={pi.dropboxLink||""} onChange={e=>upPI("dropboxLink",e.target.value)} placeholder="Paste Dropbox link…"
                  style={{...iS,marginTop:8,fontSize:12}}/>
              </div>
            </div>

            {/* Sale Timeline */}
            <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:16}}>
              <SectionHdr icon="📄" label="SALE TIMELINE" color="#F7EFFE"/>
              <DateRow icon="📅" label="Selling Date" value={f.sellingDate} onChange={v=>up("sellingDate",v)}/>
              <DateRow icon="📅" label="Mortgage Commitment" value={pi.mortgageCommitment} onChange={v=>upPI("mortgageCommitment",v)}/>
              <DateRow icon="📅" label="Inspection Due" value={pi.inspectionDue} onChange={v=>upPI("inspectionDue",v)}/>
            </div>

            <Card><GHeader label="Notes"/><div style={{padding:"4px 16px 16px"}}><textarea style={{...iS,minHeight:120,resize:"vertical",lineHeight:1.7}} value={lead.notes||""} onChange={e=>onUpdate(lead.id,"notes",e.target.value)} placeholder="Add notes, follow-up reminders, seller details…"/></div></Card>
          </div>
        )}
        {tab==="Tasks"&&(
          <div style={{padding:24}}>
            <Card><GHeader label="Lead Tasks"/>
              <div style={{padding:"4px 16px 16px",display:"flex",flexDirection:"column",gap:10}}>
                {(lead.tasks||[]).length===0&&<div style={{fontSize:14,color:T.textTert,padding:"12px 0"}}>No tasks yet.</div>}
                {(lead.tasks||[]).map(task=>(
                  <div key={task.id} style={{display:"flex",alignItems:"center",gap:10,background:T.bg,borderRadius:T.radiusSm,padding:"11px 14px"}}>
                    <input type="checkbox" checked={task.done} onChange={e=>upTask(task.id,"done",e.target.checked)} style={{width:18,height:18,accentColor:T.gold,flexShrink:0,cursor:"pointer"}}/>
                    <input style={{flex:1,background:"transparent",border:"none",outline:"none",fontSize:14,color:task.done?T.textTert:T.text,textDecoration:task.done?"line-through":"none",fontFamily:"inherit"}} value={task.text} onChange={e=>upTask(task.id,"text",e.target.value)} placeholder="Task description…"/>
                    <input style={{width:130,background:"transparent",border:"none",outline:"none",fontSize:13,color:T.textSub,textAlign:"right",fontFamily:"inherit"}} value={task.assignee} onChange={e=>upTask(task.id,"assignee",e.target.value)} placeholder="Assignee"/>
                    <button onClick={()=>delTask(task.id)} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:18,flexShrink:0,lineHeight:1}}>×</button>
                  </div>
                ))}
                <button onClick={addTask} style={{marginTop:4,padding:"10px",borderRadius:T.radiusSm,background:"transparent",border:`1.5px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontSize:14,fontFamily:"inherit",fontWeight:500}}>+ Add Task</button>
              </div>
            </Card>
          </div>
        )}
        {tab==="Contacts"&&(
          <div style={{padding:24}}>
            <Card style={{marginBottom:16}}><GHeader label="Linked Contacts"/>
              <div style={{padding:"4px 0 8px"}}>
                {linked.length===0&&<div style={{fontSize:14,color:T.textTert,padding:"12px 16px"}}>No contacts linked yet.</div>}
                {linked.map((c,i)=>(
                  <div key={c.id} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderTop:i===0?"none":`1px solid ${T.border}`}}>
                    <div style={{width:40,height:40,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:15,color:"#fff",flexShrink:0}}>{c.name[0]}</div>
                    <div style={{flex:1}}><div style={{fontWeight:600,fontSize:15,color:T.text}}>{c.name}</div><div style={{fontSize:13,color:T.textSub}}>{c.role} · {c.phone}</div></div>
                    <button onClick={()=>remC(c.id)} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:13,fontFamily:"inherit"}}>Remove</button>
                  </div>
                ))}
              </div>
            </Card>
            {avail.length>0&&(
              <Card><GHeader label="Add from Contacts"/>
                <div style={{padding:"4px 0 8px"}}>
                  {avail.map((c,i)=>(
                    <div key={c.id} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderTop:i===0?"none":`1px solid ${T.border}`}}>
                      <div style={{width:40,height:40,borderRadius:"50%",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:15,color:T.textSub,flexShrink:0}}>{c.name[0]}</div>
                      <div style={{flex:1}}><div style={{fontWeight:600,fontSize:15,color:T.textSub}}>{c.name}</div><div style={{fontSize:13,color:T.textTert}}>{c.role} · {c.phone}</div></div>
                      <button onClick={()=>addC(c.id)} style={{padding:"6px 16px",borderRadius:20,background:T.goldLight,border:`1px solid ${T.gold}`,color:T.gold,cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"inherit"}}>+ Add</button>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NewLeadsPage(){
  const { sharedProps, setSharedProps, leads, setLeads } = useData();
  const isMobile=useIsMobile();
  const[selId,setSelId]=useState(null);
  useEffect(()=>{ if(!isMobile && selId==null && leads.length) setSelId(leads[0].id); },[leads,selId,isMobile]);
  const[search,setSearch]=useState("");
  const[showAdd,setShowAdd]=useState(false);
  const[converted,setConverted]=useState(null);
  const[form,setForm]=useState({addr:"",city:"",state:"NJ",zip:""});
  const sel=leads.find(l=>l.id===selId);
  const upLead=(id,key,val)=>setLeads(prev=>prev.map(l=>l.id===id?{...l,[key]:val}:l));
  const filtered=leads.filter(l=>(l.address+" "+l.city).toLowerCase().includes(search.toLowerCase()));
  const sorted=useMemo(()=>[...filtered].sort((a,b)=>a.address.localeCompare(b.address)),[filtered]);
  function moveToUnderContract(lead){
    const newProp={id:Date.now(),address:lead.address,city:lead.city,state:lead.state,zip:lead.zip,status:"Under Contract",financials:{...lead.financials},propertyInfo:{type:lead.info.type||"",beds:lead.info.beds||"",baths:lead.info.baths||"",sqft:lead.info.sqft||"",yearBuilt:lead.info.yearBuilt||"",lot:"",parcel:"",lockboxCode:(lead.propertyInfo||{}).lockboxCode||"",dropboxLink:(lead.propertyInfo||{}).dropboxLink||"",closingDateScheduled:(lead.propertyInfo||{}).closingDateScheduled||"",mortgageCommitment:(lead.propertyInfo||{}).mortgageCommitment||"",inspectionDue:(lead.propertyInfo||{}).inspectionDue||"",notes:lead.notes||""},tasks:lead.tasks||[],contacts:lead.contacts||[]};
    setSharedProps(prev=>[...prev,newProp]);
    const remaining=leads.filter(l=>l.id!==lead.id);
    setLeads(remaining);setConverted(lead.address);setSelId(remaining.length>0?remaining[0].id:null);
    setTimeout(()=>setConverted(null),3000);
  }
  function addLead(){if(!form.addr.trim())return;const l=mkLead({address:form.addr,city:form.city,state:form.state,zip:form.zip});setLeads(prev=>[...prev,l]);setSelId(l.id);setShowAdd(false);setForm({addr:"",city:"",state:"NJ",zip:""});}
  const iS={width:"100%",padding:"10px 12px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  return(
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      <div style={{width:isMobile?"100%":276,flexShrink:0,display:isMobile&&sel?"none":"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${T.border}`,background:T.card,overflow:"hidden"}}>
        <div style={{padding:"14px 14px 10px",borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div><div style={{fontWeight:700,fontSize:15,color:T.text}}>New Leads</div><div style={{fontSize:11,color:T.textSub,marginTop:1}}>{leads.length} leads</div></div>
            <button onClick={()=>setShowAdd(true)} style={{width:32,height:32,borderRadius:8,background:T.red,border:"none",cursor:"pointer",color:"#fff",fontWeight:700,fontSize:20,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
          </div>
          <div style={{position:"relative"}}><span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:T.textTert,fontSize:15,pointerEvents:"none"}}>⌕</span><input placeholder="Search leads…" value={search} onChange={e=>setSearch(e.target.value)} style={{...iS,paddingLeft:28,fontSize:13,padding:"7px 10px 7px 28px"}}/></div>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {converted&&<div style={{margin:"10px 12px",padding:"10px 14px",borderRadius:T.radiusSm,background:"#EDFBF1",border:`1px solid ${T.green}`,fontSize:13,color:T.green,fontWeight:600}}>✓ "{converted}" → Under Contract</div>}
          {sorted.map(item=>{const isActive=item.id===selId;return <div key={item.id} onClick={()=>setSelId(item.id)} style={{padding:"11px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,background:isActive?"#FFF0EF":"transparent",borderLeft:isActive?`3px solid ${T.red}`:"3px solid transparent",transition:"background 0.12s"}}><div style={{fontWeight:isActive?600:400,fontSize:13,color:isActive?T.red:T.text,lineHeight:1.3}}>{item.address||"New Lead"}</div><div style={{fontSize:12,color:T.textSub,marginTop:3}}>{item.city}{item.city&&item.state?", ":""}{item.state}{item.zip?" "+item.zip:""}</div><div style={{marginTop:5,fontSize:11,color:T.textTert}}>{item.dateAdded}</div></div>;})}
        </div>
      </div>
      <div style={{flex:1,display:isMobile&&!sel?"none":"flex",flexDirection:"column",overflow:"hidden"}}>
        {sel?(
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            <div style={{padding:isMobile?"8px 12px":"10px 24px",background:T.card,borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexShrink:0}}>
              {isMobile?<button onClick={()=>setSelId(null)} style={{padding:"7px 4px",background:"none",border:"none",color:T.gold,fontWeight:600,fontSize:15,cursor:"pointer",fontFamily:"inherit",minHeight:44}}>‹ All leads</button>:<span/>}
              <button onClick={()=>moveToUnderContract(sel)} style={{padding:"7px 18px",borderRadius:T.radiusSm,background:"#F5F0FF",border:"1px solid #7C3AED",color:"#7C3AED",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",minHeight:44}}>→ Move to Under Contract</button>
            </div>
            <LeadDetail lead={sel} onUpdate={upLead}/>
          </div>
        ):<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,color:T.textTert,fontSize:15}}>Select a lead</div>}
      </div>
      {showAdd&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(4px)"}}>
          <div style={{background:T.card,borderRadius:20,padding:28,width:460,boxShadow:T.shadowMd}}>
            <div style={{fontWeight:700,fontSize:18,marginBottom:6,color:T.text}}>Add New Lead</div>
            <div style={{fontSize:13,color:T.textSub,marginBottom:20}}>Properties you haven't purchased yet.</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Street Address</div><input style={iS} value={form.addr} onChange={e=>setForm(f=>({...f,addr:e.target.value}))} placeholder="123 Main St" autoFocus/></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 70px 90px",gap:10}}>
                <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>City</div><input style={iS} value={form.city} onChange={e=>setForm(f=>({...f,city:e.target.value}))}/></div>
                <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>State</div><input style={iS} value={form.state} onChange={e=>setForm(f=>({...f,state:e.target.value}))}/></div>
                <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Zip</div><input style={iS} value={form.zip} onChange={e=>setForm(f=>({...f,zip:e.target.value}))}/></div>
              </div>
            </div>
            <div style={{display:"flex",gap:10,marginTop:24,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowAdd(false)} style={{padding:"10px 20px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Cancel</button>
              <button onClick={addLead} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.red,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Add Lead</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Portfolio Overview ───────────────────────────────────────────────────────
const ACTIVE_STATUSES=["Under Contract","Purchased","Under Construction","On Market","In Closing"];
const STATUS_COLORS=Object.fromEntries(Object.entries(SC).map(([k,v])=>[k,{bg:v.bg,badge:v.color}]));

function PortfolioPage({sharedProps,setSharedProps,onNavigate}){
  const isMobile=useIsMobile();
  const props=sharedProps.filter(p=>!p.archived&&ACTIVE_STATUSES.includes(p.status));

  // Calculate net profit per property using same formula as FinOverview
  // Uses the shared finProfit() so this ALWAYS matches the property's Financial Overview.
  function pfCalcProfit(p){ return finProfit(p.financials).effective; }
  function calcEquity(p){
    const f=p.financials;
    const nn=v=>parseFloat(String(v||0).replace(/[^\d.-]/g,""))||0;
    if(nn(f.locLoan)>0)return nn(f.locLoan);
    // Live calc: gap principal
    const months=nn(f.holdPeriod)||0;
    const buying=calcBuyingTotal(f.buyingCostItems||[],f.purchasePrice)||nn(f.buyingCosts);
    const hmLoan=Math.round(nn(f.purchasePrice)*(nn(f.hmLoanPct||90)/100));
    const hmMonthly=Math.round(hmLoan*(nn(f.hmRate||9)/100)/12);
    const hmReserve=Math.round(hmMonthly*months);
    const downPmt=Math.round(nn(f.purchasePrice)*(1-nn(f.hmLoanPct||90)/100));
    const rehabGap=Math.round(nn(f.rehabCosts)*(1-nn(f.rehabFinPct||100)/100));
    const hmRehabLoan=Math.round(nn(f.rehabCosts)*(nn(f.rehabFinPct||100)/100));
    const hmOrigFee=Math.round((hmLoan+hmRehabLoan)*(nn(f.hmOrigPct||0)/100));
    const hmDoc=nn(f.hmDocFee||1000);
    return downPmt+rehabGap+buying+hmReserve+hmOrigFee+hmDoc;
  }

  const totalYield=props.reduce((s,p)=>s+Math.max(0,pfCalcProfit(p)),0);

  // Status cards
  const byStatus=ACTIVE_STATUSES.map(st=>{
    const group=props.filter(p=>p.status===st);
    return{st,count:group.length,profit:group.reduce((s,p)=>s+Math.max(0,pfCalcProfit(p)),0)};
  }).filter(g=>g.count>0);

  const isFunded=p=>p.status!=="Under Contract"||!!p.hasFunder;
  const[listPopup,setListPopup]=useState(null);
  const[sortKey,setSortKey]=useState("status");
  const sorted=[...props].sort((a,b)=>{
    if(sortKey==="profit")return pfCalcProfit(b)-pfCalcProfit(a);
    if(sortKey==="equity")return calcEquity(b)-calcEquity(a);
    return ACTIVE_STATUSES.indexOf(a.status)-ACTIVE_STATUSES.indexOf(b.status);
  });

  const thS={padding:"10px 14px",fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"left",borderBottom:`1px solid ${T.border}`,background:"#FAFAFA",cursor:"pointer",userSelect:"none",whiteSpace:"nowrap"};
  const tdS={padding:"12px 14px",fontSize:13,color:T.text,borderBottom:`1px solid ${T.border}`};

  return(
    <div style={{flex:1,overflowY:"auto",padding:isMobile?"14px 12px":"28px 32px",background:T.bg,position:"relative"}}>

      {/* Profit Analysis card */}
      <div style={{background:T.card,borderRadius:16,boxShadow:T.shadow,padding:isMobile?"18px 16px":"28px 32px",marginBottom:isMobile?16:24}}>
        <div style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:4}}>Consolidated Yield</div>
        <div style={{fontSize:26,fontWeight:700,color:T.text,marginBottom:24}}>Profit Analysis</div>
        <div style={{display:"flex",alignItems:"flex-start",gap:20,flexWrap:"wrap"}}>
          {/* Status breakdown cards */}
          <div style={{display:"flex",gap:14,flexWrap:"wrap",flex:1}}>
            {byStatus.map(({st,count,profit})=>{
              const sc=STATUS_COLORS[st]||{bg:T.goldLight,badge:T.gold};
              return(
                <div key={st} onClick={()=>setListPopup({type:"status",status:st})}
                  style={{background:sc.bg,borderRadius:12,padding:"16px 20px",minWidth:140,flex:1,cursor:"pointer",transition:"transform 0.1s"}}
                  onMouseEnter={e=>e.currentTarget.style.transform="translateY(-2px)"}
                  onMouseLeave={e=>e.currentTarget.style.transform="translateY(0)"}>
                  <div style={{marginBottom:10}}>
                    <span style={{display:"inline-block",maxWidth:"100%",background:sc.badge,color:"#fff",fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:20,textTransform:"uppercase",letterSpacing:"0.03em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",boxSizing:"border-box"}}>{st}</span>
                  </div>
                  <div style={{fontSize:22,fontWeight:700,color:T.text,marginBottom:4}}>{fmtD(profit)}</div>
                  <div style={{fontSize:12,color:T.textSub}}>{count} Active</div>
                </div>
              );
            })}
          </div>
          {/* Total yield */}
          <div style={{background:"#EDFBF1",borderRadius:14,padding:"20px 28px",textAlign:"right",minWidth:200}}>
            <div style={{fontSize:32,fontWeight:800,color:T.green}}>{fmtD(totalYield)}</div>
            <div style={{fontSize:11,fontWeight:700,color:T.green,textTransform:"uppercase",letterSpacing:"0.08em",marginTop:4}}>Total Active Yield</div>
          </div>
        </div>
      </div>

      {/* List popup — inline overlay, not position:fixed, to avoid iframe clipping */}
      {listPopup&&(()=>{
        const isStatus=listPopup.type==="status";
        const list=isStatus
          ? props.filter(p=>p.status===listPopup.status)
          : props.filter(p=>!isFunded(p)&&calcEquity(p)>0);
        const title=isStatus?listPopup.status:"Equity Needed";
        const sc=isStatus?(STATUS_COLORS[listPopup.status]||{badge:T.gold}):{badge:T.gold};
        return(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16,boxSizing:"border-box",backdropFilter:"blur(4px)"}} onClick={()=>setListPopup(null)}>
            <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"min(640px,92vw)",maxHeight:"75vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 12px 48px rgba(0,0,0,0.25)"}}>
              <div style={{padding:"16px 22px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:16,fontWeight:700,color:T.text}}>{title}</div>
                  <div style={{fontSize:12,color:T.textSub,marginTop:2}}>{list.length} {list.length===1?"property":"properties"}</div>
                </div>
                <button onClick={()=>setListPopup(null)} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
              </div>
              <div style={{overflowY:"auto",flex:1}}>
                {list.length===0&&<div style={{padding:30,textAlign:"center",color:T.textTert,fontSize:13}}>No properties</div>}
                {list.map(p=>{
                  const addr=`${p.address}${p.city?`, ${p.city}`:""}${p.zip?` ${p.zip}`:""}`;
                  const profit=pfCalcProfit(p);
                  const equity=calcEquity(p);
                  return(
                    <div key={p.id} onClick={()=>{onNavigate&&onNavigate(p.id);setListPopup(null);}}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 22px",borderTop:`1px solid ${T.border}`,cursor:"pointer"}}
                      onMouseEnter={e=>e.currentTarget.style.background="#FAFAFA"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <span style={{fontSize:13,color:T.blue,fontWeight:500,textDecoration:"underline"}}>{addr}</span>
                      <div style={{display:"flex",gap:18,alignItems:"center"}}>
                        {isStatus
                          ?<span style={{fontSize:13,fontWeight:700,color:profit>0?T.green:profit<0?T.red:T.textTert}}>{profit!==0?fmtD(profit):"—"}</span>
                          :<span style={{fontSize:13,fontWeight:700,color:T.gold}}>{fmtD(equity)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Properties table */}
      <div style={{background:T.card,borderRadius:16,boxShadow:T.shadow,overflow:"hidden"}}>
        <div style={{padding:"18px 24px 14px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
          <div>
            <div style={{fontWeight:700,fontSize:16,color:T.text}}>All Properties</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:2}}>{props.length} active properties</div>
          </div>
          <select value={sortKey} onChange={e=>setSortKey(e.target.value)}
            style={{fontSize:12,padding:"5px 10px",borderRadius:8,border:`1px solid ${T.border}`,background:T.bg,color:T.text,outline:"none",fontFamily:"inherit",cursor:"pointer"}}>
            <option value="status">Sort by Status</option>
            <option value="profit">Sort by Profit</option>
            <option value="equity">Sort by Equity Needed</option>
          </select>
        </div>

        {/* Total Equity Needed summary — only properties still needing funding */}
        {(()=>{
          const needFunding=props.filter(p=>!isFunded(p)&&calcEquity(p)>0);
          const totalNeeded=needFunding.reduce((s,p)=>s+calcEquity(p),0);
          return needFunding.length>0&&(
            <div onClick={()=>setListPopup({type:"equity"})} style={{margin:"14px 24px",background:T.goldLight,border:`1.5px solid ${T.gold}`,borderRadius:12,padding:"14px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:T.gold,textTransform:"uppercase",letterSpacing:"0.06em"}}>Total Equity Needed</div>
                <div style={{fontSize:12,color:T.textSub,marginTop:2}}>across {needFunding.length} {needFunding.length===1?"property":"properties"}</div>
              </div>
              <div style={{fontSize:24,fontWeight:800,color:T.gold}}>{fmtD(totalNeeded)}</div>
            </div>
          );
        })()}

        {isMobile ? (
          <div>
            <div style={{display:"flex",gap:14,padding:"8px 16px 6px",fontSize:10,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.05em"}}>
              <span style={{color:T.gold}}>● Equity needed</span>
              <span style={{color:T.green}}>● Est. profit</span>
            </div>
            {sorted.map(p=>{
              const profit=pfCalcProfit(p);
              const equity=calcEquity(p);
              const addr=`${p.address}${p.city?`, ${p.city}`:""}${p.zip?` ${p.zip}`:""}`;
              const funded=isFunded(p);
              const autoFunded=p.status!=="Under Contract";
              return(
                <div key={p.id} style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:9}}>
                    <span onClick={()=>onNavigate&&onNavigate(p.id)} style={{fontSize:14,fontWeight:600,color:T.blue,cursor:"pointer",flex:1,minWidth:0}}>{addr}</span>
                    {p.financials.useActualProfit&&<span style={{fontSize:9,fontWeight:700,background:T.green,color:"#fff",borderRadius:10,padding:"2px 8px",textTransform:"uppercase",flexShrink:0}}>actual</span>}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 62px 62px 70px",alignItems:"center",gap:8}}>
                    <div style={{minWidth:0,overflow:"hidden",display:"flex"}}>
                      <StatusPicker value={p.status} size="sm" onChange={v=>setSharedProps(prev=>prev.map(x=>x.id===p.id?{...x,status:v}:x))}/>
                    </div>
                    <span style={{textAlign:"right",fontSize:13,fontWeight:700,color:equity>0?T.gold:T.textTert,whiteSpace:"nowrap"}}>{equity>0?fmtD(equity):"—"}</span>
                    <span style={{textAlign:"right",fontSize:13,fontWeight:800,color:profit>0?T.green:profit<0?T.red:T.textTert,whiteSpace:"nowrap"}}>{profit!==0?fmtD(profit):"—"}</span>
                    <label style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:6,fontSize:12,fontWeight:600,color:funded?T.gold:T.textSub,cursor:autoFunded?"default":"pointer"}}>
                      <input type="checkbox" checked={funded} disabled={autoFunded}
                        onChange={e=>setSharedProps(prev=>prev.map(x=>x.id===p.id?{...x,hasFunder:e.target.checked}:x))}
                        style={{width:20,height:20,accentColor:T.gold,cursor:autoFunded?"default":"pointer",opacity:autoFunded?0.6:1,flexShrink:0}}/>
                      Funded
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead>
              <tr>
                <th style={{...thS}} onClick={()=>setSortKey("status")}>Address</th>
                <th style={{...thS,textAlign:"center"}}>Status</th>
                <th style={{...thS,textAlign:"right"}} onClick={()=>setSortKey("equity")}>Equity Required {sortKey==="equity"?"↓":""}</th>
                <th style={{...thS,textAlign:"center",width:70}}>Actual?</th>
                <th style={{...thS,textAlign:"right"}} onClick={()=>setSortKey("profit")}>Est. Profit {sortKey==="profit"?"↓":""}</th>
                <th style={{...thS,textAlign:"center",width:90}}>Has Funder</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p=>{
                const profit=pfCalcProfit(p);
                const equity=calcEquity(p);
                const sc=STATUS_COLORS[p.status]||{badge:T.gold};
                const addr=`${p.address}${p.city?`, ${p.city}`:""}${p.zip?` ${p.zip}`:""}`;
                const funded=isFunded(p);
                const autoFunded=p.status!=="Under Contract";
                return(
                  <tr key={p.id} style={{cursor:"default"}} onMouseEnter={e=>e.currentTarget.style.background="#FAFAFA"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td style={{...tdS,fontWeight:500,color:T.blue,cursor:"pointer",textDecoration:"underline"}} onClick={()=>onNavigate&&onNavigate(p.id)}>{addr}</td>
                    <td style={{...tdS,textAlign:"center"}}>
                      <StatusPicker value={p.status} size="sm" onChange={v=>setSharedProps(prev=>prev.map(x=>x.id===p.id?{...x,status:v}:x))}/>
                    </td>
                    <td style={{...tdS,textAlign:"right",fontWeight:600,color:equity>0?T.gold:T.textTert}}>{equity>0?fmtD(equity):"—"}</td>
                    <td style={{...tdS,textAlign:"center"}}>
                      {p.financials.useActualProfit&&<span style={{fontSize:9,fontWeight:700,background:T.green,color:"#fff",borderRadius:10,padding:"2px 8px",textTransform:"uppercase"}}>actual</span>}
                    </td>
                    <td style={{...tdS,textAlign:"right",fontWeight:700,color:profit>0?T.green:profit<0?T.red:T.textTert}}>{profit!==0?fmtD(profit):"—"}</td>
                    <td style={{...tdS,textAlign:"center"}}>
                      <input type="checkbox" checked={funded} disabled={autoFunded}
                        onChange={e=>setSharedProps(prev=>prev.map(x=>x.id===p.id?{...x,hasFunder:e.target.checked}:x))}
                        style={{width:16,height:16,accentColor:T.gold,cursor:autoFunded?"default":"pointer",opacity:autoFunded?0.6:1}}/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

    </div>
  );
}

// Initials + a stable color for an assignee avatar (Monday-style).
const initialsOf=(name)=>{
  const parts=(name||"").trim().split(/\s+/).filter(Boolean);
  if(parts.length===0)return "";
  if(parts.length===1)return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0]+parts[parts.length-1][0]).toUpperCase();
};
const AVATAR_COLORS=["#E2445C","#7E5EF2","#00C875","#0086C0","#FDAB3D","#A25DDC","#579BFC","#037F4C","#FF642E","#00A9C0"];
const avatarColor=(name)=>{if(!name)return "#C4C4C4";let h=0;for(let i=0;i<name.length;i++)h=(h*31+name.charCodeAt(i))>>>0;return AVATAR_COLORS[h%AVATAR_COLORS.length];};
function AssigneeAvatar({name,size=24}){
  return name
    ? <span title={name} style={{width:size,height:size,borderRadius:"50%",background:avatarColor(name),color:"#fff",fontSize:size*0.42,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,lineHeight:1}}>{initialsOf(name)}</span>
    : <span title="Unassigned" style={{width:size,height:size,borderRadius:"50%",background:"transparent",border:`1px dashed ${T.border}`,color:T.textTert,fontSize:size*0.5,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,lineHeight:1}}>+</span>;
}

// Custom status picker — colored options + a red Delete at the bottom (native
// <select> can't color options on iOS, and we want a Delete action in here).
function TaskStatusPicker({value,onChange,onDelete}){
  const[open,setOpen]=useState(false);
  const[pos,setPos]=useState({top:0,left:0});
  const btnRef=useRef(null);
  const sc=TASK_STATUS_COLORS[value]||TASK_STATUS_COLORS["Not Started"];
  const MENU_W=160,MENU_H=250;
  const openMenu=()=>{
    const r=btnRef.current?.getBoundingClientRect();
    const vw=typeof window!=="undefined"?window.innerWidth:360;
    const vh=typeof window!=="undefined"?window.innerHeight:640;
    if(r){
      const left=Math.max(8,Math.min(r.right-MENU_W,vw-MENU_W-8));
      const top=(r.bottom+MENU_H>vh)?Math.max(8,r.top-MENU_H-4):r.bottom+4; // flip up near bottom
      setPos({top,left});
    }
    setOpen(true);
  };
  return(
    <div style={{flexShrink:0}}>
      <button ref={btnRef} onClick={()=>open?setOpen(false):openMenu()} style={{background:sc.bg,color:sc.color,border:"none",borderRadius:20,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:3,whiteSpace:"nowrap"}}>{value||"Not Started"}<span style={{fontSize:8,opacity:0.7}}>▾</span></button>
      {open&&(<>
        {/* fixed positioning so the menu isn't clipped by the property card's overflow:hidden */}
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:290}}/>
        <div style={{position:"fixed",top:pos.top,left:pos.left,width:MENU_W,zIndex:300,background:"#fff",border:`1px solid ${T.border}`,borderRadius:T.radiusSm,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",padding:4,maxHeight:MENU_H,overflowY:"auto"}}>
          {TASK_STATUSES.map(s=>{const c=TASK_STATUS_COLORS[s];return(
            <button key={s} onClick={()=>{onChange(s);setOpen(false);}} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"9px 10px",borderRadius:7,border:"none",background:s===value?c.bg:"transparent",color:c.color,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:c.color,flexShrink:0}}/>{s}
            </button>
          );})}
          <div style={{borderTop:`1px solid ${T.border}`,margin:"4px 6px"}}/>
          <button onClick={()=>{setOpen(false);onDelete();}} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"9px 10px",borderRadius:7,border:"none",background:"transparent",color:T.red,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>🗑 Delete</button>
        </div>
      </>)}
    </div>
  );
}

// ─── Task Row (module level to avoid React #31) ───────────────────────────────
function TaskRow({t,onStatusChange,onDelete,onContact,onMessage,onAssign,currentUser,selectMode,selected,onToggleSelect}){
  const isMobile=useIsMobile();
  const sc=TASK_STATUS_COLORS[t.status]||TASK_STATUS_COLORS["Not Started"];
  const dim=t.status==="Completed"||t.status==="N/A";
  const msgCount=(t.messages||[]).length;
  const contactBtnEl=(
    <button onClick={()=>onContact(t)} title={t.taskContact?`Contact: ${t.taskContact.name||""}`:"Link a contact"}
      style={{background:t.taskContact?"#EBF4FF":"none",border:t.taskContact?`1px solid ${T.blue}`:`1px solid ${T.border}`,borderRadius:"50%",width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,flexShrink:0,color:t.taskContact?T.blue:T.textTert}}>{t.taskContact?.kind==="company"?"🏢":(t.taskContact?.name?.[0]||"👤")}</button>
  );
  const msgBtnEl=(
    <button onClick={()=>onMessage(t)} title="Messages" style={{position:"relative",background:msgCount?"#EBF4FF":"none",border:`1px solid ${msgCount?T.blue:T.border}`,borderRadius:"50%",width:24,height:24,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:11,flexShrink:0,color:msgCount?T.blue:T.textTert}}>💬{msgCount>0&&<span style={{position:"absolute",top:-5,right:-5,background:T.red,color:"#fff",fontSize:8,fontWeight:700,borderRadius:8,minWidth:13,height:13,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 2px"}}>{msgCount}</span>}</button>
  );
  const selBox=selectMode&&<input type="checkbox" checked={!!selected} onChange={()=>onToggleSelect(t)} style={{width:18,height:18,flexShrink:0,cursor:"pointer",accentColor:T.gold}}/>;
  // Address + property status are already shown in the group header above, so the
  // row omits them and just carries the task itself. Compact Monday-style layout:
  // [select?] task · assignee initials · contact · message · status (far right).
  return(
    <div style={{display:"flex",alignItems:"center",gap:isMobile?8:10,padding:isMobile?"9px 12px":"11px 16px",borderTop:`1px solid ${T.border}`,background:selected?T.goldLight:"#fff"}}>
      {selBox}
      <span style={{flex:1,minWidth:0,fontSize:13,fontWeight:500,color:dim?T.textTert:T.text,textDecoration:t.status==="Completed"?"line-through":"none",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.text||"(untitled task)"}{t.autoId&&<span style={{marginLeft:5,fontSize:8,fontWeight:700,background:T.gold,color:"#fff",borderRadius:8,padding:"1px 5px",textTransform:"uppercase"}}>auto</span>}</span>
      {t.delegate&&t.delegate===currentUser&&t.assignee
        ? <span title={`You're doing this for ${t.assignee}`} style={{fontSize:10,color:T.textTert,flexShrink:0,whiteSpace:"nowrap"}}>for {t.assignee.split(" ")[0]}</span>
        : (t.delegate&&t.assignee===currentUser)
          ? <span title={`You delegated this to ${t.delegate}`} style={{fontSize:10,color:T.blue,fontWeight:600,flexShrink:0,whiteSpace:"nowrap"}}>to {t.delegate.split(" ")[0]}</span>
          : null}
      <button onClick={()=>onAssign&&onAssign(t)} title={t.assignee?`Owner: ${t.assignee}${t.delegate?` · Delegated to ${t.delegate}`:""} — tap to change`:"Assign / delegate"} style={{background:"none",border:"none",padding:0,cursor:"pointer",display:"flex",alignItems:"center",gap:2,flexShrink:0}}>
        <AssigneeAvatar name={t.assignee} size={24}/>
        {t.delegate&&<><span style={{color:T.textTert,fontSize:11,fontWeight:700}}>→</span><AssigneeAvatar name={t.delegate} size={24}/></>}
      </button>
      {contactBtnEl}
      {msgBtnEl}
      <TaskStatusPicker value={t.status||"Not Started"} onChange={(s)=>onStatusChange(t.propId,t.id,s)} onDelete={()=>onDelete(t.propId,t.id)}/>
    </div>
  );
}

// Compact multi-select dropdown — tap to open a checklist, pick as many as you want.
function MultiSelect({placeholder,options,selected,onToggle,style}){
  const[open,setOpen]=useState(false);
  const arr=[...selected];
  const labelFor=(v)=>options.find(o=>o.value===v)?.label||v;
  const summary=arr.length===0?placeholder:arr.length===1?labelFor(arr[0]):`${arr.length} selected`;
  return(
    <div style={{position:"relative",flex:1,minWidth:0,...style}}>
      <button onClick={()=>setOpen(o=>!o)} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",gap:6,padding:"9px 10px",borderRadius:T.radiusSm,border:`1px solid ${arr.length?T.gold:T.border}`,background:arr.length?T.goldLight:T.bg,color:arr.length?T.gold:T.text,fontSize:13,fontWeight:arr.length?700:400,cursor:"pointer",fontFamily:"inherit",textAlign:"left",boxSizing:"border-box"}}>
        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{summary}</span>
        <span style={{fontSize:11,flexShrink:0,opacity:0.7}}>▾</span>
      </button>
      {open&&(<>
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:190}}/>
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,minWidth:"100%",zIndex:200,background:"#fff",border:`1px solid ${T.border}`,borderRadius:T.radiusSm,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",padding:4,maxHeight:280,overflowY:"auto"}}>
          {options.map(o=>{const on=selected.has(o.value);return(
            <button key={o.value} onClick={()=>onToggle(o.value)} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"9px 10px",borderRadius:7,border:"none",background:on?T.goldLight:"transparent",color:on?T.gold:T.text,fontSize:13,fontWeight:on?700:400,cursor:"pointer",fontFamily:"inherit",textAlign:"left",whiteSpace:"nowrap"}}>
              <span style={{width:16,flexShrink:0}}>{on?"☑":"☐"}</span>
              <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{o.label}</span>
            </button>
          );})}
        </div>
      </>)}
    </div>
  );
}

// Inline "add a task" row shown at the bottom of each property group in the Task Center.
function AddTaskInline({onAdd}){
  const[text,setText]=useState("");
  const submit=()=>{const t=text.trim();if(!t)return;onAdd(t);setText("");};
  return(
    <div style={{display:"flex",alignItems:"center",gap:8,padding:"9px 12px",borderTop:`1px solid ${T.border}`}}>
      <span style={{color:T.blue,fontSize:17,fontWeight:700,flexShrink:0,lineHeight:1}}>+</span>
      <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="Add a task for this property…"
        style={{flex:1,minWidth:0,background:"transparent",border:"none",outline:"none",fontSize:13,color:T.text,fontFamily:"inherit"}}/>
      {text.trim()&&<button onClick={submit} style={{padding:"5px 14px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Add</button>}
    </div>
  );
}

// Bulk-add tasks to any property (incl. ones with no tasks yet). Assigning here just
// sets who's responsible — it does NOT mark the task as "delegated by me".
function AddTasksModal({properties,teamMembers,initialPropId,onClose,onAdd}){
  const[propId,setPropId]=useState(initialPropId||(properties[0]?.id||""));
  const[rows,setRows]=useState([{text:"",assignee:""}]);
  const setRow=(i,k,v)=>setRows(rs=>rs.map((r,j)=>j===i?{...r,[k]:v}:r));
  const addRow=()=>setRows(rs=>[...rs,{text:"",assignee:""}]);
  const removeRow=(i)=>setRows(rs=>rs.length>1?rs.filter((_,j)=>j!==i):rs);
  const valid=propId&&rows.some(r=>r.text.trim());
  const save=()=>{ if(!valid)return; onAdd(propId,rows); onClose(); };
  const inp={width:"100%",padding:"10px 12px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit",background:"#fff"};
  const lbl={fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,display:"block"};
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:410,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(6px)",padding:16,boxSizing:"border-box"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:560,maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 48px rgba(0,0,0,0.25)"}}>
        <div style={{padding:"15px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:16,fontWeight:700,color:T.text}}>Add tasks</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{padding:"16px 18px",overflowY:"auto"}}>
          <div style={{marginBottom:16}}>
            <label style={lbl}>Property</label>
            <select value={propId} onChange={e=>setPropId(e.target.value)} style={{...inp,color:propId?T.text:T.textTert}}>
              <option value="">Select a property…</option>
              {properties.map(p=><option key={p.id} value={p.id}>{p.address}{p.city?`, ${p.city}`:""}</option>)}
            </select>
          </div>
          <label style={lbl}>Tasks</label>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {rows.map((r,i)=>(
              <div key={i} style={{display:"flex",gap:8,alignItems:"center"}}>
                <input autoFocus={i===0} value={r.text} onChange={e=>setRow(i,"text",e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&r.text.trim()&&i===rows.length-1)addRow();}} placeholder={`Task ${i+1}…`}
                  style={{...inp,flex:1}}/>
                <select value={r.assignee} onChange={e=>setRow(i,"assignee",e.target.value)} style={{...inp,width:130,flexShrink:0,color:r.assignee?T.text:T.textTert,fontSize:13,padding:"10px 8px"}}>
                  <option value="">Unassigned</option>
                  {(teamMembers||[]).map(m=><option key={m} value={m}>{m}</option>)}
                </select>
                {rows.length>1&&<button onClick={()=>removeRow(i)} style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0,padding:"2px 4px"}}>×</button>}
              </div>
            ))}
          </div>
          <button onClick={addRow} style={{marginTop:10,width:"100%",padding:"9px",borderRadius:T.radiusSm,background:"transparent",border:`1.5px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>+ Add another task</button>
        </div>
        <div style={{padding:"12px 18px",borderTop:`1px solid ${T.border}`,display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Cancel</button>
          <button onClick={save} disabled={!valid} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:valid?T.gold:T.border,border:"none",color:"#fff",fontWeight:700,cursor:valid?"pointer":"default",fontFamily:"inherit",fontSize:14}}>Add tasks</button>
        </div>
      </div>
    </div>
  );
}

// In-app messages/notes on a single task.
function TaskMessagesPopup({title,messages,currentUser,teamMembers,onSend,onClose}){
  const fmt=(iso)=>{try{return new Date(iso).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}catch{return "";}};
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,backdropFilter:"blur(6px)",padding:16,boxSizing:"border-box"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,width:"min(520px,94vw)",maxHeight:"84vh",display:"flex",flexDirection:"column",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{minWidth:0}}><div style={{fontSize:15,fontWeight:700,color:T.text}}>Messages</div><div style={{fontSize:12,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{title}</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:10,minHeight:120}}>
          {messages.length===0&&<div style={{textAlign:"center",color:T.textTert,fontSize:13,padding:"24px 0"}}>No messages yet. Leave a note for your team below.</div>}
          {messages.map(m=>{const mine=m.author===currentUser;return(
            <div key={m.id} style={{alignSelf:mine?"flex-end":"flex-start",maxWidth:"85%"}}>
              <div style={{fontSize:10,color:T.textTert,marginBottom:2,textAlign:mine?"right":"left"}}>{m.author||"—"} · {fmt(m.at)}</div>
              <div style={{background:mine?T.gold:T.bg,color:mine?"#fff":T.text,borderRadius:12,padding:"8px 12px",fontSize:13,lineHeight:1.4,whiteSpace:"pre-wrap",wordBreak:"break-word"}}>
                {m.replyTo&&<div style={{borderLeft:`3px solid ${mine?"rgba(255,255,255,0.55)":T.gold}`,paddingLeft:8,marginBottom:5,opacity:0.9,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220}}><b>{m.replyTo.author?m.replyTo.author.split(" ")[0]:"—"}:</b> {m.replyTo.text}</div>}
                {m.mentions&&m.mentions.length>0&&<div style={{fontSize:10,fontWeight:800,marginBottom:4,color:mine?"rgba(255,255,255,0.9)":T.gold}}>{m.mentions.map(n=>"@"+n.split(" ")[0]).join(" ")}</div>}
                {m.text}
                {m.attachment&&<MessageAttachment att={m.attachment} mine={mine}/>}
              </div>
            </div>
          );})}
        </div>
        <div style={{padding:"10px 12px max(10px,env(safe-area-inset-bottom))",borderTop:`1px solid ${T.border}`}}>
          <ChatComposer onSend={(txt,att,mn)=>onSend(txt,att,mn)} people={teamMembers} currentUser={currentUser} placeholder="Write a message…"/>
        </div>
      </div>
    </div>
  );
}

// ─── Task Contact card — assign a person or company, then Call/Text/WhatsApp/Email
function TaskContactCard({task,contacts,onAssign,onCreateContact,onClose}){
  const tc=task.taskContact||null;
  const isCompany=!!(tc&&tc.kind==="company");
  const person=(!isCompany&&tc)?(contacts.find(c=>c.id===tc.id)||contacts.find(c=>(c.name||"").toLowerCase()===(tc.name||"").toLowerCase())||normContact(tc)):null;
  const companyPeople=isCompany?contacts.filter(c=>sameCompany(c.company,tc.name)):[];
  const[pick,setPick]=useState(!tc);
  const[q,setQ]=useState("");
  const[adding,setAdding]=useState(false); // showing the "new contact" form
  const[draft,setDraft]=useState({name:"",phone:"",company:"",role:"",email:""});
  const[confirmC,setConfirmC]=useState(null); // built contact awaiting the save-to-directory decision
  const ql=q.trim().toLowerCase();
  // Attach a freshly-created contact to the task; optionally also save it to the directory.
  const assignNew=(c,saveToDir)=>{
    if(saveToDir&&onCreateContact)onCreateContact(c);
    onAssign(saveToDir?{kind:"person",id:c.id,name:c.name}:{kind:"person",id:c.id,name:c.name,company:c.company,role:c.role,email:c.email,phones:c.phones,tags:c.tags});
    setConfirmC(null);setAdding(false);setPick(false);
  };
  const companies=[...new Set(contacts.map(c=>c.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const people=contacts.filter(c=>!ql||[c.name,c.company,c.role,...(c.tags||[]),...(c.phones||[]).map(p=>p.number)].filter(Boolean).join(" ").toLowerCase().includes(ql)).sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  const coMatches=companies.filter(co=>!ql||co.toLowerCase().includes(ql));
  const dig=(n)=>String(n||"").replace(/\D/g,"");
  const actA={display:"inline-flex",alignItems:"center",gap:4,padding:"6px 10px",borderRadius:T.radiusSm,fontSize:12,fontWeight:600,textDecoration:"none",whiteSpace:"nowrap"};
  const phoneRow=(num)=>(
    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
      <a href={`tel:${String(num||"").replace(/[^\d+]/g,"")}`} style={{...actA,background:"#fff",border:`1px solid ${T.border}`,color:T.textSub}}>📞 Call</a>
      <a href={`sms:${String(num||"").replace(/[^\d+]/g,"")}`} style={{...actA,background:"#EDFBF1",border:`1px solid ${T.green}`,color:"#15803D"}}>💬 Text</a>
      <a href={`https://wa.me/${dig(num)}`} target="_blank" rel="noreferrer" style={{...actA,background:"#E7F9EF",border:"1px solid #25D366",color:"#128C4B"}}>WhatsApp</a>
    </div>
  );
  const avatar=(name,size=36)=><div style={{width:size,height:size,borderRadius:"50%",background:avatarColor(name),display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:size*0.4,color:"#fff",flexShrink:0}}>{initialsOf(name)||"?"}</div>;
  const footer=(
    <div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`,display:"flex",gap:8}}>
      <button onClick={()=>{setPick(true);setQ("");}} style={{flex:1,padding:"9px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Change</button>
      <button onClick={()=>onAssign(null)} style={{flex:1,padding:"9px",borderRadius:T.radiusSm,background:"#FFF0EF",border:`1px solid ${T.red}`,color:T.red,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Remove</button>
    </div>
  );
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)",padding:16,boxSizing:"border-box"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,width:"min(400px,94vw)",maxHeight:"86vh",display:"flex",flexDirection:"column",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:T.goldLight}}>
          <div style={{fontSize:13,fontWeight:700,color:T.gold}}>Task Contact</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{padding:"10px 16px 6px",fontSize:11,color:T.textSub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Task: {task.text}</div>
        {pick?(confirmC?(
          <>
            <div style={{padding:"18px 20px 8px",flex:1}}>
              <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:6}}>Save to your directory?</div>
              <div style={{fontSize:13,color:T.textSub,lineHeight:1.5}}>Add <b>{confirmC.name||"this contact"}</b>{confirmC.phones[0]?` (${confirmC.phones[0].number})`:""} to your Contacts so you can reach them from any task later — or just use them on this task.</div>
            </div>
            <div style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`,display:"flex",gap:8}}>
              <button onClick={()=>assignNew(confirmC,false)} style={{flex:1,padding:"10px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Just this task</button>
              <button onClick={()=>assignNew(confirmC,true)} style={{flex:1,padding:"10px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Save to directory</button>
            </div>
          </>
        ):adding?(
          <>
            <div style={{overflowY:"auto",padding:"6px 16px 12px"}}>
              <div style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em",margin:"4px 0 10px"}}>New contact</div>
              {[["name","Full name"],["phone","Phone number"],["company","Company (optional)"],["role","Role / trade (optional)"],["email","Email (optional)"]].map(([k,ph])=>(
                <input key={k} value={draft[k]} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))} placeholder={ph} type={k==="phone"?"tel":k==="email"?"email":"text"} style={{width:"100%",boxSizing:"border-box",marginBottom:8,padding:"9px 12px",borderRadius:10,border:`1px solid ${T.border}`,fontSize:13,fontFamily:"inherit",color:T.text,background:T.bg,outline:"none"}}/>
              ))}
            </div>
            <div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`,display:"flex",gap:8}}>
              <button onClick={()=>setAdding(false)} style={{flex:1,padding:"9px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.textSub,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
              {(()=>{const ok=!!(draft.name.trim()||draft.phone.trim());return(
                <button disabled={!ok} onClick={()=>{const num=draft.phone.trim();setConfirmC({id:Date.now(),name:draft.name.trim(),company:draft.company.trim(),role:draft.role.trim(),email:draft.email.trim(),notes:"",phones:num?[{label:"Mobile",number:num}]:[],tags:[],phone:num});}} style={{flex:1,padding:"9px",borderRadius:T.radiusSm,background:ok?T.gold:T.border,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:ok?"pointer":"default",fontFamily:"inherit"}}>Continue</button>
              );})()}
            </div>
          </>
        ):(
          <>
            <div style={{padding:"0 16px 10px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,background:T.bg,borderRadius:10,padding:"8px 12px",border:`1px solid ${T.border}`}}>
                <span style={{fontSize:14,color:T.textSub}}>🔍</span>
                <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search people or companies…" style={{flex:1,background:"transparent",border:"none",outline:"none",fontSize:13,color:T.text,fontFamily:"inherit"}}/>
              </div>
            </div>
            <div style={{padding:"0 16px 8px"}}>
              <button onClick={()=>{setDraft({name:q.trim(),phone:"",company:"",role:"",email:""});setAdding(true);}} style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:6,padding:"9px 12px",borderRadius:10,border:`1px dashed ${T.gold}`,background:T.goldLight,color:T.gold,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}><span style={{fontSize:15}}>＋</span> Add new contact{q.trim()?` “${q.trim()}”`:""}</button>
            </div>
            <div style={{overflowY:"auto"}}>
              {coMatches.length>0&&<div style={{padding:"6px 16px 2px",fontSize:10,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.05em"}}>Companies</div>}
              {coMatches.map(co=>{const n=contacts.filter(c=>sameCompany(c.company,co)).length;return(
                <div key={"co-"+co} onClick={()=>{onAssign({kind:"company",name:co});setPick(false);}} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",cursor:"pointer",borderTop:`1px solid ${T.border}`}}>
                  <div style={{width:36,height:36,borderRadius:10,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>🏢</div>
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:T.text}}>{co}</div><div style={{fontSize:11,color:T.textSub}}>{n} {n===1?"person":"people"}</div></div>
                  <span style={{fontSize:15,color:T.textTert}}>›</span>
                </div>
              );})}
              <div style={{padding:"8px 16px 2px",fontSize:10,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.05em"}}>People</div>
              {people.map(c=>(
                <div key={c.id} onClick={()=>{onAssign({kind:"person",id:c.id,name:c.name});setPick(false);}} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",cursor:"pointer",borderTop:`1px solid ${T.border}`}}>
                  {avatar(c.name)}
                  <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div><div style={{fontSize:11,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{[c.company,c.role].filter(Boolean).join(" · ")||(c.phones[0]&&c.phones[0].number)||""}</div></div>
                </div>
              ))}
              {people.length===0&&coMatches.length===0&&<div style={{padding:"20px 16px",textAlign:"center",color:T.textTert,fontSize:13}}>No matches{q?` for "${q}"`:""}.</div>}
            </div>
            {tc&&<div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`}}><button onClick={()=>setPick(false)} style={{width:"100%",padding:"8px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.textSub,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button></div>}
          </>
        )):isCompany?(
          <>
            <div style={{overflowY:"auto",padding:"4px 0 8px"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px"}}>
                <div style={{width:44,height:44,borderRadius:12,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>🏢</div>
                <div style={{minWidth:0}}><div style={{fontSize:16,fontWeight:700,color:T.text}}>{tc.name}</div><div style={{fontSize:12,color:T.textSub}}>{companyPeople.length} {companyPeople.length===1?"person":"people"} · pick who to reach</div></div>
              </div>
              {companyPeople.length===0&&<div style={{padding:"10px 16px",fontSize:13,color:T.textTert}}>No people at this company yet. Add them in Contacts.</div>}
              {companyPeople.map(c=>(
                <div key={c.id} style={{padding:"11px 16px",borderTop:`1px solid ${T.border}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>{avatar(c.name,32)}<div style={{minWidth:0,flex:1}}><div style={{fontSize:13,fontWeight:600,color:T.text}}>{c.name}</div>{c.role&&<div style={{fontSize:11,color:T.textSub}}>{c.role}</div>}</div></div>
                  {c.phones[0]&&<div style={{fontSize:12,color:T.textSub,marginTop:5}}>{c.phones[0].label}: {c.phones[0].number}</div>}
                  {c.phones[0]&&phoneRow(c.phones[0].number)}
                  {c.email&&<a href={`mailto:${c.email}`} style={{...actA,marginTop:6,background:"#EBF4FF",border:`1px solid ${T.blue}`,color:T.blue,display:"inline-flex"}}>✉️ Email</a>}
                </div>
              ))}
            </div>
            {footer}
          </>
        ):(
          <>
            <div style={{overflowY:"auto",padding:"8px 16px 12px"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>{avatar(person?.name,48)}<div style={{minWidth:0}}><div style={{fontSize:17,fontWeight:700,color:T.text}}>{person?.name||"(unknown)"}</div>{(person?.company||person?.role)&&<div style={{fontSize:12,color:T.textSub,marginTop:1}}>{[person.role,person.company].filter(Boolean).join(" · ")}</div>}</div></div>
              {(person?.phones||[]).map((p,i)=>(
                <div key={i} style={{marginBottom:10}}><div style={{fontSize:11,color:T.textTert,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>{p.label||"Phone"}</div><div style={{fontSize:14,color:T.text}}>{p.number}</div>{phoneRow(p.number)}</div>
              ))}
              {person?.email&&<div><div style={{fontSize:11,color:T.textTert,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4}}>Email</div><a href={`mailto:${person.email}`} style={{...actA,background:"#EBF4FF",border:`1px solid ${T.blue}`,color:T.blue,display:"inline-flex"}}>✉️ Email {person.email}</a></div>}
              {(!person||((person.phones||[]).length===0&&!person.email))&&<div style={{fontSize:13,color:T.textTert}}>No phone or email on this contact.</div>}
            </div>
            {footer}
          </>
        )}
      </div>
    </div>
  );
}

// The full task list for ONE property — identical rows/graphics/options to the Tasks
// tab (status picker, owner→delegate avatars, delegate "to/for" tags, contact 👤 and
// message 💬 buttons, assign & delegate popup). Reused inside the property detail so
// both places behave exactly the same. Writes go through setSharedProps like the Tasks tab.
function PropertyTaskList({property}){
  const { sharedProps, setSharedProps, contacts:CONTACTS, setContacts, flushContacts, teamMembers:TEAM_MEMBERS, currentUser:CURRENT_USER } = useData();
  const dir=CONTACTS.map(normContact);
  const addContactToDir=(c)=>{ setContacts(prev=>prev.some(x=>x.id===c.id)?prev:[...prev,c]); if(flushContacts)setTimeout(flushContacts,0); };
  const propId=property.id;
  const live=sharedProps.find(p=>p.id===propId)||property;
  const propAddr=(live.address||"")+(live.city?`, ${live.city}`:"");
  const tasks=(live.tasks||[]).filter(t=>!t.deleted);
  const rows=tasks.map(t=>({propId,propAddr,propStatus:live.status,...t}));
  const[contactTarget,setContactTarget]=useState(null);
  const[msgTarget,setMsgTarget]=useState(null);
  const[assignTarget,setAssignTarget]=useState(null);

  const updateTaskStatus=(pid,tid,status)=>setSharedProps(prev=>prev.map(p=>p.id!==pid?p:{...p,tasks:(p.tasks||[]).map(t=>t.id===tid?{...t,status}:t)}));
  const deleteTask=(pid,tid)=>setSharedProps(prev=>prev.map(p=>p.id!==pid?p:{...p,tasks:(p.tasks||[]).filter(t=>t.id!==tid)}));
  const setTaskContact=(pid,tid,contact)=>setSharedProps(prev=>prev.map(p=>p.id!==pid?p:{...p,tasks:(p.tasks||[]).map(tk=>tk.id!==tid?tk:{...tk,taskContact:contact})}));
  const setTaskRole=(pid,tid,role,member)=>setSharedProps(prev=>prev.map(p=>p.id!==pid?p:{...p,tasks:(p.tasks||[]).map(tk=>{
    if(tk.id!==tid)return tk;
    if(role==="owner"){ if(!member)return {...tk,assignee:"",delegate:""}; return {...tk,assignee:member,delegate:tk.delegate===member?"":tk.delegate}; }
    if(!member)return {...tk,delegate:""};
    return {...tk,delegate:member===tk.assignee?"":member};
  })}));
  const addTaskMessage=(pid,tid,text,attachment,mentions)=>{ const t=(text||"").trim(); if(!t&&!attachment)return; const msg={id:Date.now(),author:CURRENT_USER,text:t,at:new Date().toISOString(),readBy:[CURRENT_USER]}; if(attachment)msg.attachment=attachment; if(mentions&&mentions.length)msg.mentions=mentions; setSharedProps(prev=>prev.map(p=>p.id!==pid?p:{...p,tasks:(p.tasks||[]).map(tk=>tk.id!==tid?tk:{...tk,messages:[...(tk.messages||[]),msg]})})); };
  const markTaskRead=(pid,tid)=>setSharedProps(prev=>prev.map(p=>{ if(p.id!==pid)return p; let changed=false; const tks=(p.tasks||[]).map(tk=>{if(tk.id!==tid)return tk;const messages=(tk.messages||[]).map(m=>{if(isUnreadForUser(m,CURRENT_USER)){changed=true;return {...m,readBy:[...(m.readBy||[]),CURRENT_USER]};}return m;});return {...tk,messages};}); return changed?{...p,tasks:tks}:p; }));
  useEffect(()=>{if(msgTarget)markTaskRead(msgTarget.propId,msgTarget.id);},[msgTarget]); // eslint-disable-line react-hooks/exhaustive-deps
  const addTask=(text)=>{const t=(text||"").trim();if(!t)return;setSharedProps(prev=>prev.map(p=>p.id!==propId?p:{...p,tasks:[...(p.tasks||[]),{id:Date.now(),text:t,status:"Not Started",assignee:CURRENT_USER}]}));};

  return(
    <>
      {/* Task contact card */}
      {contactTarget&&(()=>{ const lt=(sharedProps.find(p=>p.id===contactTarget.propId)?.tasks||[]).find(tk=>tk.id===contactTarget.id)||contactTarget; return <TaskContactCard task={lt} contacts={dir} onAssign={(val)=>setTaskContact(contactTarget.propId,lt.id,val)} onCreateContact={addContactToDir} onClose={()=>setContactTarget(null)}/>; })()}
      {/* Task messages popup */}
      {msgTarget&&(()=>{ const lt=(sharedProps.find(p=>p.id===msgTarget.propId)?.tasks||[]).find(tk=>tk.id===msgTarget.id); return <TaskMessagesPopup title={msgTarget.text||"Task"} messages={lt?.messages||[]} currentUser={CURRENT_USER} teamMembers={TEAM_MEMBERS} onSend={(txt,att,mn)=>addTaskMessage(msgTarget.propId,msgTarget.id,txt,att,mn)} onClose={()=>setMsgTarget(null)}/>; })()}
      {/* Assign / delegate popup — owner (original) + optional delegate */}
      {assignTarget&&(()=>{
        const liveTask=(sharedProps.find(p=>p.id===assignTarget.propId)?.tasks||[]).find(tk=>tk.id===assignTarget.id)||assignTarget;
        const owner=liveTask.assignee||"";
        const delegate=liveTask.delegate||"";
        const memberRow=(m,active,onClick,color)=>(
          <div key={m} onClick={onClick} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",cursor:"pointer",background:active?T.goldLight:"transparent"}}
            onMouseEnter={e=>e.currentTarget.style.background=active?T.goldLight:"#FAFAFA"} onMouseLeave={e=>e.currentTarget.style.background=active?T.goldLight:"transparent"}>
            <AssigneeAvatar name={m} size={28}/>
            <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:T.text}}>{m}{m===CURRENT_USER?" (you)":""}</div>
            {active&&<span style={{fontSize:12,color:color||T.gold,fontWeight:700}}>✓</span>}
          </div>
        );
        const secHdr=(t)=><div style={{padding:"10px 16px 4px",fontSize:10.5,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.05em"}}>{t}</div>;
        return(
        <div onClick={()=>setAssignTarget(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)",padding:16,boxSizing:"border-box"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,width:"min(380px,94vw)",maxHeight:"86vh",display:"flex",flexDirection:"column",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",overflow:"hidden"}}>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:T.goldLight}}>
              <div style={{fontSize:13,fontWeight:700,color:T.gold}}>Assign &amp; delegate</div>
              <button onClick={()=>setAssignTarget(null)} style={{background:"none",border:"none",fontSize:20,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{padding:"10px 16px 2px",fontSize:11,color:T.textSub,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Task: {liveTask.text}</div>
            <div style={{overflowY:"auto"}}>
              {secHdr("Assigned to (owner)")}
              {TEAM_MEMBERS.map(m=>memberRow(m,owner===m,()=>setTaskRole(assignTarget.propId,assignTarget.id,"owner",owner===m?"":m)))}
              {owner&&<div onClick={()=>setTaskRole(assignTarget.propId,assignTarget.id,"owner","")} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",cursor:"pointer"}}>
                <span style={{width:28,height:28,borderRadius:"50%",border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:T.textTert,fontSize:15,flexShrink:0}}>×</span>
                <div style={{fontSize:13,fontWeight:600,color:T.red}}>Unassign</div>
              </div>}
              {owner&&<>
                <div style={{borderTop:`1px solid ${T.border}`,marginTop:4}}/>
                {secHdr("Delegate to (optional)")}
                {TEAM_MEMBERS.filter(m=>m!==owner).map(m=>memberRow(m,delegate===m,()=>setTaskRole(assignTarget.propId,assignTarget.id,"delegate",delegate===m?"":m),T.blue))}
                {delegate&&<div onClick={()=>setTaskRole(assignTarget.propId,assignTarget.id,"delegate","")} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",cursor:"pointer"}}>
                  <span style={{width:28,height:28,borderRadius:"50%",border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:T.textTert,fontSize:15,flexShrink:0}}>×</span>
                  <div style={{fontSize:13,fontWeight:600,color:T.textSub}}>Remove delegate</div>
                </div>}
              </>}
            </div>
            <div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"flex-end"}}>
              <button onClick={()=>setAssignTarget(null)} style={{padding:"9px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Done</button>
            </div>
          </div>
        </div>
        );
      })()}
      {/* Rows — same TaskRow as the Tasks tab */}
      <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden"}}>
        {rows.length===0&&<div style={{padding:"22px 16px",textAlign:"center",color:T.textTert,fontSize:13}}>No tasks yet. Add one below, or set up a rule in <strong>Settings → Automations</strong> to create tasks automatically.</div>}
        {rows.map(t=><TaskRow key={t.id} t={t} onStatusChange={updateTaskStatus} onDelete={deleteTask} onContact={setContactTarget} onMessage={setMsgTarget} onAssign={setAssignTarget} currentUser={CURRENT_USER} selectMode={false} selected={false} onToggleSelect={()=>{}}/>)}
        <AddTaskInline onAdd={addTask}/>
      </div>
    </>
  );
}
// ─── Tasks Page ───────────────────────────────────────────────────────────────
// TEAM_MEMBERS and CURRENT_USER now come from useData() (real Supabase auth + users table).

function TasksPage({onNavigate}){
  const { sharedProps, setSharedProps, contacts: CONTACTS, setContacts, flushContacts, teamMembers: TEAM_MEMBERS, currentUser: CURRENT_USER, automations, setAutomations } = useData();
  const dir=CONTACTS.map(normContact); // normalized contact directory (phones[], company, tags)
  const addContactToDir=(c)=>{ setContacts(prev=>prev.some(x=>x.id===c.id)?prev:[...prev,c]); if(flushContacts)setTimeout(flushContacts,0); };
  const { isAdmin } = useAuth();
  const isMobile=useIsMobile();
  const[views,setViews]=useState(new Set(["my"]));
  const[filterMember,setFilterMember]=useState("");
  useEffect(()=>{ if(!filterMember && TEAM_MEMBERS.length) setFilterMember(TEAM_MEMBERS[0]); },[TEAM_MEMBERS,filterMember]);
  const[confirmDeleteProp,setConfirmDeleteProp]=useState(null);
  const[filterProps,setFilterProps]=useState(new Set()); // empty = all properties
  const[taskContactTarget,setTaskContactTarget]=useState(null);
  const[contactSearch,setContactSearch]=useState(""); // the task we're setting a contact for
  const[taskMsgTarget,setTaskMsgTarget]=useState(null); // task whose messages are open
  const[taskAssignTarget,setTaskAssignTarget]=useState(null); // task we're delegating
  const[showAddTasks,setShowAddTasks]=useState(false); // bulk add-tasks popup
  const[selectMode,setSelectMode]=useState(false);
  const[selectedKeys,setSelectedKeys]=useState(new Set()); // `${propId}:${taskId}`
  const selKey=(t)=>`${t.propId}:${t.id}`;
  const toggleSelect=(t)=>setSelectedKeys(p=>{const n=new Set(p);const k=selKey(t);n.has(k)?n.delete(k):n.add(k);return n;});
  function addTaskMessage(propId,taskId,text,attachment,mentions){
    const t=(text||"").trim();if(!t&&!attachment)return;
    const msg={id:Date.now(),author:CURRENT_USER,text:t,at:new Date().toISOString(),readBy:[CURRENT_USER]};
    if(attachment)msg.attachment=attachment;
    if(mentions&&mentions.length)msg.mentions=mentions;
    setSharedProps(prev=>prev.map(p=>p.id!==propId?p:{...p,tasks:(p.tasks||[]).map(tk=>tk.id!==taskId?tk:{...tk,messages:[...(tk.messages||[]),msg]})}));
  }
  // A task has an owner (assignee = the original responsible person) and an optional
  // delegate (someone the owner handed the work to). role is "owner" or "delegate".
  function setTaskRole(propId,taskId,role,member){
    setSharedProps(prev=>prev.map(p=>p.id!==propId?p:{...p,tasks:(p.tasks||[]).map(tk=>{
      if(tk.id!==taskId)return tk;
      if(role==="owner"){
        if(!member)return {...tk,assignee:"",delegate:""}; // clearing owner clears delegate too
        return {...tk,assignee:member,delegate:tk.delegate===member?"":tk.delegate};
      }
      // delegate
      if(!member)return {...tk,delegate:""};
      return {...tk,delegate:member===tk.assignee?"":member}; // no delegating to the owner
    })}));
  }
  // Mark a task's messages read by me when I open its 💬 popup.
  function markTaskRead(propId,taskId){
    setSharedProps(prev=>prev.map(p=>{
      if(p.id!==propId)return p;
      let changed=false;
      const tasks=(p.tasks||[]).map(tk=>{if(tk.id!==taskId)return tk;const messages=(tk.messages||[]).map(m=>{if(isUnreadForUser(m,CURRENT_USER)){changed=true;return {...m,readBy:[...(m.readBy||[]),CURRENT_USER]};}return m;});return {...tk,messages};});
      return changed?{...p,tasks}:p;
    }));
  }
  useEffect(()=>{if(taskMsgTarget)markTaskRead(taskMsgTarget.propId,taskMsgTarget.id);},[taskMsgTarget]);// eslint-disable-line
  function deleteSelected(){
    if(selectedKeys.size===0)return;
    setSharedProps(prev=>prev.map(p=>{
      const keep=(p.tasks||[]).filter(tk=>!selectedKeys.has(`${p.id}:${tk.id}`));
      return keep.length===(p.tasks||[]).length?p:{...p,tasks:keep};
    }));
    setSelectedKeys(new Set());setSelectMode(false);
  }
  function setSelectedStatus(status){
    if(selectedKeys.size===0)return;
    setSharedProps(prev=>prev.map(p=>{
      let changed=false;
      const tasks=(p.tasks||[]).map(tk=>{if(selectedKeys.has(`${p.id}:${tk.id}`)){changed=true;return {...tk,status};}return tk;});
      return changed?{...p,tasks}:p;
    }));
    setSelectedKeys(new Set());setSelectMode(false);
  }

  function setTaskContact(propId,taskId,contact){
    setSharedProps(prev=>prev.map(p=>p.id!==propId?p:{...p,tasks:(p.tasks||[]).map(tk=>tk.id!==taskId?tk:{...tk,taskContact:contact})}));
  }
  const[statusFilter,setStatusFilter]=useState(new Set()); // empty = show all
  const[showAutoBuilder,setShowAutoBuilder]=useState(false);

  // Collect real tasks from all properties (archived excluded). Tasks now come only
  // from manual entry or automation rules — no auto-generated status checklists.
  const allTasks=[];
  sharedProps.filter(p=>!p.archived).forEach(prop=>{
    (prop.tasks||[]).filter(t=>!t.deleted&&(t.text||"").trim()).forEach(t=>{
      allTasks.push({propId:prop.id,propAddr:prop.address+(prop.city?`, ${prop.city}`:""),propStatus:prop.status,...t,isChecklist:false});
    });
  });

  function updateTaskStatus(propId,taskId,status){
    setSharedProps(prev=>prev.map(p=>p.id!==propId?p:{...p,tasks:(p.tasks||[]).map(t=>t.id===taskId?{...t,status}:t)}));
  }

  function deleteTask(propId,taskId){
    setSharedProps(prev=>prev.map(p=>p.id!==propId?p:{...p,tasks:(p.tasks||[]).filter(t=>t.id!==taskId)}));
  }
  // Add a task straight from the Task Center — assigned to me so it stays visible.
  function addTaskToProp(propId,text){
    const t=(text||"").trim();if(!t)return;
    setSharedProps(prev=>prev.map(p=>p.id!==propId?p:{...p,tasks:[...(p.tasks||[]),{id:Date.now(),text:t,status:"Not Started",assignee:CURRENT_USER}]}));
  }
  // Bulk-add tasks to any property. Assigning here just sets who's responsible — it
  // does NOT set assignedBy, so these don't show up as "delegated by me".
  function addTasksBulk(propId,rows){
    const clean=(rows||[]).map(r=>({text:(r.text||"").trim(),assignee:r.assignee||""})).filter(r=>r.text);
    if(!propId||!clean.length)return;
    setSharedProps(prev=>prev.map(p=>p.id!==propId?p:{...p,tasks:[...(p.tasks||[]),...clean.map((r,i)=>({id:Date.now()+i,text:r.text,status:"Not Started",assignee:r.assignee,cat:"Custom"}))]}));
  }

  // On my plate = I'm the delegate, or I'm the owner and it isn't delegated away.
  const myTasks=allTasks.filter(t=>t.delegate===CURRENT_USER||(t.assignee===CURRENT_USER&&!t.delegate));
  // Tasks I own and delegated to someone else — so I can track whether they're done.
  const assignedByMe=allTasks.filter(t=>t.assignee===CURRENT_USER&&t.delegate&&t.delegate!==CURRENT_USER);
  // A member's plate = they own it or it's delegated to them.
  const memberTasks=allTasks.filter(t=>t.assignee===filterMember||t.delegate===filterMember);
  const unassignedTasks=allTasks.filter(t=>!t.assignee);

  const baseViews=["my","assigned","member","unassigned","all"].filter(v=>views.has(v));
  const combined=baseViews.length===0||views.has("all")?allTasks
    :[...new Map(baseViews.flatMap(v=>v==="my"?myTasks:v==="assigned"?assignedByMe:v==="member"?memberTasks:v==="unassigned"?unassignedTasks:[])
        .map(t=>[`${t.propId}-${t.cat}-${t.text}`,t])).values()];
  const displayTasks=combined.filter(t=>statusFilter.size===0||statusFilter.has(t.status));
  const filteredDisplay=filterProps.size?displayTasks.filter(t=>filterProps.has(t.propAddr)):displayTasks;
  const togglePropFilter=(a)=>setFilterProps(p=>{const n=new Set(p);n.has(a)?n.delete(a):n.add(a);return n;});
  const propOptions=[...new Set(allTasks.map(t=>t.propAddr))].sort().map(a=>({value:a,label:a}));
  const showAutomations=views.has("automations");

  const bdr=`1px solid ${T.border}`;
  const statusColors={...TASK_STATUS_COLORS};

  // ── Automation Builder ──────────────────────────────────────────────────────
  // automations + setAutomations now come from useData() (Supabase-backed).
  const[newAuto,setNewAuto]=useState({trigger:"Under Contract",tasks:[{text:"",assignTo:"",category:"Custom"}]});

  const summaryByStatus={};
  TASK_STATUSES.forEach(s=>summaryByStatus[s]=allTasks.filter(t=>t.status===s).length);

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",background:T.bg,overflow:"hidden"}}>
      {/* Bulk add-tasks popup */}
      {showAddTasks&&<AddTasksModal properties={[...sharedProps.filter(p=>!p.archived)].sort((a,b)=>(a.address||"").localeCompare(b.address||""))} teamMembers={TEAM_MEMBERS} onAdd={addTasksBulk} onClose={()=>setShowAddTasks(false)}/>}
      {/* Assign / delegate popup — owner (original) + optional delegate */}
      {taskAssignTarget&&(()=>{
        const liveTask=(sharedProps.find(p=>p.id===taskAssignTarget.propId)?.tasks||[]).find(tk=>tk.id===taskAssignTarget.id)||taskAssignTarget;
        const owner=liveTask.assignee||"";
        const delegate=liveTask.delegate||"";
        const memberRow=(m,active,onClick,color)=>(
          <div key={m} onClick={onClick} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",cursor:"pointer",background:active?T.goldLight:"transparent"}}
            onMouseEnter={e=>e.currentTarget.style.background=active?T.goldLight:"#FAFAFA"} onMouseLeave={e=>e.currentTarget.style.background=active?T.goldLight:"transparent"}>
            <AssigneeAvatar name={m} size={28}/>
            <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:600,color:T.text}}>{m}{m===CURRENT_USER?" (you)":""}</div>
            {active&&<span style={{fontSize:12,color:color||T.gold,fontWeight:700}}>✓</span>}
          </div>
        );
        const secHdr=(t)=><div style={{padding:"10px 16px 4px",fontSize:10.5,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.05em"}}>{t}</div>;
        return(
        <div onClick={()=>setTaskAssignTarget(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)",padding:16,boxSizing:"border-box"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,width:"min(380px,94vw)",maxHeight:"86vh",display:"flex",flexDirection:"column",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",overflow:"hidden"}}>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:T.goldLight}}>
              <div style={{fontSize:13,fontWeight:700,color:T.gold}}>Assign &amp; delegate</div>
              <button onClick={()=>setTaskAssignTarget(null)} style={{background:"none",border:"none",fontSize:20,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{padding:"10px 16px 2px",fontSize:11,color:T.textSub,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Task: {taskAssignTarget.text}</div>
            <div style={{overflowY:"auto"}}>
              {secHdr("Assigned to (owner)")}
              {TEAM_MEMBERS.map(m=>memberRow(m,owner===m,()=>setTaskRole(taskAssignTarget.propId,taskAssignTarget.id,"owner",owner===m?"":m)))}
              {owner&&<div onClick={()=>setTaskRole(taskAssignTarget.propId,taskAssignTarget.id,"owner","")} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",cursor:"pointer"}}>
                <span style={{width:28,height:28,borderRadius:"50%",border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:T.textTert,fontSize:15,flexShrink:0}}>×</span>
                <div style={{fontSize:13,fontWeight:600,color:T.red}}>Unassign</div>
              </div>}
              {owner&&<>
                <div style={{borderTop:`1px solid ${T.border}`,marginTop:4}}/>
                {secHdr("Delegate to (optional)")}
                {TEAM_MEMBERS.filter(m=>m!==owner).map(m=>memberRow(m,delegate===m,()=>setTaskRole(taskAssignTarget.propId,taskAssignTarget.id,"delegate",delegate===m?"":m),T.blue))}
                {delegate&&<div onClick={()=>setTaskRole(taskAssignTarget.propId,taskAssignTarget.id,"delegate","")} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 16px",cursor:"pointer"}}>
                  <span style={{width:28,height:28,borderRadius:"50%",border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:T.textTert,fontSize:15,flexShrink:0}}>×</span>
                  <div style={{fontSize:13,fontWeight:600,color:T.textSub}}>Remove delegate</div>
                </div>}
              </>}
            </div>
            <div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"flex-end"}}>
              <button onClick={()=>setTaskAssignTarget(null)} style={{padding:"9px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Done</button>
            </div>
          </div>
        </div>
        );
      })()}
      {/* Task messages popup */}
      {taskMsgTarget&&(()=>{
        const liveTask=(sharedProps.find(p=>p.id===taskMsgTarget.propId)?.tasks||[]).find(tk=>tk.id===taskMsgTarget.id);
        return <TaskMessagesPopup title={taskMsgTarget.text||"Task"} messages={liveTask?.messages||[]} currentUser={CURRENT_USER} teamMembers={TEAM_MEMBERS}
          onSend={(txt,att,mn)=>addTaskMessage(taskMsgTarget.propId,taskMsgTarget.id,txt,att,mn)} onClose={()=>setTaskMsgTarget(null)}/>;
      })()}
      {/* Task contact popup */}
      {taskContactTarget&&(()=>{
        const liveTask=(sharedProps.find(p=>p.id===taskContactTarget.propId)?.tasks||[]).find(tk=>tk.id===taskContactTarget.id)||taskContactTarget;
        return <TaskContactCard task={liveTask} contacts={dir} onAssign={(val)=>setTaskContact(taskContactTarget.propId,liveTask.id,val)} onCreateContact={addContactToDir} onClose={()=>setTaskContactTarget(null)}/>;
      })()}
      {/* Header */}
      <div style={{background:T.card,borderBottom:bdr,padding:isMobile?"14px 14px":"18px 28px",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          <div style={{fontSize:isMobile?19:22,fontWeight:700,color:T.text}}>Tasks</div>
          <button onClick={()=>setShowAddTasks(true)} style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,padding:isMobile?"8px 12px":"9px 16px",borderRadius:20,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:isMobile?13:14,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}><span style={{fontSize:16,lineHeight:1}}>＋</span>{isMobile?"Add":"Add Tasks"}</button>
        </div>
        {isMobile?(()=>{
          // Compact filter bar for mobile — multi-select dropdowns instead of chip rows.
          const selStyle={flex:1,minWidth:0,padding:"9px 10px",borderRadius:T.radiusSm,border:bdr,background:T.bg,color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"};
          const summary=Object.entries(summaryByStatus).filter(([,v])=>v>0).map(([s,v])=>`${v} ${s}`).join(" · ");
          const toggleView=(k)=>setViews(p=>{const n=new Set(p);n.has(k)?n.delete(k):n.add(k);return n;});
          const toggleStatus=(s)=>setStatusFilter(p=>{const n=new Set(p);n.has(s)?n.delete(s):n.add(s);return n;});
          return(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",gap:8}}>
                <MultiSelect placeholder="All Tasks" selected={views} onToggle={toggleView}
                  options={[{value:"my",label:`My Tasks (${myTasks.length})`},{value:"assigned",label:`Delegated by Me (${assignedByMe.length})`},{value:"member",label:"By Team Member"},{value:"unassigned",label:`Unassigned (${unassignedTasks.length})`},{value:"all",label:"All Tasks"}]}/>
                <MultiSelect placeholder="All statuses" selected={statusFilter} onToggle={toggleStatus}
                  options={TASK_STATUSES.map(s=>({value:s,label:s}))}/>
              </div>
              <div style={{display:"flex",gap:8}}>
                <MultiSelect placeholder="All Properties" selected={filterProps} onToggle={togglePropFilter} options={propOptions}/>
                {views.has("member")&&(
                  <select value={filterMember} onChange={e=>setFilterMember(e.target.value)} style={selStyle}>
                    {TEAM_MEMBERS.map(m=><option key={m}>{m}</option>)}
                  </select>
                )}
              </div>
              <div style={{fontSize:11,color:T.textSub}}>{filteredDisplay.length} shown{summary?` · ${summary}`:""}</div>
            </div>
          );
        })():(<>
        {/* Summary pills */}
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
          {Object.entries(summaryByStatus).filter(([,v])=>v>0).map(([s,v])=>{
            const sc=statusColors[s]||statusColors["Not Started"];
            return <div key={s} style={{background:sc.bg,color:sc.color,fontSize:12,fontWeight:700,padding:"5px 14px",borderRadius:20}}>{v} {s}</div>;
          })}
          <div style={{background:T.bg,color:T.textSub,fontSize:12,fontWeight:700,padding:"5px 14px",borderRadius:20,border:bdr}}>{allTasks.length} Total Tasks</div>
        </div>
        {/* View tabs */}
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {[["my","My Tasks"],["assigned","Delegated by Me"],["member","By Team Member"],["unassigned","Unassigned"],["all","All Tasks"]].map(([k,l])=>{
            const active=views.has(k);
            return(
              <button key={k} onClick={()=>setViews(prev=>{const n=new Set(prev);active?n.delete(k):n.add(k);return n;})}
                style={{padding:"7px 16px",borderRadius:20,border:`1.5px solid ${active?T.gold:T.border}`,background:active?T.goldLight:"transparent",color:active?T.gold:T.textSub,fontWeight:active?700:400,fontSize:13,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
                {active&&<span style={{fontSize:10}}>✓</span>}{l}{k==="my"&&myTasks.length>0?` (${myTasks.length})`:k==="unassigned"?` (${unassignedTasks.length})`:""}
              </button>
            );
          })}
        </div>
        </>)}
      </div>

      <div style={{flex:1,overflowY:"auto",padding:isMobile?"14px 12px":"20px 28px"}}>

        {showAutomations&&(
          <div style={{maxWidth:720}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:17,fontWeight:700,color:T.text}}>Automation Rules</div>
                <div style={{fontSize:13,color:T.textSub,marginTop:2}}>When a property reaches a stage, automatically add tasks assigned to team members</div>
              </div>
              <button onClick={()=>setShowAutoBuilder(v=>!v)} style={{padding:"9px 18px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>+ New Rule</button>
            </div>

            {/* New automation builder */}
            {showAutoBuilder&&(
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,padding:20,marginBottom:16}}>
                <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:14}}>New Automation Rule</div>
                {/* Trigger */}
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>When status becomes</div>
                  <select value={newAuto.trigger} onChange={e=>setNewAuto(a=>({...a,trigger:e.target.value}))}
                    style={{width:"100%",padding:"9px 12px",borderRadius:T.radiusSm,border:bdr,background:T.bg,color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}>
                    {["Under Contract","Purchased","Under Construction","On Market","In Closing"].map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                {/* Task list */}
                <div style={{marginBottom:12}}>
                  <div style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Tasks to create</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {newAuto.tasks.map((task,i)=>(
                      <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 180px auto",gap:8,alignItems:"center",background:T.bg,borderRadius:T.radiusSm,padding:"10px 12px"}}>
                        <input value={task.text} onChange={e=>setNewAuto(a=>({...a,tasks:a.tasks.map((t,j)=>j===i?{...t,text:e.target.value}:t)}))}
                          placeholder="Task description…"
                          style={{padding:"7px 10px",borderRadius:7,border:bdr,background:"#fff",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                        <select value={task.assignTo} onChange={e=>setNewAuto(a=>({...a,tasks:a.tasks.map((t,j)=>j===i?{...t,assignTo:e.target.value}:t)}))}
                          style={{padding:"7px 10px",borderRadius:7,border:bdr,background:"#fff",color:task.assignTo?T.text:T.textTert,fontSize:13,outline:"none",fontFamily:"inherit"}}>
                          <option value="">— Assign to —</option>
                          {TEAM_MEMBERS.map(m=><option key={m}>{m}</option>)}
                        </select>
                        <button onClick={()=>setNewAuto(a=>({...a,tasks:a.tasks.filter((_,j)=>j!==i)}))}
                          style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:18,lineHeight:1,padding:"2px 4px"}}
                          onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textTert}>×</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>setNewAuto(a=>({...a,tasks:[...a.tasks,{text:"",assignTo:"",category:"Custom"}]}))}
                    style={{marginTop:8,width:"100%",padding:"9px",borderRadius:T.radiusSm,background:"transparent",border:`1.5px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>
                    + Add Another Task
                  </button>
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                  <button onClick={()=>setShowAutoBuilder(false)} style={{padding:"9px 18px",borderRadius:T.radiusSm,background:T.bg,border:bdr,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>Cancel</button>
                  <button onClick={()=>{
                    const validTasks=newAuto.tasks.filter(t=>t.text.trim());
                    if(validTasks.length===0) return;
                    setAutomations([...automations,{id:Date.now(),trigger:newAuto.trigger,tasks:validTasks}]);
                    setNewAuto({trigger:"Under Contract",tasks:[{text:"",assignTo:"",category:"Custom"}]});
                    setShowAutoBuilder(false);
                  }} style={{padding:"9px 20px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Save Rule</button>
                </div>
              </div>
            )}

            {/* Existing automations */}
            {automations.length===0&&!showAutoBuilder&&(
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,padding:32,textAlign:"center",color:T.textTert,fontSize:14}}>
                No automation rules yet. Create one above to automatically assign tasks when a property changes status.
              </div>
            )}
            {automations.map(auto=>{
              const sc=SC[auto.trigger]||{color:T.gold,bg:T.goldLight};
              const tasks=auto.tasks||[{text:auto.taskText,assignTo:auto.assignTo,category:auto.category}];
              return(
                <div key={auto.id} style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,padding:"14px 18px",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:tasks.length>0?10:0}}>
                    <span style={{background:sc.bg,color:sc.color,fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,flexShrink:0}}>{auto.trigger}</span>
                    <span style={{fontSize:13,color:T.textSub,flex:1}}>{tasks.length} task{tasks.length!==1?"s":""} will be created</span>
                    <button onClick={()=>setAutomations(automations.filter(a=>a.id!==auto.id))} style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:18,lineHeight:1}}
                      onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textTert}>×</button>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {tasks.map((t,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:10,background:T.bg,borderRadius:T.radiusSm,padding:"8px 12px"}}>
                        <span style={{fontSize:13,color:T.text,flex:1}}>{t.text}</span>
                        {t.assignTo&&<span style={{fontSize:11,fontWeight:600,color:T.blue,background:"#EBF4FF",padding:"3px 9px",borderRadius:20,flexShrink:0}}>{t.assignTo}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Task list views */}
        {!showAutomations&&(
          <div style={{maxWidth:840}}>
            {/* Filter bar (desktop only — mobile uses the compact dropdowns in the header) */}
            {!isMobile&&<div style={{display:"flex",gap:10,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
              {views.has("member")&&(
                <select value={filterMember} onChange={e=>setFilterMember(e.target.value)}
                  style={{padding:"7px 12px",borderRadius:T.radiusSm,border:bdr,background:T.card,color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}>
                  {TEAM_MEMBERS.map(m=><option key={m}>{m}</option>)}
                </select>
              )}
              {/* Property filter (multi-select) */}
              <MultiSelect placeholder="All Properties" selected={filterProps} onToggle={togglePropFilter} options={propOptions} style={{flex:"0 0 auto",width:220}}/>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {TASK_STATUSES.map(s=>{
                  const sc=TASK_STATUS_COLORS[s];
                  const active=statusFilter.has(s);
                  return(
                    <button key={s} onClick={()=>setStatusFilter(prev=>{const n=new Set(prev);active?n.delete(s):n.add(s);return n;})}
                      style={{padding:"5px 13px",borderRadius:20,border:`1.5px solid ${active?sc.color:T.border}`,background:active?sc.bg:"transparent",color:active?sc.color:T.textSub,fontSize:12,fontWeight:active?700:400,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
                      {active&&<span style={{fontSize:10}}>✓</span>}{s}
                    </button>
                  );
                })}
                {statusFilter.size>0&&<button onClick={()=>setStatusFilter(new Set())} style={{padding:"5px 13px",borderRadius:20,border:`1.5px solid ${T.border}`,background:"transparent",color:T.textTert,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Clear</button>}
              </div>
              <div style={{marginLeft:"auto",fontSize:12,color:T.textSub}}>{filteredDisplay.length} tasks</div>
            </div>}

            {/* Select / bulk-actions toolbar */}
            {filteredDisplay.length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,flexWrap:"wrap"}}>
                {!selectMode
                  ? <button onClick={()=>setSelectMode(true)} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>☑ Select</button>
                  : <>
                      <span style={{fontSize:13,fontWeight:600,color:T.text}}>{selectedKeys.size} selected</span>
                      <select value="" onChange={e=>{if(e.target.value)setSelectedStatus(e.target.value);}} disabled={selectedKeys.size===0}
                        style={{padding:"6px 10px",borderRadius:20,border:`1px solid ${T.border}`,background:selectedKeys.size?T.card:T.bg,color:selectedKeys.size?T.text:T.textTert,fontSize:12,fontWeight:600,cursor:selectedKeys.size?"pointer":"default",fontFamily:"inherit",outline:"none"}}>
                        <option value="">Mark as…</option>
                        {TASK_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={deleteSelected} disabled={selectedKeys.size===0} style={{padding:"6px 14px",borderRadius:20,border:"none",background:selectedKeys.size?T.red:T.border,color:"#fff",fontSize:12,fontWeight:700,cursor:selectedKeys.size?"pointer":"default",fontFamily:"inherit"}}>🗑 Delete</button>
                      <button onClick={()=>{setSelectMode(false);setSelectedKeys(new Set());}} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${T.border}`,background:"transparent",color:T.textSub,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                    </>}
              </div>
            )}

            {filteredDisplay.length===0&&(
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,padding:40,textAlign:"center",color:T.textTert,fontSize:14}}>
                {views.has("my")?"No tasks assigned to you yet."
                :views.has("unassigned")?"No unassigned tasks."
                :views.has("assigned")?"You haven't assigned any tasks yet."
                :views.has("member")?`No tasks assigned to ${filterMember}.`
                :"No tasks found."}
              </div>
            )}

            {/* Group by property */}
            {Object.entries(filteredDisplay.reduce((acc,t)=>{(acc[t.propAddr]=acc[t.propAddr]||[]).push(t);return acc;},{})).map(([addr,ptasks])=>(
              <div key={addr} style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,overflow:"hidden",marginBottom:14}}>
                <div style={{padding:"10px 14px",background:"#FAFAFA",borderBottom:bdr,display:"flex",flexDirection:"column",gap:7}}>
                  {/* Row 1: address + delete */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                    <span onClick={()=>onNavigate&&ptasks[0]&&onNavigate(ptasks[0].propId)} title="Open this property" style={{fontSize:13,fontWeight:700,color:T.text,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:onNavigate?"pointer":"default"}}>{addr}</span>
                    {confirmDeleteProp===addr
                      ?<div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                          <span style={{fontSize:12,color:T.red}}>Delete {ptasks.length}?</span>
                          <button onClick={()=>{ptasks.forEach(t=>deleteTask(t.propId,t.id));setConfirmDeleteProp(null);}}
                            style={{padding:"3px 10px",borderRadius:6,background:T.red,border:"none",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Yes</button>
                          <button onClick={()=>setConfirmDeleteProp(null)}
                            style={{padding:"3px 10px",borderRadius:6,background:T.bg,border:`1px solid ${T.border}`,color:T.textSub,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>No</button>
                        </div>
                      :<button onClick={()=>setConfirmDeleteProp(addr)} title="Delete all tasks for this property"
                          style={{flexShrink:0,background:"none",border:`1px solid ${T.border}`,color:T.textTert,cursor:"pointer",fontSize:13,fontFamily:"inherit",padding:"3px 9px",borderRadius:6,lineHeight:1}}
                          onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red;}}
                          onMouseLeave={e=>{e.currentTarget.style.color=T.textTert;e.currentTarget.style.borderColor=T.border;}}>🗑</button>}
                  </div>
                  {/* Row 2: status chip + done — always the same position, all properties aligned */}
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    {(()=>{const sc=SC[ptasks[0]?.propStatus]||{};return <span style={{fontSize:10,fontWeight:700,color:sc.color,background:sc.bg,padding:"3px 9px",borderRadius:20,whiteSpace:"nowrap"}}>{ptasks[0]?.propStatus}</span>;})()}
                    <span style={{fontSize:11,color:T.textSub}}>{ptasks.filter(t=>t.status==="Completed").length}/{ptasks.length} done</span>
                  </div>
                </div>
                {ptasks.map(t=><TaskRow key={t.id} t={t} onStatusChange={updateTaskStatus} onDelete={deleteTask} onContact={setTaskContactTarget} onMessage={setTaskMsgTarget} onAssign={setTaskAssignTarget} currentUser={CURRENT_USER} selectMode={selectMode} selected={selectedKeys.has(selKey(t))} onToggleSelect={toggleSelect}/>)}
                <AddTaskInline onAdd={(text)=>addTaskToProp(ptasks[0].propId,text)}/>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Parse a vCard (.vcf) file (as exported from iPhone/iCloud Contacts) into contacts.
function parseVCards(text){
  const unfolded=String(text).replace(/\r\n/g,"\n").replace(/\n[ \t]/g,"");
  const clean=(v)=>v.replace(/\\n/gi,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\").trim();
  const out=[];let cur=null;
  for(const line of unfolded.split("\n")){
    const L=line.trim();
    if(/^BEGIN:VCARD$/i.test(L)){cur={tels:[],emails:[]};continue;}
    if(/^END:VCARD$/i.test(L)){if(cur)out.push(cur);cur=null;continue;}
    if(!cur)continue;
    const idx=L.indexOf(":");if(idx<0)continue;
    const rawKey=L.slice(0,idx);
    const key=rawKey.split(";")[0].toUpperCase().split(".").pop();
    const val=L.slice(idx+1);
    if(key==="FN")cur.fn=clean(val);
    else if(key==="N"&&!cur.n){const p=val.split(";").map(clean);cur.n=`${p[1]||""} ${p[0]||""}`.trim();}
    else if(key==="TEL"){
      const ty=(rawKey.toUpperCase().match(/TYPE=([A-Z,]+)/)||[])[1]||"";
      const label=/CELL|IPHONE/.test(ty)?"Mobile":/FAX/.test(ty)?"Fax":/WORK/.test(ty)?"Office":/HOME/.test(ty)?"Home":/MAIN/.test(ty)?"Main":"Phone";
      cur.tels.push({label,number:clean(val)});
    }
    else if(key==="EMAIL")cur.emails.push(clean(val));
    else if(key==="ORG")cur.org=clean(val).replace(/;+$/,"").replace(/;/g," · ");
    else if(key==="TITLE")cur.title=clean(val);
  }
  return out.map(c=>({name:c.fn||c.n||"",company:c.org||"",role:c.title||"",email:c.emails[0]||"",phones:c.tels}))
    .filter(c=>c.name||c.phones.length||c.email);
}
// Parse CSV text (handles quoted fields, commas/newlines inside quotes).
function parseCSV(text){
  const s=String(text).replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const rows=[];let row=[],cur="",inQ=false;
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(inQ){ if(ch==='"'){ if(s[i+1]==='"'){cur+='"';i++;} else inQ=false; } else cur+=ch; }
    else{ if(ch==='"')inQ=true; else if(ch===","){row.push(cur);cur="";} else if(ch==="\n"){row.push(cur);rows.push(row);row=[];cur="";} else cur+=ch; }
  }
  if(cur!==""||row.length){row.push(cur);rows.push(row);}
  const clean=rows.filter(r=>r.some(c=>String(c).trim()!==""));
  if(!clean.length)return {headers:[],rows:[]};
  return {headers:clean[0].map(h=>String(h).trim()),rows:clean.slice(1)};
}
// Guess which contact field a spreadsheet column maps to, from its header.
const CONTACT_FIELDS=[{v:"",l:"— Skip —"},{v:"name",l:"Name"},{v:"company",l:"Company"},{v:"role",l:"Title / role"},{v:"phone",l:"Phone"},{v:"email",l:"Email"},{v:"tags",l:"Tags"},{v:"notes",l:"Notes"}];
const guessField=(h)=>{const s=(h||"").toLowerCase();
  if(/company|organization|\borg\b|business|employer/.test(s))return "company";
  if(/e-?mail/.test(s))return "email";
  if(/phone|mobile|cell|tel|fax|number|whats/.test(s))return "phone";
  if(/title|role|position|\bjob\b/.test(s))return "role";
  if(/tag|trade|\btype\b|category|specialt|service/.test(s))return "tags";
  if(/note|comment|descr/.test(s))return "notes";
  if(/name/.test(s))return "name";
  return "";
};
const PHONE_LABELS=["Mobile","Office","Home","Fax","WhatsApp","Direct","Other"];
const TAG_SUGGEST=["General Contractor","Plumber","Electrician","HVAC","Roofer","Handyman","Landscaper","Painter","Realtor","Attorney","Inspector","Appraiser","Lender","Title Company","Wholesaler","Architect"];
// Normalize a stored contact into the richer shape (back-compat with old {phone,role}).
const normContact=(c)=>({
  id:c.id, name:c.name||"", company:c.company||"", role:c.role||"", email:c.email||"", notes:c.notes||"",
  phones:Array.isArray(c.phones)&&c.phones.length?c.phones.filter(p=>p&&String(p.number||"").trim()):(String(c.phone||"").trim()?[{label:"Mobile",number:c.phone}]:[]),
  tags:Array.isArray(c.tags)?c.tags.filter(Boolean):(typeof c.tags==="string"&&c.tags?[c.tags]:[]),
});
const sameCompany=(a,b)=>a&&b&&a.trim().toLowerCase()===b.trim().toLowerCase();
// ─── Contacts — company directory (search, add/edit, import from iPhone) ───────
function ContactsPage(){
  const { contacts, setContacts, flushContacts }=useData();
  const isMobile=useIsMobile();
  const[selId,setSelId]=useState(null);
  const[search,setSearch]=useState("");
  const[editing,setEditing]=useState(null); // draft contact being added/edited
  const[importMsg,setImportMsg]=useState("");
  const[csvData,setCsvData]=useState(null); // {headers,rows} awaiting column mapping
  const[mapping,setMapping]=useState([]);   // field per column
  const fileRef=useRef(null);
  const saveNow=()=>{if(flushContacts)setTimeout(flushContacts,0);};
  const q=search.trim().toLowerCase();
  const dir=contacts.map(normContact);
  const matches=(c)=>!q||[c.name,c.company,c.role,c.notes,...(c.tags||[]),...(c.phones||[]).map(p=>p.number),c.email].filter(Boolean).join(" ").toLowerCase().includes(q);
  const list=dir.filter(matches).sort((a,b)=>(a.company||"~").toLowerCase().localeCompare((b.company||"~").toLowerCase())||(a.name||"").localeCompare(b.name||""));
  const sel=dir.find(c=>c.id===selId)||null;
  const colleagues=sel&&sel.company?dir.filter(c=>c.id!==sel.id&&sameCompany(c.company,sel.company)):[];
  const companies=[...new Set(dir.map(c=>c.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const save=(c)=>{
    const phones=(c.phones||[]).map(p=>({label:(p.label||"Mobile").trim()||"Mobile",number:String(p.number||"").trim()})).filter(p=>p.number);
    const clean={id:c.id||Date.now(),name:(c.name||"").trim(),company:(c.company||"").trim(),role:(c.role||"").trim(),email:(c.email||"").trim(),notes:(c.notes||"").trim(),phones,tags:(c.tags||[]).map(t=>t.trim()).filter(Boolean),phone:phones[0]?.number||""};
    if(!clean.name&&!clean.phones.length&&!clean.email&&!clean.company)return;
    setContacts(prev=>prev.some(x=>x.id===clean.id)?prev.map(x=>x.id===clean.id?clean:x):[...prev,clean]);
    saveNow();setEditing(null);setSelId(clean.id);
  };
  const del=(id)=>{if(!window.confirm("Delete this contact?"))return;setContacts(prev=>prev.filter(x=>x.id!==id));saveNow();setSelId(null);setEditing(null);};
  const dedupKey=(c)=>`${(c.name||"").toLowerCase()}|${((c.phones&&c.phones[0]&&c.phones[0].number)||c.phone||"").replace(/\D/g,"")}`;
  const addImported=(built)=>{
    const seen=new Set(dir.map(dedupKey));const fresh=[];
    built.forEach(c=>{const k=dedupKey(c);if(!seen.has(k)){seen.add(k);fresh.push(c);}});
    if(!fresh.length){setImportMsg("No new contacts to import (already in your directory).");return;}
    setContacts(prev=>[...prev,...fresh.map((c,i)=>({id:Date.now()+i,name:c.name||"",company:c.company||"",role:c.role||"",email:c.email||"",notes:c.notes||"",phones:c.phones||[],tags:c.tags||[],phone:(c.phones&&c.phones[0]&&c.phones[0].number)||""}))]);
    saveNow();
    const dup=built.length-fresh.length;
    setImportMsg(`Imported ${fresh.length} contact${fresh.length!==1?"s":""}${dup>0?` · ${dup} skipped (already there)`:""}.`);
  };
  const onImport=async(e)=>{
    const file=e.target.files&&e.target.files[0];if(fileRef.current)fileRef.current.value="";if(!file)return;
    setImportMsg("");setCsvData(null);
    try{
      const text=await file.text();
      if(/\.vcf$/i.test(file.name)||/BEGIN:VCARD/i.test(text)){
        const parsed=parseVCards(text);
        if(!parsed.length){setImportMsg("No contacts found in that file.");return;}
        addImported(parsed);
      }else{
        const parsed=parseCSV(text);
        if(!parsed.headers.length){setImportMsg("Couldn't read that file. Save your Excel sheet as CSV and try again.");return;}
        setCsvData(parsed);setMapping(parsed.headers.map(guessField));
      }
    }catch{setImportMsg("Couldn't read that file. Save it as CSV (or export contacts as .vcf) and try again.");}
  };
  const importCsv=()=>{
    if(!csvData)return;
    const{headers,rows}=csvData;
    const cols=(field)=>mapping.map((f,i)=>f===field?i:-1).filter(i=>i>=0);
    const first=(row,field)=>{const c=cols(field);for(const i of c){const v=(row[i]||"").trim();if(v)return v;}return "";};
    const built=rows.map(row=>({
      name:first(row,"name"),company:first(row,"company"),role:first(row,"role"),email:first(row,"email"),
      notes:cols("notes").map(i=>(row[i]||"").trim()).filter(Boolean).join("\n"),
      phones:cols("phone").map(i=>({label:headers[i]||"Phone",number:(row[i]||"").trim()})).filter(p=>p.number),
      tags:cols("tags").flatMap(i=>String(row[i]||"").split(/[;,/|]/)).map(t=>t.trim()).filter(Boolean),
    })).filter(c=>c.name||c.phones.length||c.email||c.company);
    if(!built.length){setImportMsg("No contacts found — check your column mapping.");return;}
    addImported(built);setCsvData(null);setMapping([]);
  };
  const iS={width:"100%",padding:"10px 12px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  const initials=(n)=>initialsOf(n)||"?";
  const actBtn={display:"inline-flex",alignItems:"center",gap:6,padding:"9px 14px",borderRadius:T.radiusSm,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit",textDecoration:"none"};
  const showDetail=isMobile?(!!sel||!!editing):true;
  return(
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      <div style={{width:isMobile?"100%":300,flexShrink:0,display:isMobile&&showDetail?"none":"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${T.border}`,background:T.card,overflow:"hidden"}}>
        <div style={{padding:"14px 14px 10px",borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
            <div><div style={{fontWeight:700,fontSize:15,color:T.text}}>Contacts</div><div style={{fontSize:11,color:T.textSub,marginTop:1}}>{contacts.length} in directory</div></div>
            <div style={{display:"flex",gap:6}}>
              <input ref={fileRef} type="file" accept=".vcf,.csv,text/csv,text/vcard,text/x-vcard" onChange={onImport} style={{display:"none"}}/>
              <button onClick={()=>fileRef.current&&fileRef.current.click()} title="Import from a .vcf or .csv file" style={{height:32,padding:"0 10px",borderRadius:8,background:T.bg,border:"none",cursor:"pointer",color:T.textSub,fontSize:12,fontWeight:600,fontFamily:"inherit"}}>⇪ Import</button>
              <button onClick={()=>{setEditing({});setSelId(null);}} title="Add contact" style={{width:32,height:32,borderRadius:8,background:T.gold,border:"none",cursor:"pointer",color:"#fff",fontWeight:700,fontSize:20,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            </div>
          </div>
          {importMsg&&<div style={{marginBottom:8,fontSize:11.5,color:T.gold,fontWeight:600}}>{importMsg}</div>}
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:T.textTert,fontSize:15,pointerEvents:"none"}}>⌕</span>
            <input placeholder="Search name, role, phone…" value={search} onChange={e=>setSearch(e.target.value)} style={{...iS,paddingLeft:28,fontSize:13,padding:"7px 10px 7px 28px"}}/>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {list.length===0&&<div style={{padding:24,textAlign:"center",color:T.textTert,fontSize:13}}>{contacts.length===0?"No contacts yet. Add one, or import a .vcf.":"No matches."}</div>}
          {list.map(c=>{
            const active=c.id===selId;
            return(
              <div key={c.id} onClick={()=>{setSelId(c.id);setEditing(null);}} style={{display:"flex",alignItems:"center",gap:11,padding:"10px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,background:active?T.goldLight:"transparent",borderLeft:active?`3px solid ${T.gold}`:"3px solid transparent"}}>
                <span style={{width:34,height:34,borderRadius:"50%",background:avatarColor(c.name),color:"#fff",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{initials(c.name)}</span>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:13,fontWeight:active?700:600,color:active?T.gold:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name||"(no name)"}</div>
                  <div style={{fontSize:11.5,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{[c.company,c.role].filter(Boolean).join(" · ")||(c.tags[0]||"")||(c.phones[0]&&c.phones[0].number)||c.email||""}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{flex:1,display:isMobile&&!showDetail?"none":"flex",flexDirection:"column",overflow:"hidden",background:T.bg}}>
        {editing!==null
          ? <ContactForm draft={editing} isMobile={isMobile} companies={companies} onSave={save} onCancel={()=>{setEditing(null);}} onDelete={editing.id?()=>del(editing.id):null}/>
          : sel
            ? <div style={{flex:1,overflowY:"auto"}}>
                {isMobile&&<button onClick={()=>setSelId(null)} style={{display:"flex",alignItems:"center",gap:4,padding:"11px 14px",background:T.card,border:"none",borderBottom:`1px solid ${T.border}`,color:T.gold,fontWeight:600,fontSize:15,fontFamily:"inherit",cursor:"pointer",width:"100%",textAlign:"left"}}>‹ Contacts</button>}
                <div style={{padding:"24px 20px",maxWidth:520,margin:"0 auto"}}>
                  <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16}}>
                    <span style={{width:56,height:56,borderRadius:"50%",background:avatarColor(sel.name),color:"#fff",fontSize:20,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{initials(sel.name)}</span>
                    <div style={{minWidth:0}}>
                      <div style={{fontSize:20,fontWeight:700,color:T.text}}>{sel.name||"(no name)"}</div>
                      {(sel.company||sel.role)&&<div style={{fontSize:13,color:T.textSub,marginTop:2}}>{sel.role&&<span>{sel.role}{sel.company?" · ":""}</span>}{sel.company&&<span onClick={()=>{setSearch(sel.company);}} style={{color:T.gold,fontWeight:600,cursor:"pointer"}}>{sel.company}</span>}</div>}
                    </div>
                  </div>
                  {sel.tags.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>{sel.tags.map(t=><span key={t} onClick={()=>setSearch(t)} style={{fontSize:11,fontWeight:600,color:"#b8912e",background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:20,padding:"3px 10px",cursor:"pointer"}}>{t}</span>)}</div>}
                  <Card>
                    {sel.phones.map((p,i)=>(
                      <div key={i} style={{padding:"11px 16px",borderBottom:(i<sel.phones.length-1||sel.email||sel.notes)?`1px solid ${T.border}`:"none"}}>
                        <div style={{fontSize:10.5,color:T.textTert,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:5}}>{p.label||"Phone"}</div>
                        <div style={{fontSize:15,color:T.text,marginBottom:8}}>{p.number}</div>
                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><a href={`tel:${p.number.replace(/[^\d+]/g,"")}`} style={{...actBtn,background:"#fff",border:`1px solid ${T.border}`,color:T.textSub}}>📞 Call</a><a href={`sms:${p.number.replace(/[^\d+]/g,"")}`} style={{...actBtn,background:"#EDFBF1",border:`1px solid ${T.green}`,color:"#15803D"}}>💬 Text</a></div>
                      </div>
                    ))}
                    {sel.email&&<div style={{padding:"11px 16px",borderBottom:sel.notes?`1px solid ${T.border}`:"none"}}><div style={{fontSize:10.5,color:T.textTert,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:5}}>Email</div><a href={`mailto:${sel.email}`} style={{fontSize:15,color:T.blue,textDecoration:"none"}}>{sel.email}</a></div>}
                    {sel.notes&&<div style={{padding:"11px 16px"}}><div style={{fontSize:10.5,color:T.textTert,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:5}}>Notes</div><div style={{fontSize:14,color:T.text,whiteSpace:"pre-wrap",lineHeight:1.5}}>{sel.notes}</div></div>}
                    {sel.phones.length===0&&!sel.email&&!sel.notes&&<div style={{padding:"16px",fontSize:13,color:T.textTert}}>No phone, email, or notes yet.</div>}
                  </Card>
                  {colleagues.length>0&&(
                    <Card style={{marginTop:14}}>
                      <div style={{padding:"11px 16px 8px",fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em"}}>Others at {sel.company} ({colleagues.length})</div>
                      {colleagues.map(c=>(
                        <div key={c.id} onClick={()=>setSelId(c.id)} style={{display:"flex",alignItems:"center",gap:11,padding:"10px 16px",cursor:"pointer",borderTop:`1px solid ${T.border}`}}>
                          <span style={{width:32,height:32,borderRadius:"50%",background:avatarColor(c.name),color:"#fff",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{initials(c.name)}</span>
                          <div style={{minWidth:0,flex:1}}><div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</div><div style={{fontSize:11.5,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.role||(c.phones[0]&&c.phones[0].number)||""}</div></div>
                          <span style={{fontSize:15,color:T.textTert}}>›</span>
                        </div>
                      ))}
                    </Card>
                  )}
                  <div style={{display:"flex",gap:10,marginTop:16}}>
                    <button onClick={()=>setEditing(sel)} style={{padding:"9px 18px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
                    <button onClick={()=>del(sel.id)} style={{padding:"9px 18px",borderRadius:T.radiusSm,background:"#fff",border:`1px solid ${T.red}`,color:T.red,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>
                  </div>
                </div>
              </div>
            : <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:T.textSub}}>
                <div style={{width:64,height:64,borderRadius:18,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>👥</div>
                <div style={{fontSize:16,fontWeight:600}}>Select a contact</div>
                <div style={{fontSize:13,color:T.textTert}}>Or tap + to add one, ⇪ to import from your phone</div>
              </div>}
      </div>
      {/* CSV column-mapping modal */}
      {csvData&&(
        <div onClick={()=>setCsvData(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:420,display:"flex",alignItems:"center",justifyContent:"center",padding:16,boxSizing:"border-box",backdropFilter:"blur(4px)"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"min(520px,96vw)",maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 48px rgba(0,0,0,0.25)"}}>
            <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div><div style={{fontSize:17,fontWeight:700,color:T.text}}>Map your columns</div><div style={{fontSize:12,color:T.textSub,marginTop:2}}>{csvData.rows.length} row{csvData.rows.length!==1?"s":""} · match each column to a contact field</div></div>
              <button onClick={()=>setCsvData(null)} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{overflowY:"auto",padding:"12px 20px"}}>
              {csvData.headers.map((h,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:12,padding:"9px 0",borderBottom:`1px solid ${T.border}`}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{h||`Column ${i+1}`}</div>
                    <div style={{fontSize:11,color:T.textTert,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(csvData.rows[0]&&csvData.rows[0][i])||""}</div>
                  </div>
                  <select value={mapping[i]||""} onChange={e=>setMapping(m=>m.map((v,j)=>j===i?e.target.value:v))} style={{width:150,flexShrink:0,padding:"8px 10px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:13,fontFamily:"inherit",background:"#fff",color:mapping[i]?T.text:T.textTert}}>
                    {CONTACT_FIELDS.map(f=><option key={f.v} value={f.v}>{f.l}</option>)}
                  </select>
                </div>
              ))}
              <div style={{fontSize:11.5,color:T.textTert,marginTop:10,lineHeight:1.5}}>Tip: map several columns to <b>Phone</b> (e.g. Mobile + Office) — each becomes its own labeled number. A <b>Tags</b> column can hold comma-separated trades.</div>
            </div>
            <div style={{padding:"12px 20px",borderTop:`1px solid ${T.border}`,display:"flex",gap:10,justifyContent:"flex-end"}}>
              <button onClick={()=>setCsvData(null)} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Cancel</button>
              <button onClick={importCsv} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Import {csvData.rows.length}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function ContactForm({draft,isMobile,companies=[],onSave,onCancel,onDelete}){
  const nd=normContact(draft);
  const[c,setC]=useState({id:draft.id,name:nd.name,company:nd.company,role:nd.role,email:nd.email,notes:nd.notes,
    phones:nd.phones.length?nd.phones:[{label:"Mobile",number:""}],tags:[...nd.tags]});
  const[tagInput,setTagInput]=useState("");
  const up=(k,v)=>setC(p=>({...p,[k]:v}));
  const setPhone=(i,k,v)=>setC(p=>({...p,phones:p.phones.map((ph,j)=>j===i?{...ph,[k]:v}:ph)}));
  const addPhone=()=>setC(p=>({...p,phones:[...p.phones,{label:"Office",number:""}]}));
  const rmPhone=(i)=>setC(p=>({...p,phones:p.phones.filter((_,j)=>j!==i)}));
  const addTag=(t)=>{const v=(t||"").trim();if(!v)return;setC(p=>p.tags.some(x=>x.toLowerCase()===v.toLowerCase())?p:{...p,tags:[...p.tags,v]});setTagInput("");};
  const rmTag=(t)=>setC(p=>({...p,tags:p.tags.filter(x=>x!==t)}));
  const iS={width:"100%",padding:"11px 13px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"inherit",background:"#fff"};
  const lbl={fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,display:"block"};
  return(
    <div style={{flex:1,overflowY:"auto",background:T.bg}}>
      {isMobile&&<button onClick={onCancel} style={{display:"flex",alignItems:"center",gap:4,padding:"11px 14px",background:T.card,border:"none",borderBottom:`1px solid ${T.border}`,color:T.gold,fontWeight:600,fontSize:15,fontFamily:"inherit",cursor:"pointer",width:"100%",textAlign:"left"}}>‹ Back</button>}
      <div style={{padding:"22px 20px",maxWidth:520,margin:"0 auto"}}>
        <div style={{fontSize:18,fontWeight:700,color:T.text,marginBottom:18}}>{draft.id?"Edit contact":"New contact"}</div>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div><label style={lbl}>Name</label><input autoFocus value={c.name} onChange={e=>up("name",e.target.value)} placeholder="Full name" style={iS}/></div>
          <div><label style={lbl}>Company / organization</label><input list="gs-companies" value={c.company} onChange={e=>up("company",e.target.value)} placeholder="e.g. ABC Plumbing" style={iS}/><datalist id="gs-companies">{companies.map(co=><option key={co} value={co}/>)}</datalist></div>
          <div><label style={lbl}>Title / role <span style={{textTransform:"none",fontWeight:400,color:T.textTert}}>(optional)</span></label><input value={c.role} onChange={e=>up("role",e.target.value)} placeholder="e.g. Owner, Project Manager" style={iS}/></div>
          {/* Phones */}
          <div>
            <label style={lbl}>Phone numbers</label>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {c.phones.map((ph,i)=>(
                <div key={i} style={{display:"flex",gap:8,alignItems:"center"}}>
                  <input list="gs-phlabels" value={ph.label} onChange={e=>setPhone(i,"label",e.target.value)} placeholder="Label" style={{...iS,width:96,flexShrink:0,padding:"11px 9px",fontSize:13}}/>
                  <input value={ph.number} onChange={e=>setPhone(i,"number",e.target.value)} placeholder="Number" inputMode="tel" style={{...iS,flex:1}}/>
                  {c.phones.length>1&&<button onClick={()=>rmPhone(i)} style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0,padding:"0 2px"}}>×</button>}
                </div>
              ))}
              <datalist id="gs-phlabels">{PHONE_LABELS.map(l=><option key={l} value={l}/>)}</datalist>
              <button onClick={addPhone} style={{alignSelf:"flex-start",padding:"7px 12px",borderRadius:T.radiusSm,background:"transparent",border:`1.5px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontFamily:"inherit",fontSize:12.5,fontWeight:600}}>+ Add number</button>
            </div>
          </div>
          <div><label style={lbl}>Email</label><input value={c.email} onChange={e=>up("email",e.target.value)} placeholder="Email" autoCapitalize="none" inputMode="email" style={iS}/></div>
          {/* Tags */}
          <div>
            <label style={lbl}>Tags <span style={{textTransform:"none",fontWeight:400,color:T.textTert}}>(trade / type)</span></label>
            {c.tags.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>{c.tags.map(t=><span key={t} style={{fontSize:12,fontWeight:600,color:"#b8912e",background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:20,padding:"3px 10px",display:"inline-flex",gap:5,alignItems:"center"}}>{t}<span onClick={()=>rmTag(t)} style={{cursor:"pointer",fontWeight:800}}>×</span></span>)}</div>}
            <input value={tagInput} onChange={e=>setTagInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addTag(tagInput);}}} placeholder="Type a tag + Enter (e.g. Plumber)" style={iS}/>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>{TAG_SUGGEST.filter(t=>!c.tags.some(x=>x.toLowerCase()===t.toLowerCase())&&(!tagInput||t.toLowerCase().includes(tagInput.toLowerCase()))).slice(0,8).map(t=><button key={t} onClick={()=>addTag(t)} style={{fontSize:12,fontWeight:500,color:T.textSub,background:"transparent",border:`1px solid ${T.border}`,borderRadius:20,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>+ {t}</button>)}</div>
          </div>
          <div><label style={lbl}>Notes</label><textarea value={c.notes} onChange={e=>up("notes",e.target.value)} placeholder="Any extra info…" rows={3} style={{...iS,resize:"vertical",lineHeight:1.5}}/></div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:20,alignItems:"center"}}>
          <button onClick={()=>onSave(c)} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Save</button>
          <button onClick={onCancel} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.textSub,fontWeight:600,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          {onDelete&&<button onClick={onDelete} style={{marginLeft:"auto",padding:"10px 16px",borderRadius:T.radiusSm,background:"#fff",border:`1px solid ${T.red}`,color:T.red,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>Delete</button>}
        </div>
      </div>
    </div>
  );
}
function ComingSoon({label}){
  return <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,background:T.bg}}><div style={{width:64,height:64,borderRadius:18,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🚧</div><div style={{fontSize:17,fontWeight:600,color:T.text}}>{label}</div><div style={{fontSize:14,color:T.textSub}}>Coming soon</div></div>;
}

// ─── Settings modal — currently houses Archived Properties ───────────────────
const ARCHIVE_DAYS=60;
const archiveDaysLeft=(p)=>{
  if(!p.archivedAt)return ARCHIVE_DAYS;
  const elapsed=Date.now()-new Date(p.archivedAt).getTime();
  return Math.max(0,Math.ceil(ARCHIVE_DAYS-elapsed/(24*60*60*1000)));
};
// Statuses that can trigger an automation rule.
const AUTO_TRIGGERS=["Under Contract","Purchased","Under Construction","On Market","In Closing"];
// Settings → Automations: build rules that add tasks when a property hits a status.
function AutomationsPanel(){
  const { automations, setAutomations, teamMembers:TEAM_MEMBERS } = useData();
  const { isAdmin } = useAuth();
  const rules=automations||[];
  const[showBuilder,setShowBuilder]=useState(false);
  const[editingId,setEditingId]=useState(null); // rule being edited (null = creating new)
  const[draft,setDraft]=useState({trigger:"Under Contract",tasks:[{text:"",assignTo:"",delegateTo:""}]});
  const bdr=`1px solid ${T.border}`;
  const blank={trigger:"Under Contract",tasks:[{text:"",assignTo:"",delegateTo:""}]};
  const startNew=()=>{setEditingId(null);setDraft(blank);setShowBuilder(true);};
  const startEdit=(auto)=>{setEditingId(auto.id);setDraft({trigger:auto.trigger,tasks:(auto.tasks&&auto.tasks.length?auto.tasks:[{text:"",assignTo:"",delegateTo:""}]).map(t=>({text:t.text||"",assignTo:t.assignTo||"",delegateTo:t.delegateTo||""}))});setShowBuilder(true);};
  const cancel=()=>{setShowBuilder(false);setEditingId(null);setDraft(blank);};
  const save=()=>{
    const validTasks=draft.tasks.filter(t=>t.text.trim()).map(t=>({text:t.text.trim(),assignTo:t.assignTo||"",delegateTo:(t.delegateTo&&t.delegateTo!==t.assignTo)?t.delegateTo:"",category:"Automation"}));
    if(validTasks.length===0)return;
    if(editingId)setAutomations(rules.map(r=>r.id===editingId?{...r,trigger:draft.trigger,tasks:validTasks}:r));
    else setAutomations([...rules,{id:Date.now(),trigger:draft.trigger,tasks:validTasks}]);
    cancel();
  };
  if(!isAdmin)return <div style={{fontSize:13,color:T.textSub,padding:"12px 0"}}>Only an admin can create or edit automations.</div>;
  return(
    <div>
      <div style={{fontSize:12,color:T.textSub,marginBottom:14}}>When a property's status changes to the trigger, these tasks are automatically added to it (assigned to whoever you pick). Each rule applies once per property.</div>
      {showBuilder&&(
        <div style={{background:T.bg,borderRadius:12,padding:16,marginBottom:14}}>
          <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:14}}>{editingId?"Edit Rule":"New Rule"}</div>
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6}}>When status becomes</div>
            <select value={draft.trigger} onChange={e=>setDraft(d=>({...d,trigger:e.target.value}))}
              style={{width:"100%",padding:"9px 12px",borderRadius:T.radiusSm,border:bdr,background:"#fff",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}>
              {AUTO_TRIGGERS.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8}}>Tasks to create</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {draft.tasks.map((task,i)=>{
              const selStyle=(v)=>({flex:1,minWidth:0,padding:"6px 8px",borderRadius:7,border:bdr,background:"#fff",color:v?T.text:T.textTert,fontSize:12,outline:"none",fontFamily:"inherit"});
              return(
              <div key={i} style={{background:"#fff",borderRadius:T.radiusSm,padding:"8px 10px",border:bdr}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                  <input value={task.text} onChange={e=>setDraft(d=>({...d,tasks:d.tasks.map((t,j)=>j===i?{...t,text:e.target.value}:t)}))} placeholder="Task description…"
                    style={{flex:1,minWidth:0,padding:"6px 8px",borderRadius:7,border:bdr,background:"#fff",color:T.text,fontSize:13,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>
                  {draft.tasks.length>1&&<button onClick={()=>setDraft(d=>({...d,tasks:d.tasks.filter((_,j)=>j!==i)}))} style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0}}>×</button>}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <select value={task.assignTo} onChange={e=>setDraft(d=>({...d,tasks:d.tasks.map((t,j)=>j===i?{...t,assignTo:e.target.value}:t)}))} style={selStyle(task.assignTo)}>
                    <option value="">— Owner —</option>
                    {(TEAM_MEMBERS||[]).map(m=><option key={m}>{m}</option>)}
                  </select>
                  <select value={task.delegateTo} onChange={e=>setDraft(d=>({...d,tasks:d.tasks.map((t,j)=>j===i?{...t,delegateTo:e.target.value}:t)}))} disabled={!task.assignTo} style={{...selStyle(task.delegateTo),opacity:task.assignTo?1:0.5}}>
                    <option value="">— Delegate (optional) —</option>
                    {(TEAM_MEMBERS||[]).filter(m=>m!==task.assignTo).map(m=><option key={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              );
            })}
          </div>
          <button onClick={()=>setDraft(d=>({...d,tasks:[...d.tasks,{text:"",assignTo:"",delegateTo:""}]}))}
            style={{marginTop:8,width:"100%",padding:"8px",borderRadius:T.radiusSm,background:"transparent",border:`1.5px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:600}}>+ Add another task</button>
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:14}}>
            <button onClick={cancel} style={{padding:"9px 16px",borderRadius:T.radiusSm,background:"#fff",border:bdr,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>Cancel</button>
            <button onClick={save} style={{padding:"9px 20px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{editingId?"Update Rule":"Save Rule"}</button>
          </div>
        </div>
      )}
      {!showBuilder&&<button onClick={startNew} style={{padding:"9px 18px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",marginBottom:14}}>+ New Rule</button>}
      {rules.length===0&&!showBuilder&&<div style={{padding:"24px 0",textAlign:"center",color:T.textTert,fontSize:13}}>No automation rules yet. Create one to auto-add tasks when a property reaches a status.</div>}
      {rules.map(auto=>{
        const sc=SC[auto.trigger]||{color:T.gold,bg:T.goldLight};
        const tasks=auto.tasks||[];
        return(
          <div key={auto.id} style={{border:bdr,borderRadius:12,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:tasks.length?10:0}}>
              <span style={{background:sc.bg,color:sc.color,fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,flexShrink:0}}>{auto.trigger}</span>
              <span style={{fontSize:12,color:T.textSub,flex:1}}>{tasks.length} task{tasks.length!==1?"s":""}</span>
              <button onClick={()=>startEdit(auto)} style={{background:"none",border:bdr,borderRadius:20,color:T.gold,cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"inherit",padding:"4px 12px",flexShrink:0}}>Edit</button>
              <button onClick={()=>setAutomations(rules.filter(a=>a.id!==auto.id))} title="Delete rule" style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0}}>×</button>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {tasks.map((t,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:8,background:T.bg,borderRadius:T.radiusSm,padding:"8px 12px"}}>
                  <span style={{fontSize:13,color:T.text,flex:1}}>{t.text}</span>
                  {t.assignTo&&<span style={{fontSize:11,fontWeight:600,color:T.blue,background:"#EBF4FF",padding:"3px 9px",borderRadius:20,flexShrink:0}}>{t.assignTo}</span>}
                  {t.delegateTo&&<span title={`Delegated to ${t.delegateTo}`} style={{fontSize:11,fontWeight:600,color:T.gold,background:T.goldLight,padding:"3px 9px",borderRadius:20,flexShrink:0}}>→ {t.delegateTo}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
// Score how well a folder name matches a property address (house # must match).
const folderMatchScore=(name,p)=>{
  const addr=`${p.address||""} ${p.city||""}`;
  const hn=qbHouseNum(addr),fhn=qbHouseNum(name||"");
  if(!hn||!fhn||hn!==fhn)return 0;
  const pw=new Set(qbStreetWords(addr));
  return 10+qbStreetWords(name||"").filter(w=>pw.has(w)).length;
};
// Recursively collect folders under a base folder (bounded depth + count).
async function gatherFolders(od,driveId,itemId,depth,acc){
  if(depth>3||acc.length>800)return;
  let kids=[];
  try{kids=await od.listChildren(driveId,itemId);}catch{return;}
  for(const k of kids){
    if(k.folder){
      acc.push({driveId,id:k.id,name:k.name});
      await gatherFolders(od,driveId,k.id,depth+1,acc);
    }
  }
}
// Settings → Property Files: set the "Flips" base folder once, auto-match every
// property to its subfolder by address, and fill in each property's Files tab.
function PropertyFilesPanel(){
  const { sharedProps, setSharedProps } = useData();
  const { prefs, savePrefs } = useAuth();
  const od=useOneDrive();
  const props=sharedProps.filter(p=>!p.archived);
  const[link,setLink]=useState(prefs.filesBaseLink||"");
  const[scanning,setScanning]=useState(false);
  const[error,setError]=useState("");
  const[result,setResult]=useState(null);
  const[applied,setApplied]=useState(0);
  const scan=async()=>{
    const url=link.trim();
    if(!url){setError("Paste the link to your Flips folder first.");return;}
    setScanning(true);setError("");setResult(null);setApplied(0);
    try{
      await savePrefs({filesBaseLink:url});
      const root=await od.resolveShareLink(url);
      if(!root.driveId){setError("Couldn't open that link. Use a SharePoint/OneDrive 'Copy link' URL to the Flips folder.");setScanning(false);return;}
      const folders=[];
      await gatherFolders(od,root.driveId,root.id,0,folders);
      const matched=[],unmatched=[];
      props.forEach(p=>{
        let best=null,bestScore=0;
        folders.forEach(f=>{const s=folderMatchScore(f.name,p);if(s>bestScore){bestScore=s;best=f;}});
        if(best)matched.push({p,folder:best});else unmatched.push(p);
      });
      setResult({matched,unmatched,folderCount:folders.length});
    }catch(e){setError(e.message||"Scan failed.");}
    setScanning(false);
  };
  const apply=()=>{
    if(!result)return;
    const map=new Map(result.matched.map(m=>[m.p.id,m.folder]));
    setSharedProps(prev=>prev.map(p=>{const f=map.get(p.id);return f?{...p,filesFolder:{driveId:f.driveId,id:f.id,name:f.name},filesShareLink:""}:p;}));
    setApplied(result.matched.length);
  };
  const inp={width:"100%",padding:"11px 13px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  const goldBtn=(txt,onClick,disabled)=><button onClick={onClick} disabled={disabled} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:disabled?T.border:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:13,cursor:disabled?"default":"pointer",fontFamily:"inherit"}}>{txt}</button>;
  if(!od.ready)return <div style={{fontSize:13,color:T.textSub}}>Connecting to Microsoft…</div>;
  if(!od.isConnected)return(
    <div>
      <div style={{fontSize:13,color:T.textSub,marginBottom:14,lineHeight:1.5}}>Sign in with your Microsoft account to connect your SharePoint files.</div>
      {goldBtn("Connect Microsoft",()=>od.signIn().catch(e=>setError(e.message)))}
      {error&&<div style={{marginTop:12,color:T.red,fontSize:13}}>{error}</div>}
    </div>
  );
  return(
    <div>
      <div style={{fontSize:12,color:T.textSub,marginBottom:12,lineHeight:1.55}}>Paste the <strong>Copy link</strong> to your <strong>Flips</strong> folder (the one whose subfolders are your properties). I'll scan its subfolders and match each property to its folder by address — then every property's <strong>Files</strong> tab opens automatically. You only do this once.</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
        <input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://…sharepoint.com/…/Flips" style={{...inp,flex:1,minWidth:220}}/>
        {goldBtn(scanning?"Scanning…":"Scan & match",scan,scanning)}
      </div>
      <div style={{fontSize:11,color:T.textTert,marginBottom:12}}>If a Microsoft sign-in appears when you scan, finish it — your link is saved, so just reopen this tab and tap <strong>Scan &amp; match</strong> again.</div>
      {error&&<div style={{marginBottom:12,padding:"10px 12px",background:"#FFF0EF",border:`1px solid ${T.red}`,borderRadius:T.radiusSm,color:T.red,fontSize:13}}>{error}</div>}
      {result&&(
        <div>
          <div style={{fontSize:13,color:T.text,fontWeight:600,marginBottom:4}}>Matched {result.matched.length} of {props.length} properties <span style={{color:T.textTert,fontWeight:400}}>· scanned {result.folderCount} folders</span></div>
          {applied>0
            ? <div style={{margin:"10px 0",padding:"10px 12px",background:"#EDFBF1",border:`1px solid ${T.green}`,borderRadius:T.radiusSm,color:"#15803D",fontSize:13,fontWeight:600}}>✓ Applied to {applied} propert{applied===1?"y":"ies"} — their Files tabs now open the matched folder.</div>
            : <div style={{margin:"10px 0"}}>{goldBtn(`Apply to ${result.matched.length} propert${result.matched.length===1?"y":"ies"}`,apply,result.matched.length===0)}</div>}
          <div style={{maxHeight:260,overflowY:"auto",border:`1px solid ${T.border}`,borderRadius:12}}>
            {result.matched.map(({p,folder})=>(
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderBottom:`1px solid ${T.border}`}}>
                <span style={{fontSize:14}}>📁</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.address}{p.city?`, ${p.city}`:""}</div>
                  <div style={{fontSize:11,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>→ {folder.name}</div>
                </div>
                <span style={{fontSize:12,color:T.green,fontWeight:700}}>✓</span>
              </div>
            ))}
            {result.unmatched.map(p=>(
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderBottom:`1px solid ${T.border}`,opacity:0.7}}>
                <span style={{fontSize:14}}>❓</span>
                <div style={{flex:1,minWidth:0,fontSize:13,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.address}{p.city?`, ${p.city}`:""}</div>
                <span style={{fontSize:11,color:T.textTert}}>no folder found</span>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:T.textTert,marginTop:8}}>Unmatched properties keep whatever folder you set manually. Re-scan anytime you add properties or folders.</div>
        </div>
      )}
    </div>
  );
}
function SettingsModal({archived,onRestore,onDelete,onClose}){
  const[section,setSection]=useState("archived");
  const fmtAddr=(p)=>`${p.address}${p.city?`, ${p.city}`:""}${p.state?`, ${p.state}`:""}${p.zip?` ${p.zip}`:""}`;
  const tab=(k,l)=>(
    <button key={k} onClick={()=>setSection(k)} style={{padding:"8px 14px",borderRadius:20,border:`1.5px solid ${section===k?T.gold:T.border}`,background:section===k?T.goldLight:"transparent",color:section===k?T.gold:T.textSub,fontWeight:section===k?700:500,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
  );
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16,boxSizing:"border-box",backdropFilter:"blur(4px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"min(640px,96vw)",maxHeight:"85vh",overflow:"hidden",display:"flex",flexDirection:"column",boxShadow:"0 12px 48px rgba(0,0,0,0.25)"}}>
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:17,fontWeight:700,color:T.text}}>Settings</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{padding:"12px 20px 0",display:"flex",gap:8,flexWrap:"wrap"}}>
          {tab("archived","Archived Properties")}
          {tab("automations","Automations")}
          {tab("files","Property Files")}
        </div>
        <div style={{overflowY:"auto",padding:"16px 20px"}}>
          {section==="archived"?(
            <>
              <div style={{fontSize:12,color:T.textSub,marginBottom:14}}>Archived properties are hidden from your lists and are permanently deleted 60 days after archiving. Restore one to bring it back, or delete it now.</div>
              {archived.length===0
                ? <div style={{padding:"24px 0",textAlign:"center",color:T.textTert,fontSize:13}}>No archived properties.</div>
                : archived.map(p=>{
                    const left=archiveDaysLeft(p);
                    return(
                      <div key={p.id} style={{border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 14px",marginBottom:10}}>
                        <div style={{fontSize:14,fontWeight:600,color:T.text}}>{fmtAddr(p)}</div>
                        <div style={{fontSize:12,color:left<=7?T.red:T.textSub,marginTop:2}}>
                          {left===0?"Deleting soon":`Deletes in ${left} day${left===1?"":"s"}`}{p.status?` · was ${p.status}`:""}
                        </div>
                        <div style={{display:"flex",gap:8,marginTop:10}}>
                          <button onClick={()=>onRestore(p.id)} style={{padding:"7px 14px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Restore</button>
                          <button onClick={()=>{if(window.confirm(`Permanently delete ${fmtAddr(p)}?\n\nThis cannot be undone.`))onDelete(p.id);}} style={{padding:"7px 14px",borderRadius:T.radiusSm,background:"#fff",border:`1px solid ${T.red}`,color:T.red,fontWeight:600,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Delete now</button>
                        </div>
                      </div>
                    );
                  })}
            </>
          ):section==="files"?<PropertyFilesPanel/>:<AutomationsPanel/>}
        </div>
      </div>
    </div>
  );
}

// ─── Chat attachments — photos, PDFs & voice notes (Supabase Storage) ─────────
// One-time setup: run supabase/storage.sql in Supabase → SQL Editor to create the
// public "attachments" bucket + policies. An attachment is stored on the message as
// { url, name, mime, kind } where kind is 'image' | 'audio' | 'file'.
const iconBtn={width:40,height:40,flexShrink:0,borderRadius:"50%",border:`1px solid ${T.border}`,background:T.bg,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,lineHeight:1};
const attachmentKind=(mime="")=>mime.startsWith("image/")?"image":mime.startsWith("audio/")?"audio":"file";
const sanitizeName=(name="file")=>(name.replace(/[^a-zA-Z0-9._-]/g,"_")||"file").slice(-80);
async function uploadAttachment(file,folder="chat"){
  const kind=attachmentKind(file.type||"");
  const base=file.name?sanitizeName(file.name):`${kind}.${kind==="audio"?"webm":kind==="image"?"jpg":"bin"}`;
  const path=`${folder}/${Date.now()}-${Math.random().toString(36).slice(2,8)}-${base}`;
  const { error }=await supabase.storage.from("attachments").upload(path,file,{contentType:file.type||undefined,upsert:false});
  if(error)throw error;
  const { data }=supabase.storage.from("attachments").getPublicUrl(path);
  return { url:data.publicUrl, name:file.name||base, mime:file.type||"", kind };
}
function MessageAttachment({att,mine}){
  if(!att||!att.url)return null;
  if(att.kind==="image")return(
    <a href={att.url} target="_blank" rel="noreferrer" style={{display:"block",marginTop:6}}>
      <img src={att.url} alt={att.name||"photo"} style={{maxWidth:220,maxHeight:260,width:"auto",borderRadius:10,display:"block",objectFit:"cover"}}/>
    </a>
  );
  if(att.kind==="audio")return <audio src={att.url} controls preload="metadata" style={{marginTop:6,maxWidth:240,width:240,height:40}}/>;
  const isPdf=(att.mime||"").includes("pdf")||/\.pdf$/i.test(att.name||"");
  return(
    <a href={att.url} target="_blank" rel="noreferrer" style={{display:"flex",alignItems:"center",gap:8,marginTop:6,padding:"8px 10px",borderRadius:10,border:`1px solid ${mine?"rgba(255,255,255,0.35)":T.border}`,background:mine?"rgba(255,255,255,0.15)":T.bg,textDecoration:"none",color:mine?"#fff":T.text,maxWidth:240}}>
      <span style={{fontSize:18,flexShrink:0}}>{isPdf?"📄":"📎"}</span>
      <span style={{fontSize:12,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{att.name||"Attachment"}</span>
    </a>
  );
}
// Shared chat input: text + 📎 attach (photo/PDF) + 🎤 voice note (MediaRecorder)
// + 👥 tag teammates. onSend(text, attachment|null, mentions[]) — mentions is the list
// of tagged names (empty = everyone). attachment is an uploaded {url,name,mime,kind}.
function ChatComposer({onSend,placeholder="Message…",people=[],currentUser}){
  const[text,setText]=useState("");
  const[busy,setBusy]=useState(false);
  const[recording,setRecording]=useState(false);
  const[recSecs,setRecSecs]=useState(0);
  const[err,setErr]=useState("");
  const[mentions,setMentions]=useState([]); // tagged names ([] = everyone)
  const[showTag,setShowTag]=useState(false);
  const[pendingAtt,setPendingAtt]=useState(null); // attachment staged, not yet sent
  const fileRef=useRef(null);
  const mrRef=useRef(null);
  const chunksRef=useRef([]);
  const cancelRef=useRef(false);
  const timerRef=useRef(null);
  const taRef=useRef(null);
  useEffect(()=>()=>clearInterval(timerRef.current),[]);
  // Grow the text box with its content (multi-line paste included), up to a cap.
  useEffect(()=>{const el=taRef.current;if(!el)return;el.style.height="auto";el.style.height=Math.min(el.scrollHeight,150)+"px";},[text]);
  const tagOptions=(people||[]).filter(n=>n&&n!==currentUser);
  const toggleMention=(n)=>setMentions(prev=>prev.includes(n)?prev.filter(x=>x!==n):[...prev,n]);
  const send=async()=>{
    const t=text.trim();
    if((!t&&!pendingAtt)||busy)return;
    const att=pendingAtt,mn=mentions;
    setText("");setPendingAtt(null);setMentions([]);setShowTag(false);setErr("");
    try{ await onSend(t,att||null,mn); }catch{ setErr("Send failed. Try again."); }
  };
  // Stage any file (from the picker, a paste, or a drop). Pasted images often have
  // no filename → give them one so they upload with a real extension.
  const uploadStaged=async(file)=>{
    if(!file)return;
    if(file.size>25*1024*1024){setErr("File is too large (max 25 MB).");return;}
    setErr("");setBusy(true);
    try{
      let up=file;
      if(!file.name||!/\.[a-z0-9]+$/i.test(file.name)){
        const ext=((file.type||"").split("/")[1]||"bin").replace("jpeg","jpg").replace("+xml","");
        up=new File([file],`pasted-${Date.now()}.${ext}`,{type:file.type||"application/octet-stream"});
      }
      setPendingAtt(await uploadAttachment(up,"chat"));
    }catch{ setErr("Upload failed. Try again."); }
    setBusy(false);
  };
  const onPickFile=async(e)=>{
    const file=e.target.files&&e.target.files[0];
    if(fileRef.current)fileRef.current.value="";
    await uploadStaged(file);
  };
  const onPasteFiles=(e)=>{
    const items=e.clipboardData?.items||[];
    let file=null;
    for(const it of items){if(it.kind==="file"){const f=it.getAsFile();if(f){file=f;break;}}}
    if(!file&&e.clipboardData?.files?.length)file=e.clipboardData.files[0];
    if(!file)return; // plain text/HTML paste — leave it to the input
    e.preventDefault();
    uploadStaged(file);
  };
  const onDropFiles=(e)=>{
    const file=e.dataTransfer?.files?.[0];
    if(!file)return;
    e.preventDefault();
    uploadStaged(file);
  };
  const startRec=async()=>{
    setErr("");
    if(!navigator.mediaDevices?.getUserMedia||typeof window.MediaRecorder==="undefined"){setErr("Voice notes aren't supported on this device.");return;}
    let stream;
    try{ stream=await navigator.mediaDevices.getUserMedia({audio:true}); }
    catch{ setErr("Microphone access is blocked. Allow it in Settings to record."); return; }
    const mr=new MediaRecorder(stream);
    chunksRef.current=[];cancelRef.current=false;
    mr.ondataavailable=(ev)=>{if(ev.data&&ev.data.size)chunksRef.current.push(ev.data);};
    mr.onstop=async()=>{
      stream.getTracks().forEach(tr=>tr.stop());
      clearInterval(timerRef.current);
      setRecording(false);setRecSecs(0);
      if(cancelRef.current)return;
      const blob=new Blob(chunksRef.current,{type:mr.mimeType||"audio/webm"});
      if(!blob.size)return;
      setBusy(true);
      try{
        const ext=/mp4|aac|m4a/.test(mr.mimeType||"")?"m4a":"webm";
        const file=new File([blob],`voice-note-${Date.now()}.${ext}`,{type:blob.type||"audio/webm"});
        setPendingAtt(await uploadAttachment(file,"voice"));
      }catch{ setErr("Couldn't save the voice note."); }
      setBusy(false);
    };
    mrRef.current=mr;
    mr.start();
    setRecording(true);setRecSecs(0);
    timerRef.current=setInterval(()=>setRecSecs(s=>s+1),1000);
  };
  const stopRec=()=>{cancelRef.current=false;if(mrRef.current&&mrRef.current.state!=="inactive")mrRef.current.stop();};
  const cancelRec=()=>{cancelRef.current=true;if(mrRef.current&&mrRef.current.state!=="inactive")mrRef.current.stop();};
  const fmtSecs=(s)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
  const canSend=(!!text.trim()||!!pendingAtt)&&!busy;
  return(
    <div onDrop={onDropFiles} onDragOver={e=>e.preventDefault()} style={{display:"flex",flexDirection:"column",gap:6}}>
      {err&&<div style={{fontSize:11,color:"#FF3B30",fontWeight:600,padding:"0 6px"}}>{err}</div>}
      {/* Who this message notifies (only while tagging) */}
      {!recording&&tagOptions.length>0&&(showTag||mentions.length>0)&&(
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",padding:"0 4px"}}>
          <span style={{fontSize:11,color:T.textTert,fontWeight:600}}>{mentions.length?"Notifying:":"Notifies everyone — tap a name:"}</span>
          {mentions.map(n=>(
            <span key={n} onClick={()=>toggleMention(n)} style={{fontSize:11,fontWeight:700,color:T.gold,background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:20,padding:"2px 8px",cursor:"pointer",display:"inline-flex",alignItems:"center",gap:4}}>@{n.split(" ")[0]} ×</span>
          ))}
          {showTag&&(
            <div style={{display:"flex",gap:6,flexWrap:"wrap",width:"100%",marginTop:2,background:T.bg,border:`1px solid ${T.border}`,borderRadius:12,padding:8}}>
              {tagOptions.map(n=>{const on=mentions.includes(n);return(
                <button key={n} onClick={()=>toggleMention(n)} style={{fontSize:12,fontWeight:on?700:500,color:on?"#fff":T.textSub,background:on?T.gold:"transparent",border:`1px solid ${on?T.gold:T.border}`,borderRadius:20,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit"}}>{on?"✓ ":""}{n}</button>
              );})}
            </div>
          )}
        </div>
      )}
      {/* Staged attachment — attach/record first, then tag + Send */}
      {pendingAtt&&!recording&&(
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 8px",background:T.bg,border:`1px solid ${T.border}`,borderRadius:12}}>
          {pendingAtt.kind==="image"
            ? <img src={pendingAtt.url} alt="" style={{width:44,height:44,borderRadius:8,objectFit:"cover",flexShrink:0}}/>
            : <span style={{fontSize:24,flexShrink:0}}>{pendingAtt.kind==="audio"?"🎤":"📄"}</span>}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:700,color:T.text}}>{pendingAtt.kind==="audio"?"Voice note ready":pendingAtt.kind==="image"?"Photo ready":"File ready"}</div>
            <div style={{fontSize:11,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{tagOptions.length?"Tag someone below, then Send":(pendingAtt.name||"Ready to send")}</div>
          </div>
          <button onClick={()=>setPendingAtt(null)} title="Remove" style={{background:"none",border:"none",color:T.textTert,fontSize:20,cursor:"pointer",lineHeight:1,flexShrink:0}}>×</button>
        </div>
      )}
      <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
        {recording?(
          <>
            <button onClick={cancelRec} title="Cancel recording" style={{...iconBtn,color:T.textTert}}>×</button>
            <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:8,color:"#FF3B30",fontSize:14,fontWeight:600}}>
              <span style={{width:9,height:9,borderRadius:"50%",background:"#FF3B30",display:"inline-block",flexShrink:0}}/>
              Recording… {fmtSecs(recSecs)}
            </div>
            <button onClick={stopRec} style={{padding:"10px 18px",borderRadius:22,background:T.gold,border:"none",color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Stop</button>
          </>
        ):(
          <>
            <input ref={fileRef} type="file" accept="image/*,application/pdf,.xls,.xlsx,.csv,.doc,.docx,.ppt,.pptx,.txt,.numbers,.pages,.key" onChange={onPickFile} style={{display:"none"}}/>
            <button onClick={()=>fileRef.current&&fileRef.current.click()} disabled={busy} title="Attach a photo, PDF, or spreadsheet" style={iconBtn}>📎</button>
            <button onClick={startRec} disabled={busy} title="Record a voice note" style={iconBtn}>🎤</button>
            {tagOptions.length>0&&<button onClick={()=>setShowTag(s=>!s)} disabled={busy} title="Tag teammates" style={{...iconBtn,...(mentions.length||showTag?{background:T.goldLight,borderColor:T.gold}:{})}}>👥</button>}
            <textarea ref={taRef} rows={1} value={text} onChange={e=>setText(e.target.value)} onPaste={onPasteFiles}
              onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();if(canSend)send();}}}
              placeholder={busy?"Uploading…":(pendingAtt?"Add a caption… (optional)":placeholder)} disabled={busy}
              style={{flex:1,minWidth:0,padding:"11px 14px",borderRadius:18,border:`1px solid ${T.border}`,background:T.bg,fontSize:15,outline:"none",fontFamily:"inherit",resize:"none",lineHeight:1.4,maxHeight:150,overflowY:"auto",boxSizing:"border-box"}}/>
            <button onClick={()=>send()} disabled={!canSend} style={{padding:"10px 18px",borderRadius:22,background:canSend?T.gold:T.border,border:"none",color:"#fff",fontWeight:700,fontSize:14,cursor:canSend?"pointer":"default",fontFamily:"inherit",flexShrink:0}}>Send</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Messaging Center — team chat organized per property ──────────────────────
// Merge a property's general messages with all of its task messages (tagged with
// the task they came from), sorted oldest→newest — so task chatter shows up in the
// property's history too.
const mergePropertyMessages=(p)=>{
  const gen=(p.messages||[]).map(m=>({...m,taskText:null,taskId:null}));
  const tsk=(p.tasks||[]).flatMap(t=>(t.messages||[]).map(m=>({...m,taskText:t.text||"Untitled task",taskId:t.id})));
  return [...gen,...tsk].sort((a,b)=>(new Date(a.at).getTime()||0)-(new Date(b.at).getTime()||0));
};
const msgTime=(iso)=>{const t=new Date(iso).getTime();return isNaN(t)?0:t;};
// Read/unread: a message is unread for a user when they didn't write it, aren't yet
// recorded in readBy, and it's addressed to them — either no one was tagged (goes to
// everyone) or they were one of the tagged people.
const isUnreadForUser=(m,user)=>{
  if(!user||m.author===user)return false;
  if((m.readBy||[]).includes(user))return false;
  const mentions=m.mentions||[];
  return mentions.length===0||mentions.includes(user);
};
const propUnreadCount=(p,user)=>mergePropertyMessages(p).reduce((n,m)=>n+(isUnreadForUser(m,user)?1:0),0);
const totalUnread=(props,user)=>(props||[]).filter(p=>!p.archived).reduce((n,p)=>n+propUnreadCount(p,user),0);
// A small count bubble used on nav items and the property list.
function UnreadBadge({count,style={}}){
  if(!count)return null;
  return <span style={{minWidth:18,height:18,padding:"0 5px",borderRadius:9,background:T.red,color:"#fff",fontSize:11,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",lineHeight:1,boxSizing:"border-box",...style}}>{count>99?"99+":count}</span>;
}
// Group a flat, time-sorted list into thread boxes.
//  • Every message on the same task lands in ONE box for that task (whether it was a
//    reply or posted straight onto the task).
//  • General (non-task) messages group by reply chain: a message plus everything that
//    chains back to it. A lone message is its own single-message box.
// Boxes are ordered by most-recent activity (last message), so a box jumps to the
// bottom when it gets a new message.
const buildMessageThreads=(messages)=>{
  const byId=new Map(messages.map(m=>[m.id,m]));
  const rootIdOf=(m)=>{let cur=m,g=0;while(cur.replyToId&&byId.has(cur.replyToId)&&g<200){cur=byId.get(cur.replyToId);g++;}return cur.id;};
  const keyOf=(m)=>m.taskId?`task:${m.taskId}`:`root:${rootIdOf(m)}`;
  const threads=new Map();
  messages.forEach(m=>{const k=keyOf(m);if(!threads.has(k))threads.set(k,{key:k,items:[]});threads.get(k).items.push(m);});
  const arr=[...threads.values()];
  arr.forEach(t=>{
    t.items.sort((a,b)=>msgTime(a.at)-msgTime(b.at));
    t.root=t.items[0];
    t.replies=t.items.slice(1);
    t.lastAt=msgTime(t.items[t.items.length-1].at);
  });
  arr.sort((a,b)=>a.lastAt-b.lastAt||msgTime(a.root.at)-msgTime(b.root.at));
  return arr;
};
function MessageThread({property,messages,currentUser,teamMembers,onSend,onDelete,onBack,isMobile}){
  const[reply,setReply]=useState(null); // message being replied to
  const[selMode,setSelMode]=useState(false); // select-to-delete mode
  const[selIds,setSelIds]=useState(new Set());
  const[target,setTarget]=useState(null); // {id,text} → post onto that task; null → general thread
  const[pickTask,setPickTask]=useState(false); // task-target dropdown open
  const propTasks=(property.tasks||[]).filter(t=>(t.text||"").trim());
  // When not replying, route a new message to the general thread or the chosen task.
  const handleSend=async(text,attachment,mentions)=>{await onSend(text,reply,attachment,mentions,reply?null:(target?target.id:null));setReply(null);};
  const threads=buildMessageThreads(messages);
  const allIds=messages.map(m=>m.id);
  const toggleSel=(id)=>setSelIds(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const exitSelect=()=>{setSelMode(false);setSelIds(new Set());};
  const doDelete=()=>{if(selIds.size&&onDelete)onDelete([...selIds]);exitSelect();};
  const fmt=(iso)=>{try{return new Date(iso).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});}catch{return "";}};
  const addr=`${property.address}${property.city?`, ${property.city}`:""}`;
  const sc=SC[property.status]||{};
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0,background:T.bg,overflow:"hidden"}}>
      <div style={{padding:"12px 16px",background:T.card,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        {isMobile&&<button onClick={onBack} style={{background:"none",border:"none",color:T.gold,fontWeight:600,fontSize:15,cursor:"pointer",fontFamily:"inherit",padding:"2px 4px",flexShrink:0}}>‹</button>}
        <div style={{minWidth:0,flex:1}}><div style={{fontSize:15,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{addr}</div>{property.status&&<span style={{fontSize:10,fontWeight:700,color:sc.color,background:sc.bg,padding:"2px 8px",borderRadius:20}}>{property.status}</span>}</div>
        {messages.length>0&&!selMode&&<button onClick={()=>setSelMode(true)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:20,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,padding:"5px 12px",flexShrink:0}}>Select</button>}
      </div>
      {selMode&&(
        <div style={{padding:"8px 14px",background:T.goldLight,borderBottom:`1px solid ${T.gold}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <span style={{fontSize:13,fontWeight:700,color:T.text}}>{selIds.size} selected</span>
          <button onClick={()=>setSelIds(selIds.size===allIds.length?new Set():new Set(allIds))} style={{background:"none",border:"none",color:T.gold,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,padding:"2px 4px"}}>{selIds.size===allIds.length?"Clear all":"Select all"}</button>
          <div style={{flex:1}}/>
          <button onClick={doDelete} disabled={!selIds.size} style={{padding:"6px 14px",borderRadius:20,border:"none",background:selIds.size?T.red:T.border,color:"#fff",fontSize:12,fontWeight:700,cursor:selIds.size?"pointer":"default",fontFamily:"inherit"}}>🗑 Delete</button>
          <button onClick={exitSelect} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:20,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,padding:"5px 12px"}}>Cancel</button>
        </div>
      )}
      <div style={{flex:1,overflowY:"auto",padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
        {messages.length===0&&<div style={{textAlign:"center",color:T.textTert,fontSize:13,padding:"30px 0"}}>No messages yet for this property. Start the conversation below.</div>}
        {threads.map(th=>{
          const{root,replies}=th;
          const rootMine=root.author===currentUser;
          const taskTag=(txt)=><span title="This message is on a task" style={{fontSize:9,fontWeight:700,color:"#b8912e",background:T.goldLight,border:`1px solid ${T.gold}`,borderRadius:20,padding:"2px 8px",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"inline-block"}}>↳ Task: {txt}</span>;
          const bubble=(m,{small,onCard}={})=>{
            const mine=m.author===currentUser;
            const theirBg=onCard?T.bg:T.card;
            const picked=selIds.has(m.id);
            return(
              <div key={m.id} onClick={selMode?()=>toggleSel(m.id):undefined} style={{alignSelf:mine?"flex-end":"flex-start",maxWidth:"92%",display:"flex",flexDirection:"column",alignItems:mine?"flex-end":"flex-start",cursor:selMode?"pointer":"default"}}>
                <div style={{fontSize:10,color:T.textTert,marginBottom:2}}>{m.author||"—"} · {fmt(m.at)}</div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexDirection:mine?"row-reverse":"row"}}>
                  {selMode&&<span style={{width:20,height:20,flexShrink:0,borderRadius:"50%",border:`2px solid ${picked?T.gold:T.border}`,background:picked?T.gold:"transparent",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800}}>{picked?"✓":""}</span>}
                  <div style={{background:mine?T.gold:theirBg,color:mine?"#fff":T.text,borderRadius:14,padding:small?"7px 11px":"9px 13px",fontSize:small?13:14,lineHeight:1.45,whiteSpace:"pre-wrap",wordBreak:"break-word",boxShadow:onCard?"none":T.shadow,border:mine?"none":`1px solid ${T.border}`,opacity:selMode&&!picked?0.55:1}}>
                    {m.mentions&&m.mentions.length>0&&<div style={{fontSize:10,fontWeight:800,marginBottom:4,color:mine?"rgba(255,255,255,0.9)":T.gold}}>{m.mentions.map(n=>"@"+n.split(" ")[0]).join(" ")}</div>}
                    {m.text}
                    {m.attachment&&<MessageAttachment att={m.attachment} mine={mine}/>}
                  </div>
                </div>
                {/* Reply to THIS specific message (notifies its author) */}
                {!selMode&&<button onClick={()=>setReply(m)} style={{background:"none",border:"none",color:reply&&reply.id===m.id?T.gold:T.textTert,cursor:"pointer",fontSize:11,fontFamily:"inherit",padding:"3px 2px 0",fontWeight:600}}>↩ Reply</button>}
              </div>
            );
          };
          // Standalone message — same clean look as before.
          if(replies.length===0){
            return(
              <div key={root.id} style={{display:"flex",flexDirection:"column",alignItems:rootMine?"flex-end":"flex-start"}}>
                {root.taskText&&<div style={{marginBottom:3}}>{taskTag(root.taskText)}</div>}
                {bubble(root)}
              </div>
            );
          }
          // Thread — root + nested replies grow inside one card (a sub-chat).
          return(
            <div key={root.id} style={{alignSelf:"stretch",border:`1px solid ${T.border}`,borderRadius:16,background:T.card,boxShadow:T.shadow,padding:"11px 12px 8px",display:"flex",flexDirection:"column",gap:9}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                {root.taskText?taskTag(root.taskText):<span style={{fontSize:9,fontWeight:700,color:T.textSub,background:T.bg,border:`1px solid ${T.border}`,borderRadius:20,padding:"2px 8px",textTransform:"uppercase",letterSpacing:"0.04em"}}>Thread</span>}
                <span style={{fontSize:10,color:T.textTert}}>{replies.length+1} messages</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {bubble(root,{onCard:true})}
                {replies.map(r=>bubble(r,{small:true,onCard:true}))}
              </div>
            </div>
          );
        })}
      </div>
      {!selMode&&reply&&(
        <div style={{padding:"8px 12px",background:T.goldLight,borderTop:`1px solid ${T.gold}`,display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
          <div style={{flex:1,minWidth:0,borderLeft:`3px solid ${T.gold}`,paddingLeft:8}}>
            <div style={{fontSize:11,fontWeight:700,color:"#b8912e"}}>Replying to {reply.author||"—"}{reply.taskText?` · ↳ ${reply.taskText}`:""}</div>
            <div style={{fontSize:12,color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{reply.text}</div>
          </div>
          <button onClick={()=>setReply(null)} style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:18,lineHeight:1,flexShrink:0}}>×</button>
        </div>
      )}
      {/* Where a new (non-reply) message goes: the property's general thread, or onto a specific task. */}
      {!selMode&&!reply&&propTasks.length>0&&(
        <div style={{padding:"8px 12px 0",flexShrink:0,position:"relative"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontSize:11,color:T.textTert,fontWeight:600}}>Posting to:</span>
            <button onClick={()=>setPickTask(v=>!v)} style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 11px",borderRadius:20,border:`1px solid ${target?T.gold:T.border}`,background:target?T.goldLight:T.bg,color:target?"#b8912e":T.textSub,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",maxWidth:"70%"}}>
              <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{target?`↳ ${target.text}`:"💬 General thread"}</span>
              <span style={{opacity:0.7,flexShrink:0}}>▾</span>
            </button>
            {target&&<button onClick={()=>setTarget(null)} title="Back to general thread" style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:12,fontWeight:600,fontFamily:"inherit",padding:"2px 4px"}}>× clear</button>}
          </div>
          {pickTask&&(<>
            <div onClick={()=>setPickTask(false)} style={{position:"fixed",inset:0,zIndex:190}}/>
            <div style={{position:"absolute",bottom:"calc(100% - 4px)",left:12,zIndex:200,background:"#fff",border:`1px solid ${T.border}`,borderRadius:12,boxShadow:"0 8px 28px rgba(0,0,0,0.18)",padding:4,maxHeight:280,overflowY:"auto",width:"min(320px,80vw)"}}>
              <button onClick={()=>{setTarget(null);setPickTask(false);}} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"9px 10px",borderRadius:8,border:"none",background:!target?T.goldLight:"transparent",color:!target?T.gold:T.text,fontSize:13,fontWeight:!target?700:500,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>💬 General thread</button>
              <div style={{padding:"6px 10px 3px",fontSize:10,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.05em"}}>Regarding a task</div>
              {propTasks.map(t=>{const on=target&&target.id===t.id;return(
                <button key={t.id} onClick={()=>{setTarget({id:t.id,text:t.text});setPickTask(false);}} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"9px 10px",borderRadius:8,border:"none",background:on?T.goldLight:"transparent",color:on?"#b8912e":T.text,fontSize:13,fontWeight:on?700:500,cursor:"pointer",fontFamily:"inherit",textAlign:"left"}}>
                  <span style={{flexShrink:0}}>↳</span><span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.text}</span>
                </button>
              );})}
            </div>
          </>)}
        </div>
      )}
      {!selMode&&<div style={{padding:"10px 12px max(10px,env(safe-area-inset-bottom))",borderTop:target&&!reply?`2px solid ${T.gold}`:`1px solid ${T.border}`,background:T.card,flexShrink:0}}>
        <ChatComposer onSend={handleSend} people={teamMembers} currentUser={currentUser} placeholder={reply?(reply.taskText?"Reply — posts on that task too…":"Reply…"):(target?`Message on “${target.text}”…`:"Message your team…")}/>
      </div>}
    </div>
  );
}
function MessagingCenter({sharedProps,setSharedProps,initialSelId,onNavConsumed}){
  const { currentUser:CURRENT_USER, teamMembers:TEAM_MEMBERS } = useData();
  const isMobile=useIsMobile();
  const[selId,setSelId]=useState(initialSelId||null);
  useEffect(()=>{if(initialSelId){setSelId(initialSelId);onNavConsumed&&onNavConsumed();}},[initialSelId]);// eslint-disable-line
  const[search,setSearch]=useState("");
  const active=sharedProps.filter(p=>!p.archived);
  const withMeta=active.map(p=>{const merged=mergePropertyMessages(p);const last=merged[merged.length-1];return {p,last,lastAt:last?new Date(last.at).getTime():0,count:merged.length,unread:merged.reduce((n,m)=>n+(isUnreadForUser(m,CURRENT_USER)?1:0),0)};});
  const q=search.toLowerCase();
  const list=withMeta.filter(x=>(x.p.address+" "+(x.p.city||"")).toLowerCase().includes(q))
    .sort((a,b)=>b.lastAt-a.lastAt||a.p.address.localeCompare(b.p.address));
  const sel=active.find(p=>p.id===selId);
  // Mark every message in the open property as read by me (clears its unread tag).
  const markRead=(propId)=>setSharedProps(prev=>prev.map(p=>{
    if(p.id!==propId)return p;
    let changed=false;
    const mark=(arr)=>(arr||[]).map(m=>{if(isUnreadForUser(m,CURRENT_USER)){changed=true;return {...m,readBy:[...(m.readBy||[]),CURRENT_USER]};}return m;});
    const messages=mark(p.messages);
    const tasks=(p.tasks||[]).map(t=>({...t,messages:mark(t.messages)}));
    return changed?{...p,messages,tasks}:p;
  }));
  const selUnread=sel?propUnreadCount(sel,CURRENT_USER):0;
  useEffect(()=>{if(sel&&selUnread>0)markRead(sel.id);},[selId,selUnread]);// eslint-disable-line
  // Delete selected messages (from the general thread and any task threads).
  const deleteMessages=(ids)=>{
    if(!sel||!ids||!ids.length)return;
    const idset=new Set(ids);
    setSharedProps(prev=>prev.map(p=>{
      if(p.id!==sel.id)return p;
      const messages=(p.messages||[]).filter(m=>!idset.has(m.id));
      const tasks=(p.tasks||[]).map(t=>({...t,messages:(t.messages||[]).filter(m=>!idset.has(m.id))}));
      return {...p,messages,tasks};
    }));
  };
  const send=(text,replyTarget,attachment,mentions,targetTaskId)=>{
    const t=(text||"").trim();if((!t&&!attachment)||!sel)return;
    const msg={id:Date.now(),author:CURRENT_USER,text:t,at:new Date().toISOString(),readBy:[CURRENT_USER]};
    if(attachment)msg.attachment=attachment;
    // Replying to someone auto-notifies just that person (plus anyone you tagged),
    // instead of pinging the whole team like an untagged message.
    const tagged=new Set(mentions||[]);
    if(replyTarget&&replyTarget.author&&replyTarget.author!==CURRENT_USER)tagged.add(replyTarget.author);
    if(tagged.size)msg.mentions=[...tagged];
    if(replyTarget){msg.replyToId=replyTarget.id;msg.replyTo={author:replyTarget.author||"",text:(replyTarget.text||"").slice(0,140),taskText:replyTarget.taskText||null};}
    // Route to a task thread when replying to a task message, or when the composer
    // was aimed at a specific task; otherwise post to the property's general thread.
    const postTaskId=(replyTarget&&replyTarget.taskId)||targetTaskId||null;
    if(postTaskId){
      setSharedProps(prev=>prev.map(p=>p.id!==sel.id?p:{...p,tasks:(p.tasks||[]).map(tk=>tk.id!==postTaskId?tk:{...tk,messages:[...(tk.messages||[]),msg]})}));
    }else{
      setSharedProps(prev=>prev.map(p=>p.id!==sel.id?p:{...p,messages:[...(p.messages||[]),msg]}));
    }
  };
  const fmtShort=(iso)=>{if(!iso)return "";try{const d=new Date(iso),now=new Date();const sameDay=d.toDateString()===now.toDateString();return sameDay?d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"}):d.toLocaleDateString(undefined,{month:"short",day:"numeric"});}catch{return "";}};
  const iS={width:"100%",padding:"9px 12px",borderRadius:T.radiusSm,background:T.bg,border:`1px solid ${T.border}`,color:T.text,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  return(
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      <div style={{width:isMobile?"100%":320,flexShrink:0,display:isMobile&&sel?"none":"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${T.border}`,background:T.card,overflow:"hidden"}}>
        <div style={{padding:"14px 14px 10px",borderBottom:`1px solid ${T.border}`}}>
          <div style={{fontWeight:700,fontSize:15,color:T.text,marginBottom:10}}>Messages</div>
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:T.textTert,fontSize:15,pointerEvents:"none"}}>⌕</span>
            <input placeholder="Search properties…" value={search} onChange={e=>setSearch(e.target.value)} style={{...iS,paddingLeft:28,fontSize:13,padding:"7px 10px 7px 28px"}}/>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {list.length===0&&<div style={{padding:24,textAlign:"center",color:T.textTert,fontSize:13}}>No properties.</div>}
          {list.map(({p,last,unread})=>{
            const isActive=p.id===selId;
            const addr=`${p.address}${p.city?`, ${p.city}`:""}`;
            const hasUnread=unread>0&&!isActive;
            return(
              <div key={p.id} onClick={()=>setSelId(p.id)} style={{padding:"11px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,background:isActive?T.goldLight:"transparent",borderLeft:isActive?`3px solid ${T.gold}`:"3px solid transparent"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
                  <span style={{fontWeight:hasUnread||isActive?700:600,fontSize:13,color:isActive?T.gold:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>{addr}</span>
                  {last&&<span style={{fontSize:10,color:hasUnread?T.red:T.textTert,fontWeight:hasUnread?700:400,flexShrink:0}}>{fmtShort(last.at)}</span>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginTop:2}}>
                  <div style={{flex:1,minWidth:0,fontSize:12,color:hasUnread?T.text:T.textSub,fontWeight:hasUnread?600:400,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {last?<>{last.taskText?<span title={`On task: ${last.taskText}`} style={{color:"#b8912e"}}>↳ </span>:null}{last.author?`${last.author.split(" ")[0]}: `:""}{last.text||(last.attachment?(last.attachment.kind==="image"?"📷 Photo":last.attachment.kind==="audio"?"🎤 Voice note":"📎 Attachment"):"")}</>:<span style={{color:T.textTert}}>No messages yet</span>}
                  </div>
                  {hasUnread&&<UnreadBadge count={unread}/>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{flex:1,display:isMobile&&!sel?"none":"flex",flexDirection:"column",overflow:"hidden"}}>
        {sel
          ? <MessageThread property={sel} messages={mergePropertyMessages(sel)} currentUser={CURRENT_USER} teamMembers={TEAM_MEMBERS} onSend={send} onDelete={deleteMessages} onBack={()=>setSelId(null)} isMobile={isMobile}/>
          : <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bg,gap:12,color:T.textSub}}>
              <div style={{width:64,height:64,borderRadius:18,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>💬</div>
              <div style={{fontSize:16,fontWeight:600}}>Select a property</div>
              <div style={{fontSize:13,color:T.textTert}}>Choose a property to see and send messages</div>
            </div>}
      </div>
    </div>
  );
}

// ─── Profile modal — set your display name (used everywhere you're assigned) ──
function ProfileModal({current,onSave,onClose}){
  const[name,setName]=useState(current||"");
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState("");
  const save=async()=>{
    if(!name.trim())return;
    setBusy(true);setErr("");
    const e=await onSave(name.trim());
    setBusy(false);
    if(e)setErr(e.message||"Couldn't save your name.");else onClose();
  };
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16,boxSizing:"border-box",backdropFilter:"blur(4px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"min(400px,96vw)",boxShadow:"0 12px 48px rgba(0,0,0,0.25)",overflow:"hidden"}}>
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:17,fontWeight:700,color:T.text}}>Your name</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{padding:20}}>
          <div style={{fontSize:12,color:T.textSub,marginBottom:12}}>This is the name teammates see and how tasks are assigned to you. Use your real name (not your email).</div>
          <input autoFocus value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()} placeholder="e.g. Elie"
            style={{width:"100%",padding:"11px 13px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}/>
          {err&&<div style={{marginTop:10,color:T.red,fontSize:13}}>{err}</div>}
          <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}>
            <button onClick={onClose} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Cancel</button>
            <button onClick={save} disabled={busy||!name.trim()} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:busy?"default":"pointer",fontFamily:"inherit",fontSize:14,opacity:busy||!name.trim()?0.6:1}}>{busy?"Saving…":"Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Profile / team menu — opens from the EH avatar ───────────────────────────
function ProfileMenu({displayName,role,isAdmin,teamMembers,onEditName,onAddTeammate,onSignOut,onClose}){
  const initials=initialsOf(displayName)||"?";
  const others=(teamMembers||[]).filter(Boolean);
  const rowBtn={display:"flex",alignItems:"center",gap:12,width:"100%",padding:"13px 20px",border:"none",background:"none",cursor:"pointer",fontFamily:"inherit",fontSize:14,color:T.text,textAlign:"left"};
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:410,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(4px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderTopLeftRadius:20,borderTopRightRadius:20,width:"100%",maxWidth:480,maxHeight:"82vh",overflowY:"auto",boxShadow:"0 -8px 40px rgba(0,0,0,0.2)",paddingBottom:"max(12px,env(safe-area-inset-bottom))"}}>
        <div style={{padding:"18px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:14}}>
          <div style={{width:46,height:46,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,color:"#fff",flexShrink:0}}>{initials}</div>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:16,fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{displayName}</div>
            <div style={{fontSize:12,color:T.textSub,textTransform:"capitalize"}}>{role}</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <button onClick={onEditName} style={rowBtn}><span style={{fontSize:16,width:22,textAlign:"center"}}>✎</span> Edit your name</button>
        {isAdmin&&<button onClick={onAddTeammate} style={{...rowBtn,color:T.gold,fontWeight:700,borderTop:`1px solid ${T.border}`}}><span style={{fontSize:18,width:22,textAlign:"center"}}>＋</span> Add a teammate</button>}
        <div style={{padding:"12px 20px 6px",fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.05em",borderTop:`1px solid ${T.border}`}}>Team ({others.length})</div>
        <div style={{padding:"0 20px 8px",display:"flex",flexDirection:"column",gap:2}}>
          {others.map(m=>(
            <div key={m} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0"}}>
              <AssigneeAvatar name={m} size={28}/>
              <div style={{fontSize:13.5,color:T.text}}>{m}{m===displayName?" (you)":""}</div>
            </div>
          ))}
        </div>
        <button onClick={onSignOut} style={{...rowBtn,color:T.red,borderTop:`1px solid ${T.border}`}}><span style={{fontSize:16,width:22,textAlign:"center"}}>⎋</span> Sign out</button>
      </div>
    </div>
  );
}
// ─── Add teammate — admin creates a login right from the app ───────────────────
function AddTeammateModal({onClose,onCreated}){
  const[name,setName]=useState("");
  const[email,setEmail]=useState("");
  const[password,setPassword]=useState("");
  const[busy,setBusy]=useState(false);
  const[err,setErr]=useState("");
  const[done,setDone]=useState(null); // created member {email,password} to show
  const gen=()=>{const chars="abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";let s="";for(let i=0;i<10;i++)s+=chars[Math.floor(Math.random()*chars.length)];setPassword(s);};
  const submit=async()=>{
    setErr("");
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())){setErr("Enter a valid email address.");return;}
    if(password.trim().length<8){setErr("Password must be at least 8 characters.");return;}
    setBusy(true);
    try{
      const r=await qbAuthFetch("/api/team/create",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name.trim(),email:email.trim(),password:password.trim()})});
      setDone({email:email.trim(),password:password.trim(),name:r.member?.name||name.trim()});
      onCreated&&onCreated();
    }catch(e){setErr(e.message||"Couldn't add the teammate.");}
    setBusy(false);
  };
  const inp={width:"100%",padding:"11px 13px",borderRadius:T.radiusSm,border:`1px solid ${T.border}`,fontSize:15,outline:"none",boxSizing:"border-box",fontFamily:"inherit"};
  const lbl={fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:6,display:"block"};
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:420,display:"flex",alignItems:"center",justifyContent:"center",padding:16,boxSizing:"border-box",backdropFilter:"blur(4px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,width:"min(420px,96vw)",boxShadow:"0 12px 48px rgba(0,0,0,0.25)",overflow:"hidden",maxHeight:"90vh",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:17,fontWeight:700,color:T.text}}>{done?"Teammate added":"Add a teammate"}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{padding:20,overflowY:"auto"}}>
          {done?(
            <div>
              <div style={{fontSize:13,color:T.textSub,marginBottom:14,lineHeight:1.5}}><strong style={{color:T.text}}>{done.name}</strong> can now sign in. Share these credentials with them — they can change their name in the app afterward.</div>
              <div style={{background:T.bg,borderRadius:12,padding:"12px 14px",fontSize:13,lineHeight:1.9}}>
                <div><span style={{color:T.textSub}}>Email:</span> <strong style={{color:T.text}}>{done.email}</strong></div>
                <div><span style={{color:T.textSub}}>Password:</span> <strong style={{color:T.text,fontFamily:"monospace"}}>{done.password}</strong></div>
              </div>
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}>
                <button onClick={()=>{setDone(null);setName("");setEmail("");setPassword("");}} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Add another</button>
                <button onClick={onClose} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Done</button>
              </div>
            </div>
          ):(
            <>
              <div style={{marginBottom:14}}><label style={lbl}>Name</label><input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Moshe Hamaoui" style={inp}/></div>
              <div style={{marginBottom:14}}><label style={lbl}>Email</label><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="teammate@email.com" autoCapitalize="none" autoCorrect="off" inputMode="email" style={inp}/></div>
              <div style={{marginBottom:6}}><label style={lbl}>Temporary password</label>
                <div style={{display:"flex",gap:8}}>
                  <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="at least 8 characters" style={{...inp,flex:1}}/>
                  <button onClick={gen} style={{padding:"0 14px",borderRadius:T.radiusSm,background:T.goldLight,border:`1px solid ${T.gold}`,color:T.gold,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit",flexShrink:0}}>Generate</button>
                </div>
              </div>
              <div style={{fontSize:12,color:T.textTert,marginTop:8,lineHeight:1.5}}>They'll sign in with this email + password, then can rename themselves. New teammates join as members.</div>
              {err&&<div style={{marginTop:12,color:T.red,fontSize:13}}>{err}</div>}
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}>
                <button onClick={onClose} style={{padding:"10px 18px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Cancel</button>
                <button onClick={submit} disabled={busy} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:busy?"default":"pointer",fontFamily:"inherit",fontSize:14,opacity:busy?0.6:1}}>{busy?"Adding…":"Add teammate"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
// ─── Mobile nav menu — all sections + pin/unpin which show on the bottom bar ──
function NavMenu({items,active,isPinned,onNavigate,onTogglePin,onClose}){
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:400,display:"flex",alignItems:"flex-end",justifyContent:"center",backdropFilter:"blur(4px)"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderTopLeftRadius:20,borderTopRightRadius:20,width:"100%",maxWidth:520,maxHeight:"82vh",overflowY:"auto",boxShadow:"0 -8px 40px rgba(0,0,0,0.2)",paddingBottom:"max(12px,env(safe-area-inset-bottom))"}}>
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:"#fff"}}>
          <div>
            <div style={{fontSize:16,fontWeight:700,color:T.text}}>Menu</div>
            <div style={{fontSize:12,color:T.textSub,marginTop:1}}>Tap to open · pin the ones you want on the bottom bar</div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:22,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{padding:8}}>
          {items.map(({key,label,icon})=>{
            const pinned=isPinned(key);const activeItem=active===key;
            return(
              <div key={key} style={{display:"flex",alignItems:"center",gap:12,padding:"12px",borderRadius:T.radiusSm,background:activeItem?T.goldLight:"transparent"}}>
                <button onClick={()=>onNavigate(key)} style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:12,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",textAlign:"left",padding:0}}>
                  <span style={{color:activeItem?T.gold:T.textTert}}>{icon}</span>
                  <span style={{fontSize:15,fontWeight:activeItem?700:500,color:activeItem?T.gold:T.text}}>{label}</span>
                </button>
                <button onClick={()=>onTogglePin(key)} title={pinned?"Unpin from bottom bar":"Pin to bottom bar"}
                  style={{background:pinned?T.goldLight:"transparent",border:`1px solid ${pinned?T.gold:T.border}`,borderRadius:20,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:600,color:pinned?T.gold:T.textSub,flexShrink:0}}>{pinned?"📌 Pinned":"Pin"}</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Financial Section (admin-only) ───────────────────────────────────────────
// Private lender ("funder") ledgers + the draws (money lent against a property).
// Interest is simple 15%/yr, day-counted — matching the Excel the data came from.
const LOC_RATE=0.15;
const daysBetween=(a,b)=>{const s=new Date(a),e=new Date(b);if(isNaN(s)||isNaN(e))return 0;return Math.max(0,Math.round((e-s)/86400000));};
const drawDays=(d)=>daysBetween(d.dateFunded,d.paybackDate||new Date());
const drawInterest=(d)=>(Number(d.amount)||0)*(LOC_RATE/365)*drawDays(d);
const sameName=(a,b)=>!!a&&!!b&&String(a).trim().toLowerCase()===String(b).trim().toLowerCase();
// Which private-lender draws belong to a property: explicit link, else a strong
// address match on the draw's label (reuses the QuickBooks address matcher).
const drawsForProperty=(property,draws)=>{
  if(!property)return [];
  const addr=`${property.address||""} ${property.city||""}`.trim();
  return (draws||[]).filter(d=>{
    if(d.propertyId!=null&&String(d.propertyId)===String(property.id))return true;
    const label=d.propertyLabel||"";
    return qbMatchScore(addr,label)>=0.7||qbMatchScore(property.address||"",label)>=0.7;
  });
};
const funderDraws=(f,draws)=>(draws||[]).filter(d=>String(d.funderId)===String(f.id)||sameName(d.funderName,f.name));
const ledgerSum=(f,type)=>((f.ledger||[]).filter(e=>e.type===type).reduce((s,e)=>s+(Number(e.amount)||0),0));
const funderStats=(f,draws)=>{
  // Capital he's owed = wires in + reinvested interest − principal he withdrew (± adjustments).
  // Reinvested interest GROWS his balance; interest paid out (distribution) does not.
  const principal=ledgerSum(f,"principal"), adjustment=ledgerSum(f,"adjustment");
  const mine=funderDraws(f,draws);
  const open=mine.filter(d=>!d.paybackDate);
  const paid=mine.filter(d=>d.paybackDate);
  const paidReinvest=paid.filter(d=>d.interestHandling==="reinvest").reduce((s,d)=>s+drawInterest(d),0);
  const paidDistrib=paid.filter(d=>d.interestHandling==="distribute").reduce((s,d)=>s+drawInterest(d),0);
  const paidWithdrawnPrincipal=paid.filter(d=>d.principalHandling==="withdraw").reduce((s,d)=>s+(Number(d.amount)||0),0);
  const reinvest=ledgerSum(f,"reinvest")+paidReinvest;             // manual reinvest entries + reinvested payback interest
  const distribution=ledgerSum(f,"distribution")+paidDistrib;      // manual + interest paid out at payback
  const withdrawal=ledgerSum(f,"withdrawal")+paidWithdrawnPrincipal; // manual + principal he took back at payback
  const capital=principal+reinvest-withdrawal+adjustment;
  const deployed=open.reduce((s,d)=>s+(Number(d.amount)||0),0);
  const interest=open.reduce((s,d)=>s+drawInterest(d),0);           // accruing on open loans
  const interestRealized=paid.reduce((s,d)=>s+drawInterest(d),0);   // earned on closed loans
  const interestEarned=interest+interestRealized;                   // total interest accrued
  const interestAdjust=ledgerSum(f,"interest_adjust");              // manual ± correction to interest owed
  // What's still owed to him in interest = earned − what's been reinvested or paid out (± manual).
  // Paying out interest (a distribution) lowers this; overpaying takes it negative.
  const interestOwed=interestEarned-reinvest-distribution+interestAdjust;
  return {principal,reinvest,distribution,withdrawal,adjustment,interestAdjust,capital,deployed,interest,interestRealized,interestEarned,interestOwed,available:capital-deployed,mine,open,paid};
};
const LEDGER_TYPES=[
  {v:"principal",label:"Wire in (principal)",sign:1,color:"#16A34A"},
  {v:"reinvest",label:"Reinvested interest",sign:1,color:T.blue},
  {v:"distribution",label:"Interest paid out",sign:-1,color:T.red},
  {v:"withdrawal",label:"Principal withdrawn",sign:-1,color:T.red},
  {v:"adjustment",label:"Capital adjustment (±)",sign:1,color:T.textSub},
  {v:"interest_adjust",label:"Interest adjustment (±)",sign:1,color:T.gold},
];
// Types whose amount can be entered negative to reduce a balance.
const SIGNED_LEDGER=new Set(["adjustment","interest_adjust"]);
// One chronological register per lender: ledger entries + each draw's funded/payback
// events (and the interest's reinvest/paid-out decision), time-sorted, with a running
// available balance (what's un-deployed). Same-date order: fund → wires/ledger →
// payback (+principal) → its derived lines (principal-out / interest), so the balance
// rises on the payback first, then the red lines pull it back — never dips negative.
const regRank=(e)=>e.kind==="fund"?0:e.kind==="payback"?2:e.derived?3:1;
const funderRegister=(f,draws)=>{
  const ev=[];
  (f.ledger||[]).forEach(e=>ev.push({id:"L"+e.id,kind:e.type,date:e.date||"",amount:Number(e.amount)||0,note:e.note||"",ledgerId:e.id}));
  funderDraws(f,draws).forEach(d=>{
    ev.push({id:"F"+d.id,kind:"fund",date:d.dateFunded||"",amount:Number(d.amount)||0,note:d.propertyLabel||"",draw:d});
    if(d.paybackDate){
      const int=drawInterest(d);
      ev.push({id:"P"+d.id,kind:"payback",date:d.paybackDate,amount:Number(d.amount)||0,interest:int,note:d.propertyLabel||"",draw:d});
      if(d.principalHandling==="withdraw")ev.push({id:"W"+d.id,kind:"withdrawal",date:d.paybackDate,amount:Number(d.amount)||0,note:`Principal paid back to him — ${d.propertyLabel||""}`.trim(),draw:d,derived:true,field:"principal"});
      if(d.interestHandling==="reinvest")ev.push({id:"R"+d.id,kind:"reinvest",date:d.paybackDate,amount:int,note:`Interest reinvested — ${d.propertyLabel||""}`.trim(),draw:d,derived:true,field:"interest"});
      else if(d.interestHandling==="distribute")ev.push({id:"D"+d.id,kind:"distribution",date:d.paybackDate,amount:int,note:`Interest paid out — ${d.propertyLabel||""}`.trim(),draw:d,derived:true,field:"interest"});
    }
  });
  ev.sort((a,b)=>String(a.date).localeCompare(String(b.date))||(regRank(a)-regRank(b)));
  let bal=0;
  ev.forEach(e=>{
    if(e.kind==="principal"||e.kind==="reinvest"||e.kind==="payback")bal+=e.amount;
    else if(e.kind==="adjustment")bal+=e.amount;                 // signed capital correction
    else if(e.kind==="withdrawal"||e.kind==="fund")bal-=e.amount;
    e.balance=bal; // "distribution" / "interest_adjust" don't move available capital
  });
  return ev;
};
const finFmtDate=(iso)=>{if(!iso)return "";try{return new Date(iso).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});}catch{return iso;}};
const finInput={width:"100%",boxSizing:"border-box",padding:"10px 12px",borderRadius:10,border:`1px solid ${T.border}`,fontSize:14,fontFamily:"inherit",background:T.bg,color:T.text,outline:"none"};

// Small centered modal shell reused by the Financial Section forms.
function FinModal({title,onClose,children,footer}){
  return(
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:400,backdropFilter:"blur(6px)",padding:16,boxSizing:"border-box"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:18,width:"min(440px,96vw)",maxHeight:"88vh",display:"flex",flexDirection:"column",boxShadow:"0 12px 48px rgba(0,0,0,0.25)",overflow:"hidden"}}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:T.goldLight}}>
          <div style={{fontSize:14,fontWeight:700,color:T.gold}}>{title}</div>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div style={{padding:16,overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>{children}</div>
        {footer&&<div style={{padding:"12px 16px",borderTop:`1px solid ${T.border}`,display:"flex",gap:10,justifyContent:"flex-end"}}>{footer}</div>}
      </div>
    </div>
  );
}
const finBtn=(primary)=>({padding:"9px 18px",borderRadius:10,border:primary?"none":`1px solid ${T.border}`,background:primary?T.gold:T.bg,color:primary?"#fff":T.textSub,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"});
const finLabel={fontSize:11,fontWeight:700,color:T.textTert,textTransform:"uppercase",letterSpacing:"0.04em",marginBottom:4};

function FinFunderModal({funder,onSave,onClose}){
  const editing=!!funder;
  const[name,setName]=useState(funder?.name||"");
  const[notes,setNotes]=useState(funder?.notes||"");
  const[principal,setPrincipal]=useState("");
  const save=()=>{
    const nm=name.trim();if(!nm)return;
    if(editing){onSave({...funder,name:nm,notes:notes.trim()});}
    else{
      const ledger=[];const p=Number(numIn(principal));
      if(p)ledger.push({id:Date.now(),type:"principal",amount:p,date:new Date().toISOString().slice(0,10),note:"Initial principal"});
      onSave({id:Date.now(),name:nm,notes:notes.trim(),ledger});
    }
    onClose();
  };
  return(
    <FinModal title={editing?"Edit lender":"New lender"} onClose={onClose}
      footer={<><button onClick={onClose} style={finBtn(false)}>Cancel</button><button onClick={save} disabled={!name.trim()} style={{...finBtn(true),opacity:name.trim()?1:0.5}}>Save</button></>}>
      <div><div style={finLabel}>Name</div><input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Cohen" style={finInput}/></div>
      {!editing&&<div><div style={finLabel}>Initial principal (optional)</div><input value={principal} onChange={e=>setPrincipal(numIn(e.target.value))} inputMode="decimal" placeholder="e.g. 740000" style={finInput}/><div style={{fontSize:11,color:T.textTert,marginTop:4}}>Adds a first "Principal in" ledger entry. You can add more later.</div></div>}
      <div><div style={finLabel}>Notes</div><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Terms, contact info, anything…" style={{...finInput,minHeight:60,resize:"vertical"}}/></div>
    </FinModal>
  );
}

function FinLedgerModal({funderName,onSave,onClose}){
  const[type,setType]=useState("principal");
  const[amount,setAmount]=useState("");
  const[date,setDate]=useState(new Date().toISOString().slice(0,10));
  const[note,setNote]=useState("");
  const save=()=>{const a=Number(numIn(amount));if(!a)return;onSave({id:Date.now(),type,amount:a,date,note:note.trim()});onClose();};
  return(
    <FinModal title={`Ledger entry — ${funderName}`} onClose={onClose}
      footer={<><button onClick={onClose} style={finBtn(false)}>Cancel</button><button onClick={save} disabled={!Number(numIn(amount))} style={{...finBtn(true),opacity:Number(numIn(amount))?1:0.5}}>Add</button></>}>
      <div><div style={finLabel}>Type</div>
        <select value={type} onChange={e=>setType(e.target.value)} style={finInput}>{LEDGER_TYPES.map(t=><option key={t.v} value={t.v}>{t.label}</option>)}</select>
        {type==="adjustment"&&<div style={{fontSize:11,color:T.textTert,marginTop:4}}>Corrects his capital / available balance. Use a minus (e.g. −5000) to reduce.</div>}
        {type==="interest_adjust"&&<div style={{fontSize:11,color:T.textTert,marginTop:4}}>Corrects interest owed only (not principal). Use a minus to reduce interest owed.</div>}
      </div>
      <div><div style={finLabel}>Amount</div><input autoFocus value={amount} onChange={e=>setAmount(numIn(e.target.value))} inputMode="decimal" placeholder={SIGNED_LEDGER.has(type)?"e.g. -5000":"0"} style={finInput}/></div>
      <div><div style={finLabel}>Date</div><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={finInput}/></div>
      <div><div style={finLabel}>Note</div><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional" style={finInput}/></div>
    </FinModal>
  );
}

function FinDrawModal({draw,funders,properties,defaultFunderId,onSave,onClose}){
  const editing=!!draw;
  const[prop,setProp]=useState(draw?.propertyLabel||"");
  const[funderId,setFunderId]=useState(draw?.funderId||defaultFunderId||(funders[0]?.id||""));
  const[amount,setAmount]=useState(draw?String(draw.amount||""):"");
  const[dateFunded,setDateFunded]=useState(draw?.dateFunded||new Date().toISOString().slice(0,10));
  const[paybackDate,setPaybackDate]=useState(draw?.paybackDate||"");
  const[note,setNote]=useState(draw?.note||"");
  const propOptions=[...new Set((properties||[]).map(p=>`${p.address}${p.city?`, ${p.city}`:""}`).filter(Boolean))].sort();
  const save=()=>{
    const a=Number(numIn(amount));if(!a||!funderId)return;
    const f=funders.find(x=>String(x.id)===String(funderId));
    const match=(properties||[]).find(p=>`${p.address}${p.city?`, ${p.city}`:""}`===prop.trim()||p.address===prop.trim());
    onSave({
      id:draw?.id||Date.now(),
      propertyId:match?match.id:(draw?.propertyId||null),
      propertyLabel:prop.trim(),
      funderId, funderName:f?.name||"",
      amount:a, dateFunded, paybackDate:paybackDate||null, note:note.trim(),
    });
    onClose();
  };
  return(
    <FinModal title={editing?"Edit draw":"New draw (money lent)"} onClose={onClose}
      footer={<><button onClick={onClose} style={finBtn(false)}>Cancel</button><button onClick={save} disabled={!Number(numIn(amount))||!funderId} style={{...finBtn(true),opacity:(Number(numIn(amount))&&funderId)?1:0.5}}>Save</button></>}>
      <div><div style={finLabel}>Property</div>
        <input list="fin-props" value={prop} onChange={e=>setProp(e.target.value)} placeholder="Type or pick a property…" style={finInput}/>
        <datalist id="fin-props">{propOptions.map(p=><option key={p} value={p}/>)}</datalist>
      </div>
      <div><div style={finLabel}>Lender</div>
        <select value={funderId} onChange={e=>setFunderId(e.target.value)} style={finInput}>
          {funders.length===0&&<option value="">— add a lender first —</option>}
          {funders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <div><div style={finLabel}>Amount</div><input value={amount} onChange={e=>setAmount(numIn(e.target.value))} inputMode="decimal" placeholder="0" style={finInput}/></div>
      <div style={{display:"flex",gap:10}}>
        <div style={{flex:1}}><div style={finLabel}>Date funded</div><input type="date" value={dateFunded} onChange={e=>setDateFunded(e.target.value)} style={finInput}/></div>
        <div style={{flex:1}}><div style={finLabel}>Payback date</div><input type="date" value={paybackDate} onChange={e=>setPaybackDate(e.target.value)} style={finInput}/></div>
      </div>
      <div style={{fontSize:11,color:T.textTert,marginTop:-4}}>Leave payback empty while the loan is open — interest accrues to today.</div>
      {(()=>{
        const a=Number(numIn(amount));const prev={amount:a,dateFunded,paybackDate:paybackDate||null};
        const days=drawDays(prev);const int=drawInterest(prev);
        if(!a||!dateFunded)return null;
        const bad=(!!paybackDate&&new Date(paybackDate)<new Date(dateFunded));
        return(
          <div style={{background:bad?"#FFF0EF":T.goldLight,border:`1px solid ${bad?T.red:T.gold}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontSize:13,color:bad?T.red:"#8a6d1f"}}><b>{days} day{days===1?"":"s"}</b> {paybackDate?"(funded → payback)":"(accruing to today)"} · interest <b>{fmtD(int)}</b> @ 15%/yr</div>
            <div style={{fontSize:12,color:bad?T.red:"#8a6d1f",marginTop:2}}>Payoff (principal + interest): <b>{fmtD(a+int)}</b></div>
            {bad&&<div style={{fontSize:11,color:T.red,marginTop:3,fontWeight:600}}>Payback date is before the funded date — check the years.</div>}
          </div>
        );
      })()}
      <div><div style={finLabel}>Note</div><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Optional (e.g. rehab draw, refi proceeds)" style={finInput}/></div>
    </FinModal>
  );
}

// Turn a CSV register (one row per transaction) into capital-ledger entries.
const finNum=(v)=>{const x=parseFloat(String(v==null?"":v).replace(/[^0-9.\-]/g,""));return isNaN(x)?0:x;};
const finNormDate=(s)=>{if(s==null)return "";const t=String(s).trim();if(!t)return "";const d=new Date(t);return isNaN(d)?t:d.toISOString().slice(0,10);};
const guessCol=(headers,re)=>headers.findIndex(h=>re.test(String(h).toLowerCase()));
const buildRegisterEntries=(csv,map)=>{
  const at=(row,i)=>(i>=0&&i<row.length?row[i]:"");
  const out=[];
  (csv.rows||[]).forEach((row,idx)=>{
    const inA=map.in>=0?finNum(at(row,map.in)):0;
    const outA=map.out>=0?finNum(at(row,map.out)):0;
    const tword=`${map.type>=0?at(row,map.type):""} ${map.note>=0?at(row,map.note):""}`.toLowerCase();
    let type,amt;
    if(outA>0){type="distribution";amt=outA;}
    else if(inA<0){type="distribution";amt=Math.abs(inA);}
    else{
      amt=inA;
      if(/re-?invest|roll/.test(tword))type="reinvest";
      else if(/payback|paid|withdraw|distribut|payout|return/.test(tword))type="distribution";
      else type="principal";
    }
    if(!amt)return;
    out.push({id:Date.now()+idx,type,amount:amt,date:finNormDate(map.date>=0?at(row,map.date):""),note:(map.note>=0?String(at(row,map.note)).trim():"")});
  });
  return out;
};

function FinRegisterImport({funder,onImport,onClose}){
  const[csv,setCsv]=useState(null);
  const[map,setMap]=useState({date:-1,in:-1,out:-1,type:-1,note:-1});
  const[err,setErr]=useState("");
  const fileRef=useRef(null);
  const onFile=async(e)=>{
    const f=e.target.files&&e.target.files[0];if(fileRef.current)fileRef.current.value="";if(!f)return;
    setErr("");
    if(/\.(xlsx|xls)$/i.test(f.name)){setErr("Please save that Excel tab as CSV first (File → Save As → CSV), then upload the .csv.");return;}
    try{
      const parsed=parseCSV(await f.text());
      if(!parsed.headers.length){setErr("Couldn't read that file. Make sure it's a CSV with a header row.");return;}
      const H=parsed.headers;
      setMap({
        date:guessCol(H,/date/),
        in:guessCol(H,/deposit|money ?in|amount ?in|contribut|princip|invest|credit|received|\bin\b/),
        out:guessCol(H,/withdraw|money ?out|amount ?out|payback|paid|distribut|payout|debit|\bout\b/),
        type:guessCol(H,/type|category|transaction/),
        note:guessCol(H,/note|memo|descr|detail/),
      });
      setCsv(parsed);
    }catch{setErr("Couldn't read that file.");}
  };
  const entries=csv?buildRegisterEntries(csv,map):[];
  const opts=(csv?csv.headers:[]).map((h,i)=>({v:i,l:h||`Column ${i+1}`}));
  const sel=(field,label)=>(
    <div><div style={finLabel}>{label}</div>
      <select value={map[field]} onChange={e=>setMap(m=>({...m,[field]:Number(e.target.value)}))} style={finInput}>
        <option value={-1}>— skip —</option>{opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
  const doImport=()=>{if(!entries.length){setErr("Nothing to import — check your column mapping.");return;}onImport(entries);onClose();};
  return(
    <FinModal title={`Import register — ${funder.name}`} onClose={onClose}
      footer={csv?<><button onClick={onClose} style={finBtn(false)}>Cancel</button><button onClick={doImport} disabled={!entries.length} style={{...finBtn(true),opacity:entries.length?1:0.5}}>Import {entries.length} {entries.length===1?"entry":"entries"}</button></>:<button onClick={onClose} style={finBtn(false)}>Cancel</button>}>
      {err&&<div style={{fontSize:12,color:T.red,fontWeight:600}}>{err}</div>}
      {!csv?(
        <>
          <div style={{fontSize:13,color:T.textSub,lineHeight:1.5}}>Upload a CSV of {funder.name}'s register — one row per transaction. Include a <b>date</b>, an <b>amount in</b> (deposits / reinvested profit) and/or <b>amount out</b> (paybacks), and a <b>type</b> or <b>note</b> so I can tell reinvestments from paybacks.</div>
          <div style={{fontSize:12,color:T.textTert}}>In Excel: <b>File → Save As → CSV</b>, then upload it here.</div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} style={{display:"none"}}/>
          <button onClick={()=>fileRef.current&&fileRef.current.click()} style={{...finBtn(true),padding:"12px"}}>Choose CSV file…</button>
        </>
      ):(
        <>
          <div style={{fontSize:12,color:T.textSub}}>Map your columns:</div>
          {sel("date","Date")}
          {sel("in","Amount in (deposits / reinvested)")}
          {sel("out","Amount out (paybacks)")}
          {sel("type","Type (optional)")}
          {sel("note","Note (optional)")}
          <div style={{fontSize:11,color:T.textTert}}>An amount-out (or a negative amount) becomes a payback; a note/type with "reinvest" becomes reinvested profit; everything else is principal in.</div>
          <div style={{fontSize:11,fontWeight:700,color:T.textSub,marginTop:4}}>Preview ({entries.length} entries)</div>
          <div style={{border:`1px solid ${T.border}`,borderRadius:8,maxHeight:170,overflowY:"auto"}}>
            {entries.slice(0,15).map((e,i)=>{const t=LEDGER_TYPES.find(x=>x.v===e.type)||LEDGER_TYPES[0];return(
              <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"6px 10px",borderTop:i?`1px solid ${T.border}`:"none",fontSize:12}}>
                <span style={{color:T.textSub,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.date||"—"} · {t.label}{e.note?` · ${e.note}`:""}</span>
                <span style={{fontWeight:700,color:t.color,flexShrink:0}}>{t.sign<0?"−":"+"}{fmtD(e.amount)}</span>
              </div>
            );})}
            {entries.length===0&&<div style={{padding:"10px",fontSize:12,color:T.textTert,textAlign:"center"}}>No entries parsed — adjust the mapping above.</div>}
          </div>
        </>
      )}
    </FinModal>
  );
}

// Record a payback on a draw: freeze interest at the payback date and choose whether
// the interest was reinvested (added to his balance) or paid out to him.
function FinPaybackModal({draw,onConfirm,onClose}){
  const[date,setDate]=useState(draw.paybackDate||new Date().toISOString().slice(0,10));
  const[principal,setPrincipal]=useState(draw.principalHandling||"keep");
  const[interest,setInterest]=useState(draw.interestHandling||"reinvest");
  const prev={amount:Number(draw.amount)||0,dateFunded:draw.dateFunded,paybackDate:date};
  const days=drawDays(prev), int=drawInterest(prev);
  const bad=new Date(date)<new Date(draw.dateFunded||date);
  const radio=(cur,set,opts,name)=>opts.map(([v,l])=>(
    <label key={v} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 4px",cursor:"pointer"}}>
      <input type="radio" name={name} checked={cur===v} onChange={()=>set(v)} style={{accentColor:T.gold}}/>
      <span style={{fontSize:13,color:T.text}}>{l}</span>
    </label>
  ));
  return(
    <FinModal title={`Record payback — ${draw.propertyLabel||"draw"}`} onClose={onClose}
      footer={<><button onClick={onClose} style={finBtn(false)}>Cancel</button><button onClick={()=>{onConfirm({paybackDate:date,principalHandling:principal,interestHandling:interest});onClose();}} style={finBtn(true)}>Record payback</button></>}>
      <div><div style={finLabel}>Payback date</div><input type="date" value={date} onChange={e=>setDate(e.target.value)} style={finInput}/></div>
      <div style={{background:bad?"#FFF0EF":T.goldLight,border:`1px solid ${bad?T.red:T.gold}`,borderRadius:10,padding:"10px 12px",fontSize:13,color:bad?T.red:"#8a6d1f"}}>
        Principal <b>{fmtD(prev.amount)}</b> · <b>{days} day{days===1?"":"s"}</b> · interest <b>{fmtD(int)}</b> @ 15%/yr
        {bad&&<div style={{fontSize:11,fontWeight:600,marginTop:3}}>Payback date is before the funded date.</div>}
      </div>
      {/* Quick presets for the common combinations */}
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {[["Both back to him",()=>{setPrincipal("withdraw");setInterest("distribute");}],["Interest paid, principal stays",()=>{setPrincipal("keep");setInterest("distribute");}],["All reinvested",()=>{setPrincipal("keep");setInterest("reinvest");}]].map(([l,fn])=>(
          <button key={l} onClick={fn} style={{padding:"5px 10px",borderRadius:20,border:`1px solid ${T.border}`,background:T.bg,color:T.textSub,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>{l}</button>
        ))}
      </div>
      <div><div style={finLabel}>The principal ({fmtD(prev.amount)})…</div>
        {radio(principal,setPrincipal,[["keep","Stays in his balance (available to redeploy)"],["withdraw","Paid back to him — a withdrawal"]],"pp")}
      </div>
      <div><div style={finLabel}>The interest ({fmtD(int)})…</div>
        {radio(interest,setInterest,[["reinvest","Reinvested — added to his balance"],["distribute","Paid out to him (his profit)"],["leave","No interest entry"]],"pi")}
      </div>
    </FinModal>
  );
}

function FinancialSectionPage(){
  const { funders, setFunders, flushFunders, draws, setDraws, flushDraws, sharedProps } = useData();
  const isMobile=useIsMobile();
  const[selId,setSelId]=useState(null);
  const[funderModal,setFunderModal]=useState(null);   // {} new, or funder obj to edit
  const[ledgerModal,setLedgerModal]=useState(false);
  const[registerImport,setRegisterImport]=useState(false);
  const[paybackModal,setPaybackModal]=useState(null);  // draw being paid back
  const[drawModal,setDrawModal]=useState(null);        // {} new, or draw obj, or {defaultFunderId}
  const save=()=>{setTimeout(()=>{flushFunders&&flushFunders();flushDraws&&flushDraws();},0);};

  const list=[...(funders||[])].sort((a,b)=>(a.name||"").localeCompare(b.name||""));
  const sel=list.find(f=>String(f.id)===String(selId))||null;

  // Portfolio totals across all lenders.
  const totals=list.reduce((acc,f)=>{const s=funderStats(f,draws);acc.capital+=s.capital;acc.deployed+=s.deployed;acc.interest+=s.interestOwed;acc.available+=s.available;return acc;},{capital:0,deployed:0,interest:0,available:0});

  const addFunder=(f)=>{setFunders(prev=>[...prev,f]);save();setSelId(f.id);};
  const updateFunder=(f)=>{setFunders(prev=>prev.map(x=>String(x.id)===String(f.id)?f:x));save();};
  const deleteFunder=(id)=>{if(!window.confirm("Delete this lender and its ledger? (Their draws stay, tagged by name.)"))return;setFunders(prev=>prev.filter(x=>String(x.id)!==String(id)));save();setSelId(null);};
  const addLedger=(funderId,entry)=>{setFunders(prev=>prev.map(x=>String(x.id)===String(funderId)?{...x,ledger:[...(x.ledger||[]),entry]}:x));save();};
  const addLedgerBulk=(funderId,entries)=>{if(!entries.length)return;setFunders(prev=>prev.map(x=>String(x.id)===String(funderId)?{...x,ledger:[...(x.ledger||[]),...entries]}:x));save();};
  const delLedger=(funderId,entryId)=>{setFunders(prev=>prev.map(x=>String(x.id)===String(funderId)?{...x,ledger:(x.ledger||[]).filter(e=>e.id!==entryId)}:x));save();};
  const saveDraw=(d)=>{setDraws(prev=>prev.some(x=>x.id===d.id)?prev.map(x=>x.id===d.id?d:x):[...prev,d]);save();};
  const delDraw=(id)=>{setDraws(prev=>prev.filter(x=>x.id!==id));save();};
  const markPaid=(d)=>{saveDraw({...d,paybackDate:new Date().toISOString().slice(0,10)});};
  // Store the payback date + interest decision on the draw itself, so it can be
  // set or changed anytime (including on already-paid draws).
  const recordPayback=(draw,{paybackDate,principalHandling,interestHandling})=>{saveDraw({...draw,paybackDate,principalHandling,interestHandling});};
  const delEvent=(e)=>{
    if(e.derived&&e.draw){saveDraw({...e.draw,...(e.field==="principal"?{principalHandling:"keep"}:{interestHandling:"leave"})});return;}
    if(e.ledgerId!=null&&sel)delLedger(sel.id,e.ledgerId);
    else if(e.kind==="fund"&&e.draw){if(window.confirm("Delete this funding (draw)?"))delDraw(e.draw.id);}
    else if(e.kind==="payback"&&e.draw){if(window.confirm("Reopen this loan (remove the payback)?"))saveDraw({...e.draw,paybackDate:null,principalHandling:null,interestHandling:null});}
  };

  const downloadBackup=()=>{
    const payload={exportedAt:new Date().toISOString(),funders,draws};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download=`goldstone-financials-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };

  // Per-lender printable statement → the browser's "Save as PDF".
  const generateReport=(f)=>{
    const s=funderStats(f,draws);
    const mine=funderDraws(f,draws);
    const open=[...mine.filter(d=>!d.paybackDate)].sort((a,b)=>String(a.dateFunded||"").localeCompare(String(b.dateFunded||"")));
    const paid=[...mine.filter(d=>d.paybackDate)].sort((a,b)=>String(a.paybackDate||"").localeCompare(String(b.paybackDate||"")));
    const sum=(arr,fn)=>arr.reduce((x,d)=>x+fn(d),0);
    const openAmt=sum(open,d=>Number(d.amount)||0), openInt=sum(open,drawInterest);
    const paidAmt=sum(paid,d=>Number(d.amount)||0), paidInt=sum(paid,drawInterest);
    const esc=(x)=>String(x==null?"":x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const today=new Date().toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"});
    const stat=(l,v,c)=>`<div class="stat"><div class="sl">${l}</div><div class="sv" style="color:${c||"#1C1C1E"}">${fmtD(v)}</div></div>`;
    const rowOpen=(d)=>`<tr><td>${esc(d.propertyLabel||"—")}</td><td>${esc(finFmtDate(d.dateFunded))}</td><td>${drawDays(d)}d</td><td class="r">${fmtD(d.amount)}</td><td class="r gold">${fmtD(drawInterest(d))}</td></tr>`;
    const rowPaid=(d)=>`<tr><td>${esc(d.propertyLabel||"—")}</td><td>${esc(finFmtDate(d.dateFunded))}</td><td>${esc(finFmtDate(d.paybackDate))}</td><td class="r">${fmtD(d.amount)}</td><td class="r gold">${fmtD(drawInterest(d))}</td></tr>`;
    const openRows=open.length?open.map(rowOpen).join(""):`<tr><td colspan="5" class="empty">None outstanding.</td></tr>`;
    const paidRows=paid.length?paid.map(rowPaid).join(""):`<tr><td colspan="5" class="empty">None yet.</td></tr>`;
    const html=`<!doctype html><html><head><meta charset="utf-8"><title>${esc(f.name)} — Lender Statement</title><style>
      *{box-sizing:border-box;}body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1C1C1E;margin:0;padding:36px;}
      .brand{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#B8953F;}
      .sub{font-size:20px;font-weight:800;margin-top:2px;}.date{font-size:12px;color:#8A8A8E;margin-top:3px;}
      .hdr{border-bottom:2px solid #B8953F;padding-bottom:12px;margin-bottom:20px;}
      .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px;}
      .stat{border:1px solid #ececec;border-radius:8px;padding:9px 12px;}
      .sl{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#8A8A8E;font-weight:700;}
      .sv{font-size:17px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums;}
      h2{font-size:13px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#555;}
      table{width:100%;border-collapse:collapse;font-size:12px;}
      th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#8A8A8E;border-bottom:1px solid #ddd;padding:6px 8px;}
      td{padding:7px 8px;border-bottom:1px solid #f2f2f2;}
      .r{text-align:right;font-variant-numeric:tabular-nums;}.gold{color:#B8953F;font-weight:700;}
      tfoot td{font-weight:800;border-top:2px solid #B8953F;border-bottom:none;}
      .empty{color:#aaa;text-align:center;padding:16px;}
      .foot{margin-top:28px;font-size:10px;color:#aaa;border-top:1px solid #eee;padding-top:10px;}
      @media print{body{padding:0;}}
    </style></head><body>
      <div class="hdr"><div class="brand">Goldstone Properties</div><div class="sub">Lender Statement — ${esc(f.name)}</div><div class="date">Generated ${esc(today)}</div></div>
      <div class="stats">${stat("Capital (owed)",s.capital)}${stat("Available",s.available,s.available<0?"#FF3B30":"#16A34A")}${stat("Deployed",s.deployed,"#007AFF")}${stat("Interest earned",s.interestEarned,"#16A34A")}${stat("Paid out to him",s.distribution,"#FF3B30")}${stat("Interest owed",s.interestOwed,s.interestOwed<0?"#FF3B30":"#B8953F")}</div>
      <h2>Outstanding properties — standing interest</h2>
      <table><thead><tr><th>Property</th><th>Funded</th><th>Days</th><th class="r">Amount</th><th class="r">Interest</th></tr></thead><tbody>${openRows}</tbody><tfoot><tr><td>Total</td><td></td><td></td><td class="r">${fmtD(openAmt)}</td><td class="r gold">${fmtD(openInt)}</td></tr></tfoot></table>
      <h2>Sold / paid-back properties — interest paid</h2>
      <table><thead><tr><th>Property</th><th>Funded</th><th>Paid back</th><th class="r">Amount</th><th class="r">Interest</th></tr></thead><tbody>${paidRows}</tbody><tfoot><tr><td>Total</td><td></td><td></td><td class="r">${fmtD(paidAmt)}</td><td class="r gold">${fmtD(paidInt)}</td></tr></tfoot></table>
      <div class="foot">Interest accrues at 15% / yr, day-counted. Private &amp; confidential.</div>
    </body></html>`;
    const w=window.open("","_blank");
    if(!w){alert("Please allow pop-ups for this site to generate the report.");return;}
    w.document.write(html);w.document.close();w.focus();
    setTimeout(()=>{try{w.print();}catch(e){/* user can print manually */}},450);
  };

  const stat=(label,val,color)=>(
    <div style={{background:T.bg,borderRadius:10,padding:"10px 12px",minWidth:0}}>
      <div style={{fontSize:10,color:T.textSub,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>{label}</div>
      <div style={{fontSize:isMobile?15:17,fontWeight:800,color:color||T.text,marginTop:2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontVariantNumeric:"tabular-nums"}}>{fmtD(val)}</div>
    </div>
  );

  const funderRow=(f)=>{
    const s=funderStats(f,draws);const active=String(f.id)===String(selId);
    return(
      <div key={f.id} onClick={()=>setSelId(f.id)} style={{padding:"12px 14px",cursor:"pointer",borderBottom:`1px solid ${T.border}`,background:active?T.goldLight:"transparent",borderLeft:active?`3px solid ${T.gold}`:"3px solid transparent"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
          <span style={{fontWeight:700,fontSize:14,color:active?T.gold:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</span>
          <span style={{fontSize:12,fontWeight:700,color:s.available<0?T.red:T.green,flexShrink:0}}>{fmtD(s.available)}</span>
        </div>
        <div style={{fontSize:11,color:T.textSub,marginTop:2}}>{fmtD(s.deployed)} out · {s.open.length} open · {fmtD(s.interestOwed)} int owed</div>
      </div>
    );
  };

  const kindMeta=(e)=>{
    if(e.kind==="fund")return {label:`Funded — ${e.note||"deal"}`,color:T.orange,sign:-1};
    if(e.kind==="payback")return {label:`Payback — ${e.note||"deal"}`,color:"#16A34A",sign:1,extra:e.interest?`+ ${fmtD(e.interest)} interest earned`:""};
    const t=LEDGER_TYPES.find(x=>x.v===e.kind)||{label:e.kind,color:T.textSub,sign:1};
    return {label:t.label+(e.note?` — ${e.note}`:""),color:t.color,sign:t.sign};
  };
  const detail=(f)=>{
    const s=funderStats(f,draws);
    const reg=funderRegister(f,draws);
    return(
      <div style={{flex:1,minWidth:0,overflowY:"auto",padding:isMobile?"14px 14px 40px":"20px 24px 40px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
          {isMobile&&<button onClick={()=>setSelId(null)} style={{background:"none",border:"none",color:T.gold,fontWeight:600,fontSize:16,cursor:"pointer",padding:"2px 4px"}}>‹</button>}
          <div style={{fontSize:20,fontWeight:800,color:T.text,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
          <button onClick={()=>generateReport(f)} title="Generate a PDF statement for this lender" style={{...finBtn(false),padding:"6px 12px"}}>⭳ PDF</button>
          <button onClick={()=>setFunderModal(f)} style={{...finBtn(false),padding:"6px 12px"}}>Edit</button>
          <button onClick={()=>deleteFunder(f.id)} title="Delete lender" style={{background:"none",border:`1px solid ${T.border}`,color:T.textTert,borderRadius:8,padding:"6px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:13}}>🗑</button>
        </div>
        {f.notes&&<div style={{fontSize:13,color:T.textSub,marginBottom:14,whiteSpace:"pre-wrap"}}>{f.notes}</div>}
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(3,1fr)",gap:8,marginBottom:16}}>
          {stat("Available balance",s.available,s.available<0?T.red:T.green)}
          {stat("Deployed",s.deployed,T.blue)}
          {stat("Capital (owed)",s.capital)}
          {stat("Interest earned",s.interestEarned,"#16A34A")}
          {stat("Paid out to him",s.distribution,T.red)}
          {stat("Interest owed",s.interestOwed,s.interestOwed<0?T.red:T.gold)}
        </div>
        {/* How interest owed is derived — negative means he's been overpaid. */}
        <div style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:10,padding:"9px 12px",marginBottom:16,fontSize:12,color:T.textSub,display:"flex",flexWrap:"wrap",alignItems:"center",gap:6}}>
          <span style={{fontWeight:700,color:T.textTert,textTransform:"uppercase",fontSize:10,letterSpacing:"0.04em"}}>Interest owed</span>
          <span>= earned <b style={{color:"#16A34A"}}>{fmtD(s.interestEarned)}</b></span>
          {s.reinvest!==0&&<span>− reinvested <b style={{color:T.blue}}>{fmtD(s.reinvest)}</b></span>}
          <span>− paid out <b style={{color:T.red}}>{fmtD(s.distribution)}</b></span>
          {s.interestAdjust!==0&&<span>{s.interestAdjust<0?"−":"+"} adj <b>{fmtD(Math.abs(s.interestAdjust))}</b></span>}
          <span>= <b style={{color:s.interestOwed<0?T.red:T.gold}}>{fmtD(s.interestOwed)}</b>{s.interestOwed<0&&<span style={{color:T.red,fontWeight:600}}> (overpaid)</span>}</span>
        </div>

        {/* Toolbar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6,gap:8,flexWrap:"wrap"}}>
          <div style={{fontSize:14,fontWeight:800,color:T.text}}>Register</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setRegisterImport(true)} title="Import a CSV register" style={{...finBtn(false),padding:"6px 10px",fontSize:12}}>⇪ Import</button>
            <button onClick={()=>setLedgerModal(true)} style={{...finBtn(false),padding:"6px 10px",fontSize:12}}>+ Wire / entry</button>
            <button onClick={()=>setDrawModal({defaultFunderId:f.id})} style={{...finBtn(true),padding:"6px 12px",fontSize:12}}>+ Funding</button>
          </div>
        </div>
        <div style={{fontSize:11,color:T.textTert,marginBottom:8}}>Chronological — wires in, fundings out, paybacks (with interest). Running balance = his un-deployed cash.</div>
        <div style={{background:T.card,borderRadius:12,boxShadow:T.shadow,overflow:"hidden"}}>
          {reg.length===0&&<div style={{padding:"18px",textAlign:"center",color:T.textTert,fontSize:13}}>Nothing yet. Start with <b>+ Wire / entry</b> for money he sent you, then <b>+ Funding</b> when you deploy it into a deal.</div>}
          {reg.map(e=>{const m=kindMeta(e);const isOpenFund=e.kind==="fund"&&e.draw&&!e.draw.paybackDate;return(
            <div key={e.id} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 12px",borderTop:`1px solid ${T.border}`}}>
              <div style={{width:52,fontSize:10.5,color:T.textTert,flexShrink:0,lineHeight:1.25}}>{finFmtDate(e.date)||"—"}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.label}</div>
                {m.extra&&<div style={{fontSize:11,color:"#16A34A"}}>{m.extra}</div>}
              </div>
              {/* actions sit BEFORE the amount so the amount column stays aligned across every row */}
              <div style={{display:"flex",flexDirection:"column",gap:3,flexShrink:0,alignItems:"flex-end"}}>
                {isOpenFund&&<button onClick={()=>setPaybackModal(e.draw)} style={{background:"none",border:`1px solid ${T.green}`,borderRadius:7,color:T.green,cursor:"pointer",fontSize:10.5,fontWeight:700,padding:"2px 7px",fontFamily:"inherit"}}>Payback</button>}
                {e.kind==="payback"&&e.draw&&(()=>{const p=e.draw.principalHandling,i=e.draw.interestHandling;const set=p||i;
                  const label=set?`${p==="withdraw"?"P out":"P kept"} · ${i==="reinvest"?"int reinv":i==="distribute"?"int paid":"int —"}`:"set ▾";
                  const col=set?T.textSub:T.gold;return(
                  <button onClick={()=>setPaybackModal(e.draw)} title="How were principal & interest handled?" style={{background:set?"none":T.goldLight,border:`1px solid ${set?T.border:T.gold}`,borderRadius:7,color:col,cursor:"pointer",fontSize:10,fontWeight:700,padding:"2px 7px",fontFamily:"inherit",whiteSpace:"nowrap"}}>{label}</button>
                );})()}
                {e.kind==="fund"&&e.draw&&<button onClick={()=>setDrawModal(e.draw)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:7,color:T.textSub,cursor:"pointer",fontSize:10.5,padding:"2px 7px",fontFamily:"inherit"}}>Edit</button>}
              </div>
              <div style={{width:isMobile?92:110,flexShrink:0,textAlign:"right",fontVariantNumeric:"tabular-nums"}}>
                <div style={{fontSize:13,fontWeight:700,color:m.color,whiteSpace:"nowrap"}}>{((m.sign<0)!==(e.amount<0))?"−":"+"}{fmtD(Math.abs(e.amount))}</div>
                <div style={{fontSize:9.5,color:T.textTert,whiteSpace:"nowrap"}}>bal {fmtD(e.balance)}</div>
              </div>
              <button onClick={()=>delEvent(e)} title="Remove" style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:16,lineHeight:1,flexShrink:0}}>×</button>
            </div>
          );})}
        </div>
      </div>
    );
  };

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg}}>
      {funderModal&&<FinFunderModal funder={funderModal.id?funderModal:null} onSave={(f)=>funderModal.id?updateFunder(f):addFunder(f)} onClose={()=>setFunderModal(null)}/>}
      {ledgerModal&&sel&&<FinLedgerModal funderName={sel.name} onSave={(e)=>addLedger(sel.id,e)} onClose={()=>setLedgerModal(false)}/>}
      {registerImport&&sel&&<FinRegisterImport funder={sel} onImport={(entries)=>addLedgerBulk(sel.id,entries)} onClose={()=>setRegisterImport(false)}/>}
      {paybackModal&&<FinPaybackModal draw={paybackModal} onConfirm={(r)=>recordPayback(paybackModal,r)} onClose={()=>setPaybackModal(null)}/>}
      {drawModal&&<FinDrawModal draw={drawModal.id?drawModal:null} defaultFunderId={drawModal.defaultFunderId} funders={list} properties={sharedProps} onSave={saveDraw} onClose={()=>setDrawModal(null)}/>}

      {/* Header */}
      <div style={{background:T.card,borderBottom:`1px solid ${T.border}`,padding:isMobile?"12px 14px":"16px 24px",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <div style={{fontSize:isMobile?19:22,fontWeight:800,color:T.text}}>Financial Section</div>
          <span style={{fontSize:9,fontWeight:800,background:T.gold,color:"#fff",borderRadius:20,padding:"3px 8px",textTransform:"uppercase",letterSpacing:"0.05em"}}>Private</span>
          <div style={{marginLeft:"auto",display:"flex",gap:8}}>
            <button onClick={downloadBackup} title="Download a backup file of all financial data" style={{...finBtn(false),padding:"8px 12px"}}>⬇ Backup</button>
            <button onClick={()=>setFunderModal({})} style={{...finBtn(false),padding:"8px 12px"}}>+ Lender</button>
            <button onClick={()=>setDrawModal({})} style={{...finBtn(true),padding:"8px 14px"}}>+ Draw</button>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",gap:8,marginTop:12}}>
          {stat("Total capital",totals.capital)}
          {stat("Deployed",totals.deployed,T.blue)}
          {stat("Available",totals.available,totals.available<0?T.red:T.green)}
          {stat("Interest owed",totals.interest,T.gold)}
        </div>
      </div>

      {/* Master-detail */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        <div style={{width:isMobile?"100%":320,flexShrink:0,display:isMobile&&sel?"none":"flex",flexDirection:"column",borderRight:isMobile?"none":`1px solid ${T.border}`,background:T.card,overflow:"hidden"}}>
          <div style={{padding:"10px 14px",borderBottom:`1px solid ${T.border}`,fontSize:12,fontWeight:700,color:T.textSub}}>Lenders ({list.length})</div>
          <div style={{flex:1,overflowY:"auto"}}>
            {list.length===0&&<div style={{padding:24,textAlign:"center",color:T.textTert,fontSize:13}}>No lenders yet. Tap <b>+ Lender</b> to add your first private funder.</div>}
            {list.map(funderRow)}
          </div>
        </div>
        <div style={{flex:1,display:isMobile&&!sel?"none":"flex",flexDirection:"column",overflow:"hidden"}}>
          {sel?detail(sel)
            :<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:T.textSub,padding:24,textAlign:"center"}}>
              <div style={{width:60,height:60,borderRadius:16,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",color:T.gold}}>{ICONS.financials}</div>
              <div style={{fontSize:16,fontWeight:700}}>Pick a lender</div>
              <div style={{fontSize:13,color:T.textTert,maxWidth:340}}>See their capital ledger — principal, reinvested profit, payouts — and every property their money is in, with interest accruing at 15%.</div>
            </div>}
        </div>
      </div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
// Members only see Tasks + Properties; admins see the full nav.
// Which nav tabs non-admin members can open. Admin-only sections (see
// ADMIN_ONLY_KEYS) are excluded so members never get them.
const MEMBER_KEYS = new Set(NAV.map(n=>n.key).filter(k=>!ADMIN_ONLY_KEYS.has(k)));

export function GoldstoneShell(){
  const { sharedProps, setSharedProps, automations, loading, saveError, clearSaveError, teamMembers } = useData();
  const { displayName, role, isAdmin, signOut, updateName, prefs, savePrefs } = useAuth();
  const isMobile = useIsMobile();

  const navItems = isAdmin ? NAV : NAV.filter(n=>MEMBER_KEYS.has(n.key));
  const unreadTotal = totalUnread(sharedProps, displayName);
  const[active,setActive]=useState(isAdmin?"properties":"tasks");
  const[navPropId,setNavPropId]=useState(null);
  const[showSettings,setShowSettings]=useState(false);
  const[showProfile,setShowProfile]=useState(false);
  const[showProfileMenu,setShowProfileMenu]=useState(false);
  const[showAddTeammate,setShowAddTeammate]=useState(false);
  const[showNavMenu,setShowNavMenu]=useState(false);
  useEffect(()=>{ if(!navItems.find(n=>n.key===active)) setActive(navItems[0]?.key||"tasks"); },[navItems,active]);

  // Which sections show on the mobile bottom bar (customizable via the ☰ menu).
  // Stored per-user on the account (prefs.pinnedTabs) so it persists across logins
  // and each team member keeps their own choice. null = not customized → show all.
  const pinnedKeys=Array.isArray(prefs.pinnedTabs)?prefs.pinnedTabs:null;
  const isPinned=(key)=>!pinnedKeys||pinnedKeys.includes(key);
  const bottomItems=(()=>{ if(!pinnedKeys) return navItems; const chosen=navItems.filter(n=>pinnedKeys.includes(n.key)); return chosen.length?chosen:navItems; })();
  const togglePin=(key)=>{
    const set=new Set(pinnedKeys||navItems.map(n=>n.key));
    set.has(key)?set.delete(key):set.add(key);
    savePrefs({pinnedTabs:navItems.map(n=>n.key).filter(k=>set.has(k))}); // preserve nav order
  };

  // Archive / restore / permanent-delete helpers.
  const archiveProperty=useCallback((id)=>setSharedProps(prev=>prev.map(p=>p.id===id?{...p,archived:true,archivedAt:new Date().toISOString()}:p)),[setSharedProps]);
  const restoreProperty=useCallback((id)=>setSharedProps(prev=>prev.map(p=>p.id===id?{...p,archived:false,archivedAt:null}:p)),[setSharedProps]);
  const deleteProperty=useCallback((id)=>setSharedProps(prev=>prev.filter(p=>p.id!==id)),[setSharedProps]);
  const archivedProps=sharedProps.filter(p=>p.archived);

  // Auto-purge: permanently drop archived properties past the 60-day window.
  useEffect(()=>{
    const cutoff=Date.now()-ARCHIVE_DAYS*24*60*60*1000;
    const expired=sharedProps.filter(p=>p.archived&&p.archivedAt&&new Date(p.archivedAt).getTime()<cutoff);
    if(expired.length){const ids=new Set(expired.map(p=>p.id));setSharedProps(prev=>prev.filter(p=>!ids.has(p.id)));}
  },[sharedProps,setSharedProps]);

  // One-time cleanup: remove leftover auto-checklist tasks a previous app version saved
  // onto properties. Only untouched, exact-match checklist items are removed — real tasks,
  // anything assigned/delegated, messaged, contact-linked, or automation-made are kept.
  // Idempotent: once cleaned, no rows match so it stops.
  useEffect(()=>{
    if(!isAdmin) return;
    let changed=false;
    const next=sharedProps.map(p=>{
      const tasks=p.tasks||[];
      const keep=tasks.filter(t=>!isLeftoverChecklistTask(t));
      if(keep.length!==tasks.length){changed=true;return {...p,tasks:keep};}
      return p;
    });
    if(changed) setSharedProps(()=>next);
  },[sharedProps,isAdmin,setSharedProps]);

  // Apply automation rules: when a property reaches a rule's trigger status, add its
  // tasks once (tracked via property.autoApplied so it never double-adds).
  useEffect(()=>{
    if(!automations||automations.length===0) return;
    let changed=false;
    const next=sharedProps.map(p=>{
      if(p.archived) return p;
      const applied=new Set(p.autoApplied||[]);
      const toApply=automations.filter(a=>a.trigger===p.status && !applied.has(a.id));
      if(toApply.length===0) return p;
      changed=true;
      const add=[];
      toApply.forEach((a,ai)=>{
        (a.tasks||[]).forEach((t,ti)=>{
          if(!t.text||!t.text.trim()) return;
          add.push({id:Date.now()+ai*1000+ti,text:t.text,cat:t.category||"Automation",status:"Not Started",assignee:t.assignTo||"",delegate:(t.delegateTo&&t.delegateTo!==t.assignTo)?t.delegateTo:"",autoId:a.id});
        });
        applied.add(a.id);
      });
      return {...p,tasks:[...(p.tasks||[]),...add],autoApplied:[...applied]};
    });
    if(changed) setSharedProps(()=>next);
  },[sharedProps,automations,setSharedProps]);

  function navigateToProperty(propId){
    setNavPropId(propId);
    setActive("properties");
  }

  const initials=initialsOf(displayName)||"?";
  const pageEl = active==="properties"
    ? <PropertiesPage sharedProps={sharedProps} setSharedProps={setSharedProps} initialSelId={navPropId} onNavConsumed={()=>setNavPropId(null)} onArchive={archiveProperty}/>
    : active==="leads" ? <NewLeadsPage/>
    : active==="messages" ? <MessagingCenter sharedProps={sharedProps} setSharedProps={setSharedProps}/>
    : active==="showings" ? <ShowingsPage/>
    : active==="portfolio" ? <PortfolioPage sharedProps={sharedProps} setSharedProps={setSharedProps} onNavigate={navigateToProperty}/>
    : active==="tasks" ? <TasksPage onNavigate={navigateToProperty}/>
    : active==="contacts" ? <ContactsPage/>
    : active==="financials" ? (isAdmin ? <FinancialSectionPage/> : <ComingSoon label="Financial Section"/>)
    : <ComingSoon label={NAV.find(n=>n.key===active)?.label}/>;

  if(loading) return <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:T.bg,color:T.gold,fontWeight:700,fontSize:16,fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif"}}>Loading Goldstone…</div>;

  return(
    <div style={{display:"flex",flexDirection:isMobile?"column":"row",height:"100vh",width:"100%",fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',sans-serif",background:T.bg,overflow:"hidden"}}>
      {saveError&&(
        <div onClick={clearSaveError} style={{position:"fixed",top:"max(12px,env(safe-area-inset-top))",left:"50%",transform:"translateX(-50%)",zIndex:9999,maxWidth:"92vw",background:"#FFF0EF",border:`1.5px solid ${T.red}`,color:T.red,borderRadius:12,padding:"12px 16px",fontSize:13,fontWeight:600,boxShadow:"0 8px 30px rgba(0,0,0,0.18)",cursor:"pointer",display:"flex",alignItems:"center",gap:10}}>
          <span style={{flex:1}}>{saveError}</span>
          <span style={{fontSize:16,lineHeight:1}}>×</span>
        </div>
      )}
      <aside style={{width:220,background:T.card,borderRight:`1px solid ${T.border}`,display:isMobile?"none":"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"20px 20px 18px",borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center"}}>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWkAAACNCAYAAAB12YtuAAAACXBIWXMAABYlAAAWJQFJUiTwAAATtUlEQVR4nO2dT2wcyXXGnwxjMAMsYlGXIKdldn3IbdegYvgSjAy0gBwCrPYg2jlZzoFCTuYCAcnbcm/kXMw9JAB5MfcY8RDtWQOsGrBPlmD5ECBBYlm6G0stsAhpYgEFJX8tl4rdM11Vb7qre74fQAgie4r9h/31669evXfl5cuXQgghJE2+xetCCCHpQpEmhJCEoUgTQkjCUKQJISRhKNKEEJIwFGlCCEkYijQhhCQMRZoQQhKGIk0IIQlDkSaEkIShSBNCSMJQpAkhJGEo0oQQkjAUaUIISZhv8+LMJ59kV0VkU0SejLem91PfX0JIf2A96Tnkk+yOiByIyHewZS4id8Zb02fJ7jQhpDdQpCvIJ9kNiPN7IvJcRHZFZFVEPhaRr8z/x1vTgyR3nhDSGyjSDvkkW4U4fwAxPhhvTXeLrfJJ9r6IHEO8GVUTQhYKRRpYvvPH+NZn5v/jremLiu13raj6DSEnhBAtKNKXfecc4vykxufsqPq3iKrnfo4QQuqy1CLt+M6nIvJPIdkb+STbhGdtRP4TRtWEEC2WUqRLfGdjabwd4zFjTBNVjxlVE0K0WCqRtnznTUS9r31nLY/Ziao/RRZIqa9NCCHzWBqRhu+8a0XMl3xneMwHsdGwE6k/xzgPVQ+IELIU9F6k4TvvQnifQ5xn+s5aHnM+yW7BAmFUTQgJorcijWjWiOtPROSPsDB2PD9ve8ybIdEwLJZjK6qe+5AghJCC3ol0ie/8axH5W3jNd3wFUstjRlR9ALvlc+wLo2pCyEx6VQUPvvMTTACap8/j8db0+yLyQ2Rw/Ec+ye5DyGuBpd+rENafmfFhoXiBh8P7EHoTVT+DcBNCSCW9iKTLfGd8GXG8IX+OsHchtKFRtYrHjP09tqLqTS4tJ4SU0WmRdnznN1Ln8kn2yj8uRNr6jCuQXraD4zEHib2UPzRYsIkQcolOivSsfGdrm1KRFr2oOkrsrXFYsIkQUknnRBq+856I/OWsOhuzRNraxhZab4HUEHtrrF2WQSWEuHRGpB3f2fDv463pj2dsP1ek5XL1uyCBjBV7axwWbCKEvEHy2R3Gd84nmRGuL5Ad8Ql+9F8a4xuLAj7290zGhYj83Ag8/O66Yzy0MjfGyADZDNgX056rOEbz+3+DCJsQsqQkK9ImwoVAPcHEoPGdVxdVYc4RSG+hhdhvxoi9NdYuRN9E5R/nk+wJomxCyJKRpEg7+c7m3++Nt6aNLP5QiKrLxN77wWLsElg1H9lRtU+ONyGk+yQl0sbbhZf8C3zrQyNUEb7sdyH4XsRG1XJZ7IOjYfjjr6Pq0MU0hJBuksTEoZPvLPOKGuWT7GWNbX4pImsiMmx7Mo8FmwghobQaSZf4zkYERcl3/sYsC1ewHYqo+qPQyTw3Go6Iqu9rLFEnhHSH1kS6zHcWEe3qcN9YtsMTTdvBd5wKj/nA12PGBKWJqD8UEfPZL3zrkRBCukPjIr0A33kuiIY1BLJ0Ms9zjELsNQo2rbJgEyH9pjGRLst3Hm9NV5usrVwhkN7CphRVu9FwaFS9GVPljxCSNo2INASskXzneTgCKaHCpmFfVHjMIQ+NhyVlUL0X0xBC0qOpSPoqMhI+bCrfeR4V9Z1DVglG2ReOxywRDw07qo5aTEMISYemPemk0sVmCJvXxKKGfaHVFMBE1bE53oSQdOhVZ5ZQSoQtqGZGbIrcDI85dGm5u3KSS8sJ6RgUaQsI219bE4LPfDMvKlLkfKNq12OOLdj0GR4+x75jEELahSLtYE0I/jQy80Irqo4q2ITo+RbKsHLhCyEdIzWRvlGsOmyb8db02BFZb49YY+FJTB0Rq9XXq3PLJeSEdI8UI+lkhMQSWdsj9o5mNRaelHjMdXKzi5ojpd1rCCHpQ7ujBpZHHFMVL3rhiU8dEWPR4IHwKd4KCCEdhCJdk4oOLt51QCoWnvhG1TNXPKIuirFoPseDgRDSUSjSnlREs77ZGxpRddWKx79DXZRXZVUbOCWEkAVCkQ5Eo1CSxnJuJ6o2+2HG/NpkdHCikJDu8+2eX8PVmotSHgaM/QRNBG5ZxfhN9sbnaAxQSyCx3aaJpEXkADbKLZ8mBWY7fOY3iKp/FNLgIIbBcPSOiGyIiPn3tjXUycX52XrI0IPhaFtEMnwVPMaY+4FjPkIzCMP+xfnZTuhhD4ajPRHZLvmR2cep+ffi/OwkdHzrd6w550Dq7PtgODKfe+Tx604vzs+uee7fIq7RGv6WzJjXL87PTku2sc997es4GI5WROTLGptG/W1o0neRfhv1qudRZ5tL5BP3vnmFiYhPK372HH52FS+wjZmc/J98kv23iPwvilPN45aVMvj9fJL9X8n2L7SzPHBD7ZWISME7gWPeq/is+dnaYDgyN/H6xfnZ46AdXyxrxYNgMByZ/bvru584Bw9EZKViE+/zqsmirhFE1H6wmHNwvc1jbZu+i3QO37Z6gz/5wCHLpavGvTojjfB9/HwWRsT/gAfMC3zmA4/9+gBfZQ8eY6uoTSQOhqPbuFFn4SUmiMhniVPBq+0Gw5GJtJ7GHMeCeRXNDoajdc+o+t6cc9CaSDd8jYzYP7g4P7sZ+Pl5XE/0Qf+avov0XGA3hNgdIZ9phIoHzxeaOeiD4SgrEegpXnWPIm5KV5xOEImeIso6tOyUFWyfQqRlrI1X+4EI8rbzdnE4GI6mZa/uLohSbRE253LH1zqB+Fyxv6dk9zR9jTJjb8zY17nntMssvUj3kbIHT4X9EoPrxZqb9ChmQERoa9a3jNjfLf4DgVt3/EgTaa2lFA3hPBxBrA/x7RX4rHV8Wld0VvDwa52Gr1FxHszxbw+Go9NQn7vLMLuDhGLfqPuxAg0uTY5VbOf+rrWK7VoF52Q64/hKwVuIfYxGpH43GI4OIZJahESgTV8je9J5DxabJsaKelnyVTYh3AoUaeINXmnt191LEZKJpKw//L2av8P1OEtFBCJm/2yeN9om9rmpvZ+ITt3X+41CrFs8nkav0cX5mXnI3bW+dQg7aGmgSBNv8Epr34Ba0V3Za/4lEE2uzPhcSqyF7qd5tb84P7sCsbY/u9GiUDd+jfBGUjywVmZklYRgJg6vlHwlY6tQpEkodoS4rRTdTJ3/V71ybsz5XBJYOcRR+wnBeNcROu3X/ro0eY1W8NZWnIPCQnFz8XsNRZqEYkcaK/D2DmM8Q7wi2xkMJmK8V9yo5l/zf0cYHqeWgmfE2aSNIX+8wPWZfXFF77WANUmb1wgWUJnYp2x3RdPn7A6Thna1YsVhsulznjxpa+m38QoHw9GOI0QbuGljht5B9FnceEb0b1eMeepMLPmyXTFBFJKaZjIYXlb87BSLOmq98s9YyWjzuO54MwgVtyavkcs6crSXxpfuu0hXrTgMWmGYIp6pdaqdWcwr6GA4egpBUblpTMQ1GI5u1vAdn0L4Ul7IIoj87nru5zzxfawsfF60eY2Qi72OVYkaEfSjiodLcDkDbfos0mbl3jN3xWHECsMU8RHdhTyYsMDiBDnBhVcYNamDfNp3F1EXoiGK2h0ngfnbVSJt7JKnKRx7m9cID4m7eIs7SaXGxqJYusUsESsMU6T2ceST7OOaNUCCsPKk1W4Y3OSqN3qxKlBprB3N47XGPYr0r2eNrbo6U/sawcK5UmO7E8cbVx0/JThxuFywdCkhHYMiTQghCUORJoSQhKFIE0JIwlCkCSEkYSjShBCSMH1OwTPH9pZvc1hCCEmJPov0WyLyHjqSEEJIJ+mzSH8tIr/V7OnXcfiwIqSD9Fmkv0F37L6sLoxiAe2zCCENwIlDQghJGIo0IYQkDEWaBINi73YTzy/R29C7bKnTE7H4eqTRENQ0IijZ1weo3Bc6puax365ohmp/1S7LWTHelx69Ju2xvqyxb8VXrYYP1v55XVs0FFDZB2fMsr+9ZOpVU6SJJiuoLa0irqhRvYcuJ0GgS8i9knZLGZqaBo/tEHPsTdTEXkGTg9+10dFFg5LemlGgD+OjGg0WWoUiTWI5LZp4og9fUWJz21MMipvvujVe0YA1C4l60az1NsbYsZuNOmOHNnXVOvaCnYqmqFc8u7AUor9j7d866jy/43TTmcnF+dk157y9i+33S/axbunQ2IfSyYzz5FO+dBvnw1y3a844IXXAFwJFmsTyWjxMMXb0odtH5BZiJ9jj7Vv1mr0aCeB1dQOCcN0tQI//X8fPNwJ7M2ofuzb2/p1Y3VxiXuVT7szuyxoetHcVWpEtjL4X/V/NJ1lV3zmiQ9kfdxGFhEST7ninFd+fRyGSR1Xtm9Dhw4jqIewP3yLy2seubXtoncvU0DpPj9Gbci/l7i5NiXSxNHthnUEqMEXujxv+nVX8jYj8vYh8R0S+EpGDiLFMC7Bb6OH4R4x1PuczTfZ1LCI1jZspg6j4diopoqSZXUNMFxRMqGklkscc+70ZTXyvKUR7xduCRteXNoW+qoGwoKdi3YftPq77Nt68jjztkkZoNJJuobO1WcxS1i28MVA7xOzDGOL80/HWNOjBgf6MZqyf4VufGIGuc17RPmuh4A99G2Lgtv73Ap5uEeHebOB1NGoyTfPYFwFEbQ8+dXJC1AZ4k7qO87KB+YmQxsELZel6HDZFPslWIag/gTjXFtQy8km2ifFMJP65We4+3po+S+BQzeuiaymdIqIJElbMuj+AD73e0CROyL5qH7tPFFgbZLBkmOxLuYFvXfa17Alcp7uD4WgHQYF5yJr0zOup+NQUaWUQ7W5a9sJnRlxDBTWfZLdgZ7xd1CLxXeqOfWqCIoLcj/kDR4RzE0JtXkWnAeMVfuP2LGHChOGKQuSrcuyL4OL87CaE2kyQhnYw7zW4ZuvWG8eGdhPkUCjSijjRbg5BDfLh80n2PsQ5yibJJ9nugotMGd/3mvagllA/QmTja3kc4UYrhOnS6ysi9j1re1+0j90rg8UHCLV9Lrss1As7TyIybeB3eEGRVsCJdp+bSb3Qwk6Ieg9gk0ioTQIv/NiKwN9r4FSo4kTUjyAutbxCI0KD4agQavPZN171ETFtI4o+6ll0WeWv2+cy1lrp5IKYWSAXv5hcTebvgSIdgeakoLwZ9Qb7zvDCj9196kAqYnHTv2PfIBDbQlweeAr1XUxA3sbKxbJFHFPkN6dA1T4Kcr3rCod9Lu3zcWqdy3sKQh1KrMDfLpkLKNip47tjovdRxY/Nm5dGBowKFOkAFjApqOU721541D6lhCXUh743+MX52boVIdlpdtOEbsbGolJHqEN+r8a+phqFn+ChnYxAC0XajwVMCtq+8/MI3/kOxim88DtNZH4YAVQca8daXVj288dYIRgy9pFSbrA9puaxmwfGFcXxTmaNB28/9Fw+jd3Xefs357MqcwD4e1I754skNZE2YvVpAvtxiZJJwWAhdHzn4EjcsVuivHBCSJqkGEkn9XquYUU449m+c1AkXma3tL1ohxCyGGh3VFASpcZOCtpin0OcvcW+ROQ3++A7E0LKoUg7LGBSUMt3VhF5Qki3oEiDiknB4ChV0XcuTakL2BdCSAdpVKTzSfawqcwDHzQnBUXPdw4upuSMc8equEdbhJCO0ZRIFyJhotTf55MsiRxeCNiu4qSgPV6M72yn1IUuarmBMd5j5gch3aURkYYY7+aT7Biv7kasN00EGzMZF8oCJgVVxtMQVtgjZowPYI98NN6axtSuJoS0SNP1pE00eMOqK/GLIvpsIsorEbDYSUGVScaScbyFtcRT/xTnlRYHIR2mlYlDCPKq5d1+kU+yzxb1+0r8XY1Jwc1Y31mUUuraWnFICFk8rWZ3mAUY+SQ7cKq+3ZjzMS8cEdSYFNTynd2UOu+ypiU2izm2+777QghJl9ZT8BA13oFf/Upw8kn2DIITY4EM4e2OlSYFtXzn6LxprjgkZHlIJk8aAnrDenU3FkhM5Gsas34tIv8cOSmoIogaKXUVNgtXHBLSY5JbzILax/ctQYtJ2fvPyKavKoKo0Z+wxGYJ7vpCCOkOSa44hBBuwq9uPGVPSxCVUupcm+VD+s6ELA9JLwu3UvaKSbYiZW8haAmiRq5y2bJy+s6ELB9XXr5MvavSn3EyNX4lIv9QZT9gCboR+rnZIiW+80GE72xbJEG5yhrLygkh/aBTIi0eglpHpJV9Z42UOla6I4S8QedEuqDE730jZW+eSCv6zm5K3aavRVIyxm4by+UJIenRWZEuqFptVyXSJeLuLapyOaXuK4wZklJn+87eYxBC+k3nRVqqc5BNZ+hvCpEumcwL8p1FL6XO9p2DxiCE9J9eiHSBUyD/HJHyD7SK+VuFoYJLm2qMQQhZHnol0gWYgPs3EfkrrDp8K9J3dqPw3YCUOrfDSitlWgkh3aKX7bPgMd+HpfAv+PYzfNVGo/ynVocVQshy0stI2qYkZa9WFKyR/aHhXRNClpvei3TBvJQ9azuNlDr6zoQQFZZGpAuq+geWpcP5Zn+U+M7e3jUhhNgsnUhLuU98KCL/KCJ/EbIMm62rCCGLYilFusCJfE0WyL+Ot6Y7nmOwdRUhZGEstUgXhNTdqOtxE0JIDBRpizpNYTVypgkhpC4UaYeqlD36zoSQNqBIV1BiZ1y1fGe2riKENAJFeg7WxOCL0Ip5hBASCkW6BsbqoK1BCGkDijQhhCTMt3hxCCEkXSjShBCSMBRpQghJGIo0IYQkDEWaEEIShiJNCCEJQ5EmhJCEoUgTQkjCUKQJISRhKNKEEJIqIvL/0Ry0N4GU+OYAAAAASUVORK5CYII=" alt="Goldstone Properties" style={{height:62,width:"auto",display:"block",filter:"contrast(1.15) saturate(1.1)"}}/>
          </div>
        </div>
        <nav style={{flex:1,minHeight:0,overflowY:"auto",padding:"12px 10px"}}>
          {navItems.map(({key,label,icon})=>{const isActive=active===key;return <button key={key} onClick={()=>setActive(key)} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"10px 12px",borderRadius:T.radiusSm,border:"none",background:isActive?T.goldLight:"transparent",color:isActive?T.gold:T.textSub,fontWeight:isActive?600:400,fontSize:14,cursor:"pointer",marginBottom:2,transition:"all 0.15s",textAlign:"left",fontFamily:"inherit"}}><span style={{color:isActive?T.gold:T.textTert}}>{icon}</span>{label}{key==="messages"&&<UnreadBadge count={unreadTotal} style={{marginLeft:"auto"}}/>}</button>;})}
        </nav>
        <div style={{padding:"14px 16px",borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>setShowProfileMenu(true)} title="Profile & team" style={{width:34,height:34,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff",flexShrink:0,border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}>{initials}</button>
          <button onClick={()=>setShowProfileMenu(true)} title="Profile & team" style={{flex:1,minWidth:0,textAlign:"left",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0}}><div style={{fontSize:13,fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{displayName} <span style={{color:T.textTert,fontWeight:400}}>▾</span></div><div style={{fontSize:11,color:T.textSub,textTransform:"capitalize"}}>{role}</div></button>
          <button onClick={signOut} title="Sign out" style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:12,padding:"6px 10px"}}>Sign out</button>
        </div>
      </aside>
      <main style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{minHeight:54,padding:isMobile?"max(8px,env(safe-area-inset-top)) 16px 8px":"0 24px",borderBottom:`1px solid ${T.border}`,background:T.card,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {isMobile&&<button onClick={()=>setShowNavMenu(true)} title="Menu" aria-label="Open menu" style={{width:36,height:36,borderRadius:8,border:`1px solid ${T.border}`,cursor:"pointer",padding:0,flexShrink:0,backgroundColor:"#fff",backgroundImage:"url(/logo.png)",backgroundRepeat:"no-repeat",backgroundSize:"185%",backgroundPosition:"50% 27%"}}/>}
            <div style={{fontWeight:700,fontSize:17,color:T.text}}>{NAV.find(n=>n.key===active)?.label}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {!isMobile&&<div style={{fontSize:13,color:T.textSub}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>}
            {isMobile&&<button onClick={()=>setShowProfileMenu(true)} title="Profile & team" aria-label="Profile and team" style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:"#fff",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0,flexShrink:0}}>{initials}</button>}
            {isAdmin&&<button onClick={()=>setShowSettings(true)} title="Settings" aria-label="Settings" style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:15,padding:"5px 9px",lineHeight:1}}>⚙</button>}
            {isMobile&&<button onClick={signOut} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:12,padding:"6px 10px"}}>Sign out</button>}
          </div>
        </div>
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          {pageEl}
        </div>
      </main>
      {isMobile&&(
        <nav className="gs-tabbar" style={{display:"flex",background:T.card,borderTop:`1px solid ${T.border}`,flexShrink:0,paddingTop:4}}>
          {bottomItems.map(({key,label,short,icon})=>{const isActive=active===key;return(
            <button key={key} onClick={()=>setActive(key)} style={{flex:1,minWidth:0,minHeight:52,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,border:"none",background:"transparent",color:isActive?T.gold:T.textTert,cursor:"pointer",fontFamily:"inherit",padding:"4px 2px",overflow:"hidden"}}>
              <span style={{color:isActive?T.gold:T.textTert,position:"relative",display:"inline-flex"}}>{icon}{key==="messages"&&unreadTotal>0&&<UnreadBadge count={unreadTotal} style={{position:"absolute",top:-6,left:12,minWidth:16,height:16,fontSize:10}}/>}</span>
              <span style={{fontSize:10,fontWeight:isActive?700:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{short||label}</span>
            </button>);})}
          <button onClick={()=>setShowNavMenu(true)} title="More" style={{flex:1,minWidth:0,minHeight:52,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,border:"none",background:"transparent",color:T.textTert,cursor:"pointer",fontFamily:"inherit",padding:"4px 2px",overflow:"hidden"}}>
            <span style={{fontSize:18,lineHeight:1,position:"relative",display:"inline-flex"}}>☰{unreadTotal>0&&!bottomItems.some(n=>n.key==="messages")&&<UnreadBadge count={unreadTotal} style={{position:"absolute",top:-6,left:14,minWidth:16,height:16,fontSize:10}}/>}</span>
            <span style={{fontSize:10,fontWeight:500}}>More</span>
          </button>
        </nav>
      )}
      {showNavMenu&&<NavMenu items={navItems} active={active} isPinned={isPinned} onNavigate={(k)=>{setActive(k);setShowNavMenu(false);}} onTogglePin={togglePin} onClose={()=>setShowNavMenu(false)}/>}
      {showSettings&&<SettingsModal archived={archivedProps} onRestore={restoreProperty} onDelete={deleteProperty} onClose={()=>setShowSettings(false)}/>}
      {showProfileMenu&&<ProfileMenu displayName={displayName} role={role} isAdmin={isAdmin} teamMembers={teamMembers}
        onEditName={()=>{setShowProfileMenu(false);setShowProfile(true);}}
        onAddTeammate={()=>{setShowProfileMenu(false);setShowAddTeammate(true);}}
        onSignOut={signOut} onClose={()=>setShowProfileMenu(false)}/>}
      {showAddTeammate&&<AddTeammateModal onClose={()=>setShowAddTeammate(false)}/>}
      {showProfile&&<ProfileModal current={displayName} onSave={updateName} onClose={()=>setShowProfile(false)}/>}
    </div>
  );
}
