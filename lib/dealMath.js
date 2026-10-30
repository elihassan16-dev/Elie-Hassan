// Server copy of the app's deal + private-lender math (src/GoldstoneApp.jsx:
// finProfit — the single source of truth for profit — and drawRate /
// drawInterest / funderStats). Copied verbatim so the Claude connector reports
// the exact numbers the Financial Overview and Financial Section show.
// If a rule changes in GoldstoneApp.jsx, re-copy it here.
/* eslint-disable */
const QB_STOP=new Set(["st","street","ave","avenue","rd","road","dr","drive","ln","lane","ct","court","blvd","boulevard","pl","place","ter","terrace","way","cir","circle","hwy","highway","pkwy","parkway","sq","square","trl","trail","apt","unit","ste","suite","fl","floor","n","s","e","w","north","south","east","west"]);
const qbNorm=(s)=>(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
const qbTokens=(s)=>qbNorm(s).split(" ").filter(Boolean);
// House number, letter suffix kept ("24A Dewey Dr" → "24a"). A digits-only
// match skipped "24A" and grabbed the zip code instead, so 24A Dewey's
// ShowingTime showings never matched the property (Elie 10/6/26).
const qbHouseNum=(s)=>{const m=qbNorm(s).match(/\b(\d+[a-z]?)\b/);return m?m[1]:null;};
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
function n(v){const x=parseFloat(String(v).replace(/,/g,""));return isNaN(x)?0:x;}
function pct(v){const x=parseFloat(String(v));return isNaN(x)?0:x/100;}
// Currency: show cents only when the value actually has them (so $1,225.81 keeps
// its cents, but $740,000 stays clean). Negatives read as -$X.

const finSnapOnly=(f)=>f.hmLoanPct===undefined&&f.hmRate===undefined&&f.gapRate===undefined&&f.acHmLoanAmt===undefined;
// "Paid so far + from today forward" hard-money interest, re-derived live from
// what the popup saved (paid-so-far from QuickBooks and the day the forward
// clock started) against the CURRENT closing date - so moving the sale date
// moves the number without another Save. Older saves that only stored the
// total keep it.
function acHmFwdLive(f,close,loan,rate){
  if(!f.acHmFromToday)return null;
  if(!close||f.acHmPaidSoFar===undefined||f.acHmPaidSoFar===""||!f.acHmFwdStart)return n(f.hmInterest);
  const perDay=loan*(rate/100)/365;
  const fwd=Math.round(perDay*daysBetween(f.acHmFwdStart,close));
  const pt=f.acHmPaidThrough||"";
  const credit=(pt&&pt>close)?Math.round(perDay*daysBetween(close,pt)):0;
  return Math.max(0,n(f.acHmPaidSoFar)+fwd-credit);
}

// ─── SINGLE SOURCE OF TRUTH for a property's profit ───────────────────────────
// Used by BOTH the Financial Overview banner and the Portfolio Overview so the
// two can never disagree. Mirrors the Financial Overview formulas exactly.
// If you change a profit rule, change it HERE only.
function finProfit(f,status,closingSched){
  if(!f) return {netProfit:0,acNet:0,effective:0,useActual:false,equityRequired:0};
  const buyingItems=f.buyingCostItems||[];
  const buyingTotal=buyingItems.length>0?calcBuyingTotal(buyingItems,f.purchasePrice):n(f.buyingCosts)||0;
  const sellingItems=f.sellingCostItems||[];
  const holdingItems=f.holdingCostItems||[];
  const months=n(f.holdPeriod)||0;
  const sellingOf=(sp,items,flat)=>items.length>0
    ?items.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>{
        if(i.autoType==="commission")return s+Math.round(n(sp)*(parseFloat(i.commissionPct||0)/100));
        if(i.autoType==="flatfee")return s+(n(i.amountOverride)>0?n(i.amountOverride):INHOUSE_FLAT_FEE(sp));
        if(i.autoType==="tax"){const rtf=calcNJRTF(n(sp));return i.resp==="Seller Pays"?s+rtf.total:i.resp==="Split"?s+Math.round(rtf.total/2):s;}
        return s+n(i.amount);
      },0)
    :n(flat)||0;

  // ── Projected ──
  const sellingTotal=sellingOf(f.salePrice,sellingItems,f.sellingCosts);
  const holdingTotal=holdingItems.length>0?holdingItems.reduce((s,i)=>s+(i.perYear?n(i.amount)/12:n(i.amount))*months,0):n(f.annualHoldingCosts)||0;
  const totalCosts=n(f.purchasePrice)+buyingTotal+n(f.rehabCosts)+holdingTotal;
  const liveHmLoan=Math.round(n(f.purchasePrice)*(n(f.hmLoanPct||90)/100));
  const liveRehabLoan=Math.round(n(f.rehabCosts)*(n(f.rehabFinPct||100)/100));
  const liveHmTotal=liveHmLoan+liveRehabLoan;
  // Interest on the FULL hard-money commitment (purchase + rehab financing) —
  // matches the Financing Breakdown popup and the Actual-financing math.
  const liveHmMonthly=Math.round(liveHmTotal*(n(f.hmRate||9)/100)/12);
  const liveHmReserve=Math.round(liveHmMonthly*months);
  const liveHmOrigFee=Math.round(liveHmTotal*(n(f.hmOrigPct||0)/100));
  const liveHmDoc=n(f.hmDocFee||1000);
  const liveGapPrinc=Math.round(n(f.purchasePrice)*(1-n(f.hmLoanPct||90)/100))+Math.round(n(f.rehabCosts)*(1-n(f.rehabFinPct||100)/100))+buyingTotal+liveHmReserve+liveHmOrigFee+liveHmDoc;
  const liveGapBalloon=Math.round(liveGapPrinc*(n(f.gapRate||15)/100)/12*months);
  // Debt service = interest + the lender's fees (origination + doc), matching the
  // Financing Breakdown popup and the Actual-financing math — fees are borrowing
  // costs and belong in the total (and in net profit).
  const snapOnly=finSnapOnly(f);
  const hmInterestP=(snapOnly&&n(f.hmInterest))||liveHmReserve;
  const gapInterestP=(snapOnly&&n(f.locInterest))||liveGapBalloon;
  const debtService=hmInterestP+liveHmOrigFee+liveHmDoc+gapInterestP;
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
  const equityRequired=(snapOnly&&n(f.locLoan))||liveGapPrinc;
  const acGapLoanAmt=n(f.acGapLoanAmt)||equityRequired;
  // Insurance is paid in full at closing (you're reimbursed the unused portion when
  // you cancel after the sale), so the whole annual premium is cash you need for the
  // down payment — even though profit only carries the prorated hold-period portion
  // (already handled in holdingTotal above). Add the full premium on top of the gap.
  const annualInsurance=(holdingItems||[]).filter(i=>(i.title||"").toLowerCase().includes("insurance")).reduce((s,i)=>s+(i.perYear?n(i.amount):n(i.amount)*12),0);
  // Property taxes: at closing you escrow/prepay roughly half a year, so count half
  // the annual tax as cash to close (profit still carries the true prorated portion
  // via holdingTotal above).
  const taxEscrow=Math.round((holdingItems||[]).filter(i=>(i.title||"").toLowerCase().includes("tax")).reduce((s,i)=>s+(i.perYear?n(i.amount):n(i.amount)*12),0)*0.5);
  const acGapRate=f.acGapRate!==undefined?n(f.acGapRate):n(f.gapRate||15);
  const acHmMonthlyInt=Math.round(acHmLoanAmt*(acHmRate/100)/12);
  // "From today forward" mode: total HM interest = paid so far (from QuickBooks) +
  // interest still to accrue to close. The popup computes and stores that total in
  // hmInterest, so read it back here rather than re-deriving without QuickBooks.
  const acClose=closingSched||f.sellingDate||f.acHmPayoffDate||"";
  const acHmFwd=acHmFwdLive(f,acClose,acHmLoanAmt,acHmRate);
  const acHmInterest=f.acHmInterestOverride!==undefined&&f.acHmInterestOverride!==""?n(f.acHmInterestOverride):(acHmFwd!=null?acHmFwd:Math.round(acHmMonthlyInt*actualHoldMonths)+Math.round(acHmLoanAmt*(acHmOrigPct/100))+acHmDocAmt);
  const acGapBalloon=f.acGapInterestOverride!==undefined&&f.acGapInterestOverride!==""?n(f.acGapInterestOverride):Math.round(acGapLoanAmt*(acGapRate/100)/12*actualHoldMonths);
  const acNet=acSalePrice>0?acSalePrice-acSelling-(acHmInterest+acGapBalloon)-acCosts:0;

  const useActual=!!(f.useActualProfit&&acSalePrice>0);
  // Equity required: the estimate (gap + full insurance + half-year tax escrow),
  // UNLESS the deal is past Under Contract and an actual LOC / gap amount has been
  // entered (Actual Financing popup, reconciled to the balance sheet) — then that
  // real number overrides the estimate.
  const estEquity=equityRequired+annualInsurance+taxEscrow;
  const actualEquity=n(f.acGapLoanAmt);
  const useActualEquity=!!(status&&status!=="Under Contract"&&status!=="New Leads"&&actualEquity>0);
  return {netProfit,acNet,effective:useActual?acNet:netProfit,useActual,equityRequired:useActualEquity?actualEquity:estEquity,equityIsActual:useActualEquity,
    // Breakdown pieces (projected) — exposed for the Investor Packet so it prints
    // the exact same numbers as the Financial Overview, never a re-derivation.
    buyingTotal,sellingTotal,holdingTotal:Math.round(holdingTotal),debtService,hmLoanTotal:liveHmTotal,
    hmInterest:hmInterestP,gapInterest:gapInterestP};
}

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

const NJ_TITLE_FLAT={ searchExam:325, settlement:600, municipal:250, recording:250, misc:150 };
function calcNJTitle(price){
  const p=price||0;
  let premium=0;
  if(p<=100000) premium=(p/1000)*5.25;
  else if(p<=500000) premium=525+((p-100000)/1000)*4.25;
  else if(p<=2000000) premium=2225+((p-500000)/1000)*2.75;
  else premium=6350+((p-2000000)/1000)*2.00;
  premium=Math.max(200,Math.round(premium));
  const f=NJ_TITLE_FLAT;
  const flats=f.searchExam+f.settlement+f.municipal+f.recording+f.misc;
  // searchAndExam kept for backwards-compat with any older reads.
  return{premium,searchAndExam:f.searchExam,settlement:f.settlement,municipal:f.municipal,recording:f.recording,misc:f.misc,flats,total:premium+flats};
}

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

const INHOUSE_FLAT_FEE=(sp)=>{const v=n(sp);return v<=350000?1200:v<=500000?1500:2000;};

const LOC_RATE=0.15;
// 📜 Per-loan terms: the loan's own custom rate wins, else the lender's default
// (stamped on the draw as funderRate and re-stamped whenever the lender is edited),
// else the app default 15%. Rates are stored as whole percents (15 = 15%/yr) and
// 0 is a REAL rate — a 0% line of credit accrues no interest.
const hasRate=(v)=>v!=null&&v!==""&&isFinite(Number(v))&&Number(v)>=0;
const drawRate=(d)=>{if(hasRate(d&&d.rate))return Number(d.rate)/100;if(hasRate(d&&d.funderRate))return Number(d.funderRate)/100;return LOC_RATE;};

const daysBetween=(a,b)=>{const s=new Date(a),e=new Date(b);if(isNaN(s)||isNaN(e))return 0;return Math.max(0,Math.round((e-s)/86400000));};
const drawDays=(d)=>daysBetween(d.dateFunded,d.paybackDate||new Date());
// Partial paydowns: money the lender got back before the loan was fully paid off.
const drawPaid=(d)=>((d.payments||[]).reduce((s,p)=>s+(Number(p.amount)||0),0));
// Principal still outstanding = original amount minus every partial paydown (never < 0).
const drawBalance=(d)=>Math.max(0,(Number(d.amount)||0)-drawPaid(d));
// Interest is day-counted at 15%/yr on the OUTSTANDING balance in each period. A
// partial paydown lowers the balance from its date forward, so the larger loan only
// accrues up to the paydown, then the smaller balance accrues after it — exactly the
// tiered calc a real line of credit uses.
const drawInterest=(d)=>{
  if(!d||!d.dateFunded)return 0;
  const end=d.paybackDate||new Date().toISOString().slice(0,10);
  const pays=[...(d.payments||[])].filter(p=>p.date&&(Number(p.amount)||0)>0).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const rate=drawRate(d);
  let bal=Number(d.amount)||0, cursor=d.dateFunded, int=0;
  for(const p of pays){
    if(String(p.date)>String(end))break;                 // paid after payoff — ignore
    int+=bal*(rate/365)*daysBetween(cursor,p.date);
    bal=Math.max(0,bal-(Number(p.amount)||0));
    cursor=p.date;
  }
  int+=bal*(rate/365)*daysBetween(cursor,end);
  return int;
};
const sameName=(a,b)=>!!a&&!!b&&String(a).trim().toLowerCase()===String(b).trim().toLowerCase();
// Which private-lender draws belong to a property: explicit link, else a strong
// address match on the draw's label (reuses the QuickBooks address matcher).
const drawsForProperty=(property,draws)=>{
  if(!property)return [];
  const addr=`${property.address||""} ${property.city||""}`.trim();
  const ex=new Set((property.locDrawsExcluded||[]).map(String)); // ✕'d by hand in Actual Financing
  const myNum=qbHouseNum(property.address||"");
  return (draws||[]).filter(d=>{
    if(ex.has(String(d.id)))return false;
    // Linked to a property in the Financial Section = that property's, full stop.
    if(d.propertyId!=null)return String(d.propertyId)===String(property.id);
    const label=d.propertyLabel||"";
    // "77 Coral" is not "579 Coral": the street-name match used to win on its
    // own (Streicher's paid-back 77 Coral draw showed on 579 Coral, Elie 9/16).
    // When both sides carry a house number they have to agree.
    const ln=qbHouseNum(label);
    if(myNum&&ln&&myNum!==ln)return false;
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
  const paidWithdrawnPrincipal=paid.filter(d=>d.principalHandling==="withdraw").reduce((s,d)=>s+drawBalance(d),0);
  const reinvest=ledgerSum(f,"reinvest")+paidReinvest;             // manual reinvest entries + reinvested payback interest
  const distribution=ledgerSum(f,"distribution")+paidDistrib;      // manual + interest paid out at payback
  const withdrawal=ledgerSum(f,"withdrawal")+paidWithdrawnPrincipal; // manual + principal he took back at payback
  const capital=principal+reinvest-withdrawal+adjustment;
  const deployed=open.reduce((s,d)=>s+drawBalance(d),0);   // only the still-outstanding balance is deployed
  const interest=open.reduce((s,d)=>s+drawInterest(d),0);           // accruing on open loans
  const interestRealized=paid.reduce((s,d)=>s+drawInterest(d),0);   // earned on closed loans
  const interestEarned=interest+interestRealized;                   // total interest accrued
  const interestAdjust=ledgerSum(f,"interest_adjust");              // manual ± correction to interest owed
  // What's still owed to him in interest = earned − what's been reinvested or paid out (± manual).
  // Paying out interest (a distribution) lowers this; overpaying takes it negative.
  const interestOwed=interestEarned-reinvest-distribution+interestAdjust;
  return {principal,reinvest,distribution,withdrawal,adjustment,interestAdjust,capital,deployed,interest,interestRealized,interestEarned,interestOwed,available:capital-deployed,mine,open,paid};
};

export { n, finProfit, drawRate, drawBalance, drawInterest, drawsForProperty, funderStats, funderDraws, hasRate, calcNJRTF, INHOUSE_FLAT_FEE, qbMatchScore };
