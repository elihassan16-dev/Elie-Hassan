import { useState, useMemo, useEffect } from "react";
import { useData } from "./data/DataProvider";
import { useAuth } from "./auth/AuthProvider";
import { mkLead } from "./seed";

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

const TASK_STATUSES=["Not Started","In Progress","Completed","N/A"];
const TASK_STATUS_COLORS={"Not Started":{bg:"#F2F2F7",color:"#8A8A8E"},"In Progress":{bg:"#FFF4E5",color:"#FF9500"},"Completed":{bg:"#EDFBF1",color:"#34C759"},"N/A":{bg:"#F2F2F7",color:"#AEAEB2"}};


// ─── Helpers ──────────────────────────────────────────────────────────────────
function n(v){const x=parseFloat(String(v).replace(/,/g,""));return isNaN(x)?0:x;}
function pct(v){const x=parseFloat(String(v));return isNaN(x)?0:x/100;}
function fmtD(v){return "$"+Math.round(v||0).toLocaleString();}

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
  sort:<Ico lines={[[3,6,21,6],[3,12,15,12],[3,18,9,18]]}/>,
};
const NAV=[
  {key:"tasks",label:"Tasks",short:"Tasks",icon:ICONS.tasks},
  {key:"portfolio",label:"Portfolio Overview",short:"Portfolio",icon:ICONS.portfolio},
  {key:"leads",label:"New Leads",short:"Leads",icon:ICONS.leads},
  {key:"properties",label:"Properties",short:"Properties",icon:ICONS.properties},
  {key:"calendar",label:"Calendar",short:"Calendar",icon:ICONS.calendar},
  {key:"contacts",label:"Contacts",short:"Contacts",icon:ICONS.contacts},
];

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
        ?<input autoFocus value={raw} onChange={e=>setRaw(e.target.value.replace(/[^\d]/g,""))}
            onBlur={commit} onKeyDown={e=>e.key==="Enter"&&commit()}
            style={{width:140,padding:"5px 8px",borderRadius:6,border:`1.5px solid ${T.gold}`,background:T.goldLight,color:T.text,fontSize:14,outline:"none",textAlign:"right",fontFamily:"inherit"}}/>
        :<span onClick={()=>{setRaw(value||"");setEditing(true);}}
            style={{fontSize:14,fontWeight:500,color:amt>0?T.text:T.textTert,cursor:"pointer",minWidth:120,textAlign:"right",display:"inline-block"}}>
            {amt>0?fmtD(amt):"tap to enter"}
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
function RowHdr({label,color,showActual}){
  return(
    <div style={{display:"grid",gridTemplateColumns:showActual?"1fr 160px 160px":"1fr 160px",borderTop:`1px solid ${T.border}`,background:T.bg}}>
      <div style={{gridColumn:showActual?"1 / span 3":"1 / span 2",padding:"9px 18px 5px",display:"flex",alignItems:"center",gap:7}}>
        <span style={{width:3,height:12,borderRadius:2,background:color,display:"inline-block"}}/>
        <span style={{fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</span>
      </div>
    </div>
  );
}
function DateGridRow({label,value,onChange,showActual}){
  return(
    <div style={{display:"grid",gridTemplateColumns:showActual?"1fr 160px 160px":"1fr 160px",borderTop:`1px solid ${T.border}`}}>
      <div style={{padding:"9px 18px",fontSize:13,color:T.text}}>{label}</div>
      <div/>
      <div style={{padding:"6px 14px",textAlign:"right"}}>
        <input type="date" value={value||""} onChange={e=>onChange(e.target.value)}
          style={{fontSize:12,padding:"4px 7px",borderRadius:6,border:`1px solid ${T.border}`,background:T.bg,color:T.text,outline:"none",fontFamily:"inherit",cursor:"pointer"}}/>
      </div>
    </div>
  );
}
function EditGridRow({label,pVal,pEdit,aVal,aEdit,showActual,readOnlyActual,suffix,dim,dimP}){
  const[editingP,setEditingP]=useState(false);
  const[editingA,setEditingA]=useState(false);
  const[rawP,setRawP]=useState("");
  const[rawA,setRawA]=useState("");
  const inS={width:"100%",padding:"5px 8px",borderRadius:6,border:`1.5px solid ${T.gold}`,background:T.goldLight,color:T.text,fontSize:13,outline:"none",textAlign:"right",fontFamily:"inherit",boxSizing:"border-box"};
  const pColor=dimP?T.textTert:(dim?T.textTert:T.text);
  return(
    <div style={{display:"grid",gridTemplateColumns:showActual?"1fr 160px 160px":"1fr 160px",borderTop:`1px solid ${T.border}`}}>
      <div style={{padding:"9px 18px",fontSize:13,color:dim?T.textTert:T.text}}>{label}</div>
      <div style={{padding:"6px 14px",textAlign:"right"}}>
        {editingP
          ?<input autoFocus value={rawP} onChange={e=>setRawP(e.target.value.replace(/[^\d.]/g,""))}
              onBlur={()=>{setEditingP(false);pEdit(rawP);}} onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
              style={inS}/>
          :<span onClick={()=>{setRawP(String(pVal||""));setEditingP(true);}} style={{fontSize:13,color:pColor,cursor:"pointer"}}>{suffix?`${pVal||0} ${suffix}`:fmtD(n(pVal))}</span>}
      </div>
      {showActual&&<div style={{padding:"6px 14px",textAlign:"right"}}>
        {readOnlyActual?<span style={{fontSize:13,color:T.textTert}}>—</span>:
        editingA
          ?<input autoFocus value={rawA} onChange={e=>setRawA(e.target.value.replace(/[^\d.]/g,""))}
              onBlur={()=>{setEditingA(false);aEdit(rawA);}} onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
              style={inS}/>
          :<span onClick={()=>{setRawA(String(aVal||""));setEditingA(true);}} style={{fontSize:13,fontWeight:n(aVal)>0?600:400,color:n(aVal)>0?T.green:T.textTert,cursor:"pointer"}}>{n(aVal)>0?(suffix?`${aVal} ${suffix}`:fmtD(n(aVal))):"tap to enter"}</span>}
      </div>}
    </div>
  );
}
function PopupGridRow({label,pVal,onOpenP,aVal,aEdit,onOpenA,showActual,aIsPopup,dimP}){
  const[editingA,setEditingA]=useState(false);
  const[rawA,setRawA]=useState("");
  const inS={width:"100%",padding:"5px 8px",borderRadius:6,border:`1.5px solid ${T.gold}`,background:T.goldLight,color:T.text,fontSize:13,outline:"none",textAlign:"right",fontFamily:"inherit",boxSizing:"border-box"};
  return(
    <div style={{display:"grid",gridTemplateColumns:showActual?"1fr 160px 160px":"1fr 160px",borderTop:`1px solid ${T.border}`}}>
      <div style={{padding:"9px 18px",fontSize:13,color:T.text}}>{label}</div>
      <div onClick={onOpenP} style={{padding:"9px 14px",textAlign:"right",fontSize:13,color:dimP?T.textTert:T.blue,fontWeight:500,cursor:"pointer"}}>{fmtD(pVal)} ›</div>
      {showActual&&<div style={{padding:aIsPopup?"9px 14px":"6px 14px",textAlign:"right"}}>
        {aIsPopup
          ? <span onClick={onOpenA} style={{fontSize:13,fontWeight:500,color:T.green,cursor:"pointer"}}>{aVal>0?fmtD(aVal)+" ›":"tap to enter ›"}</span>
          : editingA
            ?<input autoFocus value={rawA} onChange={e=>setRawA(e.target.value.replace(/[^\d.]/g,""))}
                onBlur={()=>{setEditingA(false);aEdit(rawA);}} onKeyDown={e=>e.key==="Enter"&&e.target.blur()}
                style={inS}/>
            :<span onClick={()=>{setRawA(String(aVal||""));setEditingA(true);}} style={{fontSize:13,fontWeight:n(aVal)>0?600:400,color:n(aVal)>0?T.green:T.textTert,cursor:"pointer"}}>{n(aVal)>0?fmtD(n(aVal)):"tap to enter"}</span>}
      </div>}
    </div>
  );
}
function TotalGridRow({label,pVal,aVal,showActual,color,dimP}){
  const c=color||T.gold;
  return(
    <div style={{display:"grid",gridTemplateColumns:showActual?"1fr 160px 160px":"1fr 160px",borderTop:`2px solid ${c}`,background:c+"14"}}>
      <div style={{padding:"11px 18px",fontSize:14,fontWeight:700,color:dimP?T.textTert:c}}>{label}</div>
      <div style={{padding:"11px 14px",fontSize:14,fontWeight:700,color:dimP?T.textTert:c,textAlign:"right"}}>{fmtD(pVal)}</div>
      {showActual&&<div style={{padding:"11px 14px",fontSize:14,fontWeight:700,color:aVal!==null?c:T.textTert,textAlign:"right"}}>{aVal!==null?fmtD(aVal):"—"}</div>}
    </div>
  );
}

// ─── Actual Financing Popup — simple, user enters real loan amounts/rates ─────
function ActualFinancingPopup({f, liveHmTotal, liveGapPrinc, actualHoldMonths, onSave, onClose}){
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
  const f=property.financials;
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
  const netProfit=n(f.salePrice)-sellingTotal-debtService-totalCosts;

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

  const acNet = acSalePrice>0 ? acSalePrice-acSelling-acDebt-acCosts : 0;

  const iS={padding:"5px 8px",borderRadius:6,border:`1px solid ${T.border}`,background:"#fff",color:T.text,fontSize:13,outline:"none",textAlign:"right",fontFamily:"inherit",boxSizing:"border-box"};

  return(
    <div style={{background:T.bg,minHeight:"100%",padding:"24px 28px"}}>
      {showBuying&&<BuyingCostsPopup items={buyingItems} purchasePrice={f.purchasePrice} currentResp={f.transferTaxResp} onChange={(items,total,resp,taxAmt)=>upMany({buyingCostItems:items,buyingCosts:String(total),buyingTransferTax:String(taxAmt||0),transferTaxResp:resp})} onClose={()=>setShowBuying(false)}/>}
      {showSelling&&<SellingCostsPopup items={sellingItems} salePrice={f.salePrice} currentResp={f.transferTaxResp} onChange={(items,total)=>upMany({sellingCostItems:items,sellingCosts:String(total)})} onClose={()=>setShowSelling(false)}/>}
      {showHolding&&<HoldingCostsPopup items={holdingItems} holdPeriod={f.holdPeriod} onChange={(items,total)=>upMany({holdingCostItems:items,annualHoldingCosts:String(total)})} onClose={()=>setShowHolding(false)}/>}
      {showActualSelling&&<SellingCostsPopup items={acSellingItems} salePrice={f.actualSalePrice||f.salePrice} currentResp={f.transferTaxResp} onChange={(items,total)=>upMany({actualSellingCostItems:items,actualSellingCosts:String(total)})} onClose={()=>setShowActualSelling(false)}/>}
      {showFinancingP&&<FinancingPopup fin={f} onSave={(vals)=>upMany(vals)} onClose={()=>setShowFinancingP(false)}/>}
      {showActualFinancing&&<ActualFinancingPopup f={f} liveHmTotal={liveHmTotal} liveGapPrinc={equityRequired} actualHoldMonths={actualHoldMonths}
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
          <div style={{display:"grid",gridTemplateColumns:showActual?"1fr 160px 160px":"1fr 160px",borderBottom:`1px solid ${T.border}`,background:"#FAFAFA"}}>
            <div style={{padding:"12px 18px",fontSize:11,fontWeight:700,color:T.textSub,textTransform:"uppercase",letterSpacing:"0.06em"}}>Line Item</div>
            <div style={{padding:"12px 14px",fontSize:11,fontWeight:700,color:T.blue,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Projected</div>
            {showActual&&<div style={{padding:"12px 14px",fontSize:11,fontWeight:700,color:T.green,textTransform:"uppercase",letterSpacing:"0.06em",textAlign:"right"}}>Actual</div>}
          </div>

          {/* ── Transaction Dates (only matters for actual, but shown when actual is on) ── */}
          {showActual&&(<>
            <RowHdr label="Transaction Dates" color={T.purple} showActual={showActual}/>
            <DateGridRow label="Purchase Date" value={f.purchaseDate} onChange={v=>up("purchaseDate",v)} showActual={showActual}/>
            <DateGridRow label="Sell Date" value={f.sellingDate} onChange={v=>up("sellingDate",v)} showActual={showActual}/>
            {f.purchaseDate&&f.sellingDate&&(
              <div style={{display:"grid",gridTemplateColumns:"1fr 160px 160px",borderTop:`1px solid ${T.border}`,background:T.goldLight}}>
                <div style={{padding:"9px 18px",fontSize:13,fontWeight:600,color:T.gold}}>Hold Period</div>
                <div style={{padding:"9px 14px",fontSize:13,fontWeight:600,color:T.gold,textAlign:"right"}}>{holdPeriodMonths} mo</div>
                <div style={{padding:"9px 14px",fontSize:13,fontWeight:700,color:T.gold,textAlign:"right"}}>{actualHoldMonths} mo</div>
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
          <TotalGridRow label="Total Costs" pVal={totalCosts} aVal={showActual&&acCosts>0?acCosts:null} showActual={showActual} dimP={f.useActualProfit}/>

          {/* ── Financing ── */}
          <RowHdr label="Financing" color={T.blue} showActual={showActual}/>
          <EditGridRow label="Hold Period" pVal={f.holdPeriod||"0"} pEdit={v=>up("holdPeriod",v.replace(/[^\d.]/g,""))}
            aVal={null} showActual={showActual} readOnlyActual suffix="months" dimP={f.useActualProfit}/>
          <div style={{display:"grid",gridTemplateColumns:showActual?"1fr 160px 160px":"1fr 160px",borderTop:`1px solid ${T.border}`}}>
            <div onClick={()=>setShowFinancingP(true)} style={{padding:"11px 18px",fontSize:14,color:f.useActualProfit?T.textTert:T.text,cursor:"pointer"}}
              onMouseEnter={e=>e.currentTarget.parentElement.style.background="#FAFAFA"} onMouseLeave={e=>e.currentTarget.parentElement.style.background="transparent"}>
              Financing Details
            </div>
            <div onClick={()=>setShowFinancingP(true)} style={{padding:"11px 14px",fontSize:13,color:f.useActualProfit?T.textTert:T.blue,fontWeight:500,textAlign:"right",cursor:"pointer"}}>
              HM {fmtD(liveHmTotal)} · Gap {fmtD(equityRequired)} ›
            </div>
            {showActual&&<div onClick={()=>setShowActualFinancing(true)} style={{padding:"11px 14px",fontSize:13,color:T.green,fontWeight:500,textAlign:"right",cursor:"pointer"}}>
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
          <div style={{display:"grid",gridTemplateColumns:showActual?"1fr 160px 160px":"1fr 160px",borderTop:`2px solid ${netProfit>=0?T.green:T.red}`,background:netProfit>=0?"#EDFBF1":"#FFF0EF"}}>
            <div style={{padding:"15px 18px",fontSize:15,fontWeight:700,color:f.useActualProfit?T.textTert:(netProfit>=0?T.green:T.red)}}>Net Profit</div>
            <div style={{padding:"15px 14px",fontSize:17,fontWeight:800,color:f.useActualProfit?T.textTert:(netProfit>=0?T.green:T.red),textAlign:"right"}}>{fmtD(netProfit)}</div>
            {showActual&&<div style={{padding:"15px 14px",fontSize:17,fontWeight:800,color:acSalePrice>0?(acNet>=0?T.green:T.red):T.textTert,textAlign:"right"}}>{acSalePrice>0?fmtD(acNet):"—"}</div>}
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Property Detail ──────────────────────────────────────────────────────────
const PTABS=["Financial Overview","Property Info","Tasks","Contacts"];
function PropDetail({property,onUpdate}){
  const { contacts: CONTACTS } = useData();
  const[tab,setTab]=useState("Financial Overview");
  const[taskPopup,setTaskPopup]=useState(null);
  const sc=SC[property.status]||{color:"#64748B",bg:"#F1F5F9"};
  const upP=(k,v)=>onUpdate(property.id,"propertyInfo",{...property.propertyInfo,[k]:v});
  const addTask=()=>onUpdate(property.id,"tasks",[...property.tasks,{id:Date.now(),text:"",done:false,assignee:""}]);
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
        <div style={{fontSize:20,fontWeight:700,color:T.text,letterSpacing:"-0.3px",marginBottom:10}}>{full}</div>
        <div style={{marginBottom:14}}>
          <StatusPicker value={property.status} onChange={v=>onUpdate(property.id,"status",v)}/>
        </div>
        <div style={{display:"flex",background:T.bg,borderRadius:10,padding:3,gap:2,width:"fit-content"}}>
          {PTABS.map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{padding:"7px 16px",borderRadius:8,border:"none",background:tab===t?T.card:"transparent",color:tab===t?T.text:T.textSub,fontWeight:tab===t?600:400,fontSize:13,cursor:"pointer",fontFamily:"inherit",boxShadow:tab===t?"0 1px 3px rgba(0,0,0,0.12)":"none",transition:"all 0.15s"}}>
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
          const checklist=DEFAULT_CHECKLISTS[property.status]||[];
          const tasks=property.tasks||[];
          const normTask=t=>typeof t==="string"?{text:t,contact:null,linkedContact:null,multi:false}:{...t};
          const getTask=(cat,text)=>tasks.find(t=>t.cat===cat&&t.text===text)||{status:"Not Started",assignee:"",contactVal:""};
          const setTask=(cat,text,field,val)=>{
            const existing=tasks.find(t=>t.cat===cat&&t.text===text);
            if(existing) onUpdate(property.id,"tasks",tasks.map(t=>t.cat===cat&&t.text===text?{...t,[field]:val}:t));
            else onUpdate(property.id,"tasks",[...tasks,{id:Date.now(),cat,text,status:"Not Started",assignee:"",contactVal:"",[field]:val}]);
          };
          // Custom contacts saved to this property
          const customContacts=property.customContacts||[];
          const allContacts=[...CONTACTS,...customContacts];
          // Save a new contact to property directory
          const saveNewContact=(newC)=>onUpdate(property.id,"customContacts",[...customContacts,{...newC,id:Date.now()}]);
          // Get the resolved contact value for a linked role (e.g. "Title Company")
          const getLinkedVal=(role)=>{
            const master=tasks.find(t=>t.contactRole===role);
            return master?.contactVal||"";
          };
          const[popup,setPopup]=[taskPopup,setTaskPopup]; // lifted to PropDetail to avoid hook-in-callback error

          const allItems=checklist.flatMap(c=>c.tasks.map(t=>{const nt=normTask(t);return getTask(c.cat,nt.text);}));
          const done=allItems.filter(t=>t.status==="Completed").length;
          const inProg=allItems.filter(t=>t.status==="In Progress").length;
          const na=allItems.filter(t=>t.status==="N/A").length;
          const total=allItems.length;
          const pct=total>0?Math.round((done/total)*100):0;

          return(
            <div style={{padding:24}}>
              {popup&&<TaskContactPopup
                role={popup.role}
                contact={getTask(popup.cat,popup.text).contactVal}
                allContacts={allContacts}
                onSet={(name,newC)=>{
                  setTask(popup.cat,popup.text,"contactVal",name);
                  setTask(popup.cat,popup.text,"contactRole",popup.role);
                  if(newC) saveNewContact(newC);
                  setPopup(null);
                }}
                onClose={()=>setPopup(null)}/>}

              {/* Progress bar */}
              <div style={{background:T.card,borderRadius:T.radius,boxShadow:T.shadow,padding:"18px 22px",marginBottom:20}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:15,fontWeight:700,color:T.text}}>{property.status} — Progress</div>
                  <div style={{fontSize:20,fontWeight:800,color:T.green}}>{pct}%</div>
                </div>
                <div style={{height:10,borderRadius:5,background:T.bg,overflow:"hidden",marginBottom:10}}>
                  <div style={{height:"100%",borderRadius:5,background:`linear-gradient(90deg,${T.green},#22C55E)`,width:`${pct}%`,transition:"width 0.4s"}}/>
                </div>
                <div style={{display:"flex",gap:20}}>
                  {[["Completed",done,T.green],["In Progress",inProg,T.orange],["N/A",na,T.textTert],["Remaining",total-done-inProg-na,T.textSub]].map(([l,v,c])=>(
                    <div key={l} style={{fontSize:12,color:c}}><span style={{fontWeight:700}}>{v}</span> {l}</div>
                  ))}
                </div>
              </div>

              {checklist.length===0&&<div style={{textAlign:"center",padding:40,color:T.textTert,fontSize:14}}>No checklist for "{property.status}".</div>}

              {checklist.map(({cat,tasks:catTasks})=>(
                <Card key={cat} style={{marginBottom:16}}>
                  <GHeader label={cat}/>
                  <div style={{padding:"4px 0 8px"}}>
                    {catTasks.map((rawTask,i)=>{
                      const{text,contact:contactRole,linkedContact,multi}=normTask(rawTask);
                      const t=getTask(cat,text);
                      const sc=TASK_STATUS_COLORS[t.status]||TASK_STATUS_COLORS["Not Started"];
                      // For linked tasks, pull contactVal from the master task with that role
                      const resolvedContact=contactRole?t.contactVal:linkedContact?getLinkedVal(linkedContact):"";
                      const hasContact=contactRole||linkedContact;
                      return(
                        <div key={text} style={{borderTop:i===0?"none":`1px solid ${T.border}`}}>
                          <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 16px"}}>
                            <select value={t.status} onChange={e=>setTask(cat,text,"status",e.target.value)}
                              style={{background:sc.bg,color:sc.color,border:"none",borderRadius:20,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",outline:"none",flexShrink:0}}>
                              {TASK_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                            </select>
                            {/* Task name — clickable if has a contact */}
                            {hasContact
                              ? <span onClick={()=>setPopup({cat,text,role:contactRole||linkedContact})}
                                  style={{flex:1,fontSize:13,color:t.status==="Completed"||t.status==="N/A"?T.textTert:T.blue,textDecoration:t.status==="Completed"?"line-through":"underline",cursor:"pointer",fontWeight:500}}>
                                  {text}
                                </span>
                              : <span style={{flex:1,fontSize:13,color:t.status==="Completed"||t.status==="N/A"?T.textTert:T.text,textDecoration:t.status==="Completed"?"line-through":"none"}}>{text}</span>
                            }
                            {/* Contact chip if set */}
                            {hasContact&&resolvedContact&&(
                              <span onClick={()=>setPopup({cat,text,role:contactRole||linkedContact})}
                                style={{fontSize:11,fontWeight:600,color:T.gold,background:T.goldLight,padding:"3px 9px",borderRadius:20,cursor:"pointer",flexShrink:0}}>
                                {resolvedContact}
                              </span>
                            )}
                            {/* Assignee */}
                            <select value={t.assignee||""} onChange={e=>setTask(cat,text,"assignee",e.target.value)}
                              style={{fontSize:12,color:T.textSub,background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 7px",cursor:"pointer",fontFamily:"inherit",outline:"none",flexShrink:0}}>
                              <option value="">Unassigned</option>
                              {CONTACTS.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                          </div>
                          {/* Contact not yet set — show tap prompt */}
                          {hasContact&&!resolvedContact&&(
                            <div onClick={()=>setPopup({cat,text,role:contactRole||linkedContact})}
                              style={{padding:"5px 16px 9px 46px",fontSize:12,color:T.blue,cursor:"pointer"}}>
                              + Tap to assign {contactRole||linkedContact} →
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              ))}

              {/* Custom tasks */}
              <Card>
                <GHeader label="Custom Tasks"/>
                <div style={{padding:"4px 16px 16px",display:"flex",flexDirection:"column",gap:8}}>
                  {tasks.filter(t=>!checklist.some(c=>c.tasks.includes(t.text))).map(task=>{
                    const sc=TASK_STATUS_COLORS[task.status]||TASK_STATUS_COLORS["Not Started"];
                    return(
                      <div key={task.id} style={{display:"flex",alignItems:"center",gap:10,background:T.bg,borderRadius:T.radiusSm,padding:"10px 12px"}}>
                        <select value={task.status} onChange={e=>onUpdate(property.id,"tasks",tasks.map(t=>t.id===task.id?{...t,status:e.target.value}:t))}
                          style={{background:sc.bg,color:sc.color,border:"none",borderRadius:20,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",outline:"none",flexShrink:0}}>
                          {TASK_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
                        </select>
                        <input style={{flex:1,background:"transparent",border:"none",outline:"none",fontSize:13,color:task.status==="Completed"?T.textTert:T.text,textDecoration:task.status==="Completed"?"line-through":"none",fontFamily:"inherit"}} value={task.text} onChange={e=>onUpdate(property.id,"tasks",tasks.map(t=>t.id===task.id?{...t,text:e.target.value}:t))} placeholder="Task description…"/>
                        <select value={task.assignee||""} onChange={e=>onUpdate(property.id,"tasks",tasks.map(t=>t.id===task.id?{...t,assignee:e.target.value}:t))}
                          style={{fontSize:12,color:T.textSub,background:"transparent",border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 7px",cursor:"pointer",fontFamily:"inherit",outline:"none",flexShrink:0}}>
                          <option value="">Unassigned</option>
                          {CONTACTS.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                        <button onClick={()=>onUpdate(property.id,"tasks",tasks.filter(t=>t.id!==task.id))} style={{background:"none",border:"none",color:T.red,cursor:"pointer",fontSize:18,flexShrink:0,lineHeight:1}}>×</button>
                      </div>
                    );
                  })}
                  <button onClick={addTask} style={{marginTop:4,padding:"10px",borderRadius:T.radiusSm,background:"transparent",border:`1.5px dashed ${T.border}`,color:T.blue,cursor:"pointer",fontSize:14,fontFamily:"inherit",fontWeight:500}}>+ Add Custom Task</button>
                </div>
              </Card>
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
      </div>
    </div>
  );
}

// ─── Sort Modal ───────────────────────────────────────────────────────────────
function SortModal({order,onSave,onClose}){
  const[loc,setLoc]=useState([...order]);
  const[drag,setDrag]=useState(null);
  const[over,setOver]=useState(null);
  const end=()=>{
    if(drag!==null&&over!==null&&drag!==over){const next=[...loc];const[m]=next.splice(drag,1);next.splice(over,0,m);setLoc(next);}
    setDrag(null);setOver(null);
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,backdropFilter:"blur(4px)"}}>
      <div style={{background:T.card,borderRadius:20,padding:28,width:380,boxShadow:T.shadowMd}}>
        <div style={{fontWeight:700,fontSize:18,marginBottom:6,color:T.text}}>Sort by Status</div>
        <div style={{fontSize:13,color:T.textSub,marginBottom:20}}>Drag to set the order properties appear.</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {loc.map((status,i)=>{
            const s=SC[status]||{color:"#64748B",bg:"#F1F5F9"};
            return(
              <div key={status} draggable onDragStart={()=>setDrag(i)} onDragEnter={()=>setOver(i)} onDragEnd={end} onDragOver={e=>e.preventDefault()}
                style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:T.radiusSm,background:over===i?"#EBF4FF":T.bg,border:`1.5px solid ${over===i?T.blue:T.border}`,cursor:"grab",opacity:drag===i?0.4:1,transition:"all 0.1s"}}>
                <span style={{color:T.textTert,fontSize:16,userSelect:"none"}}>⠿</span>
                <span style={{flex:1,fontSize:13,fontWeight:600,color:T.text}}>{status}</span>
                <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:s.bg,color:s.color}}>{status}</span>
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:10,marginTop:24,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"10px 20px",borderRadius:T.radiusSm,background:T.bg,border:"none",color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Cancel</button>
          <button onClick={()=>{onSave(loc);onClose();}} style={{padding:"10px 22px",borderRadius:T.radiusSm,background:T.gold,border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",fontSize:14}}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// ─── Properties Page ──────────────────────────────────────────────────────────
function PropertiesPage({sharedProps,setSharedProps,initialSelId,onNavConsumed}){
  const props=sharedProps;
  const setProps=setSharedProps;
  const isMobile=useIsMobile();
  const[selId,setSelId]=useState(initialSelId||null);
  useEffect(()=>{if(initialSelId){setSelId(initialSelId);onNavConsumed&&onNavConsumed();}},[initialSelId]);
  const[search,setSearch]=useState("");
  const[sortOrder,setSortOrder]=useState(DEFAULT_ORDER);
  const[showSort,setShowSort]=useState(false);
  const[showAdd,setShowAdd]=useState(false);
  const[form,setForm]=useState({addr:"",city:"",state:"NJ",zip:"",status:"Under Contract"});
  const sel=props.find(p=>p.id===selId);
  const upProp=(id,key,val)=>setProps(prev=>prev.map(p=>p.id===id?{...p,[key]:val}:p));
  const sorted=useMemo(()=>{
    const q=search.toLowerCase();
    return [...props].filter(p=>(p.address+" "+p.city).toLowerCase().includes(q)).sort((a,b)=>{
      const ai=sortOrder.indexOf(a.status),bi=sortOrder.indexOf(b.status);
      return(ai===-1?999:ai)!==(bi===-1?999:bi)?(ai===-1?999:ai)-(bi===-1?999:bi):a.address.localeCompare(b.address);
    });
  },[props,search,sortOrder]);
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
            <div><div style={{fontWeight:700,fontSize:15,color:T.text}}>Properties</div><div style={{fontSize:11,color:T.textSub,marginTop:1}}>{props.length} total</div></div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setShowSort(true)} style={{width:32,height:32,borderRadius:8,background:T.bg,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.textSub}}>{ICONS.sort}</button>
              <button onClick={()=>setShowAdd(true)} style={{width:32,height:32,borderRadius:8,background:T.gold,border:"none",cursor:"pointer",color:"#fff",fontWeight:700,fontSize:20,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            </div>
          </div>
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:9,top:"50%",transform:"translateY(-50%)",color:T.textTert,fontSize:15,pointerEvents:"none"}}>⌕</span>
            <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} style={{...iS,paddingLeft:28,fontSize:13,padding:"7px 10px 7px 28px"}}/>
          </div>
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
        {sel?<PropDetail property={sel} onUpdate={upProp}/>:
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:T.bg,gap:14}}>
            <div style={{width:64,height:64,borderRadius:18,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🏠</div>
            <div style={{fontSize:16,fontWeight:600,color:T.textSub}}>Select a property</div>
            <div style={{fontSize:13,color:T.textTert}}>Choose from the list on the left to view details</div>
          </div>}
      </div>
      {showSort&&<SortModal order={sortOrder} onSave={setSortOrder} onClose={()=>setShowSort(false)}/>}
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
              <div><div style={{fontSize:12,color:T.textSub,marginBottom:5,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Status</div><select style={iS} value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{Object.keys(SC).map(s=><option key={s}>{s}</option>)}</select></div>
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
  const props=sharedProps.filter(p=>ACTIVE_STATUSES.includes(p.status));

  // Calculate net profit per property using same formula as FinOverview
  function pfCalcProfit(p){
    const f=p.financials;
    const nn=v=>parseFloat(String(v||0).replace(/[^\d.-]/g,""))||0;

    // If "Use Actual in Overview" is toggled on and actual data exists, use that
    if(f.useActualProfit&&nn(f.actualSalePrice)>0){
      const acSP=nn(f.actualSalePrice);
      const acCosts=nn(f.actualPurchasePrice||f.purchasePrice)+nn(f.actualBuyingCosts||f.buyingCosts)+nn(f.actualRehabCosts||f.rehabCosts);
      const acHolding=(f.actualHoldingCostItems||f.holdingCostItems||[]).length>0
        ?(f.actualHoldingCostItems||f.holdingCostItems).reduce((s,i)=>{
            const months=f.purchaseDate&&f.sellingDate?parseFloat(((new Date(f.sellingDate)-new Date(f.purchaseDate))/(1000*60*60*24*30.44)).toFixed(1)):nn(f.holdPeriod);
            return s+(i.perYear?nn(i.amount)/12:nn(i.amount))*months;
          },0)
        :nn(f.actualHoldingCosts);
      const acItems=f.actualSellingCostItems||f.sellingCostItems||[];
      const acSelling=acItems.filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>{
        if(i.autoType==="commission")return s+Math.round(acSP*(parseFloat(i.commissionPct||0)/100));
        if(i.autoType==="tax"){const rtf=calcNJRTF(acSP);return i.resp==="Seller Pays"?s+rtf.total:i.resp==="Split"?s+Math.round(rtf.total/2):s;}
        return s+nn(i.amount);
      },0)||nn(f.actualSellingCosts);
      const acDebt=nn(f.hmInterest)+nn(f.locInterest);
      return acSP-acSelling-acDebt-(acCosts+acHolding);
    }
    const sp=nn(f.salePrice);
    const months=nn(f.holdPeriod)||0;
    const buying=calcBuyingTotal(f.buyingCostItems||[],f.purchasePrice)||nn(f.buyingCosts);
    const holding=(f.holdingCostItems||[]).length>0
      ?(f.holdingCostItems).reduce((s,i)=>s+(i.perYear?nn(i.amount)/12:nn(i.amount))*months,0)
      :nn(f.annualHoldingCosts);
    const totalCosts=nn(f.purchasePrice)+buying+nn(f.rehabCosts)+holding;
    const selling=(f.sellingCostItems||[]).filter(i=>i.resp!=="N/A"&&i.resp!=="Maybe").reduce((s,i)=>{
      if(i.autoType==="commission")return s+Math.round(sp*(parseFloat(i.commissionPct||0)/100));
      if(i.autoType==="tax"){const rtf=calcNJRTF(sp);return i.resp==="Seller Pays"?s+rtf.total:i.resp==="Split"?s+Math.round(rtf.total/2):s;}
      return s+nn(i.amount);
    },0)||nn(f.sellingCosts);
    // Debt service — live calc from params, fallback to saved values
    const hmLoan=Math.round(nn(f.purchasePrice)*(nn(f.hmLoanPct||90)/100));
    const hmMonthly=Math.round(hmLoan*(nn(f.hmRate||9)/100)/12);
    const hmReserve=Math.round(hmMonthly*months);
    const downPmt=Math.round(nn(f.purchasePrice)*(1-nn(f.hmLoanPct||90)/100));
    const rehabGap=Math.round(nn(f.rehabCosts)*(1-nn(f.rehabFinPct||100)/100));
    const hmRehabLoan=Math.round(nn(f.rehabCosts)*(nn(f.rehabFinPct||100)/100));
    const hmOrigFee=Math.round((hmLoan+hmRehabLoan)*(nn(f.hmOrigPct||0)/100));
    const hmDoc=nn(f.hmDocFee||1000);
    const gapPrinc=downPmt+rehabGap+buying+hmReserve+hmOrigFee+hmDoc;
    const gapBalloon=Math.round(gapPrinc*(nn(f.gapRate||15)/100)/12*months);
    const debt=(nn(f.hmInterest)||hmReserve)+(nn(f.locInterest)||gapBalloon);
    return sp-selling-debt-totalCosts;
  }
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
    if(sortKey==="profit")return calcProfit(b)-calcProfit(a);
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
                    <span style={{background:sc.badge,color:"#fff",fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:20,textTransform:"uppercase",letterSpacing:"0.06em"}}>{st}</span>
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
          <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.4)",zIndex:50,display:"flex",alignItems:"flex-start",justifyContent:"center",paddingTop:80}} onClick={()=>setListPopup(null)}>
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
                  <div onClick={()=>onNavigate&&onNavigate(p.id)} style={{fontSize:14,fontWeight:600,color:T.blue,marginBottom:9,cursor:"pointer"}}>{addr}</div>
                  <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                    <StatusPicker value={p.status} size="sm" onChange={v=>setSharedProps(prev=>prev.map(x=>x.id===p.id?{...x,status:v}:x))}/>
                    <span style={{fontSize:14,fontWeight:700,color:equity>0?T.gold:T.textTert}}>{equity>0?fmtD(equity):"—"}</span>
                    <span style={{fontSize:14,fontWeight:800,color:profit>0?T.green:profit<0?T.red:T.textTert}}>{profit!==0?fmtD(profit):"—"}</span>
                    {p.financials.useActualProfit&&<span style={{fontSize:9,fontWeight:700,background:T.green,color:"#fff",borderRadius:10,padding:"2px 8px",textTransform:"uppercase"}}>actual</span>}
                    <label style={{display:"flex",alignItems:"center",gap:6,marginLeft:"auto",fontSize:12,fontWeight:600,color:funded?T.gold:T.textSub,cursor:autoFunded?"default":"pointer"}}>
                      <input type="checkbox" checked={funded} disabled={autoFunded}
                        onChange={e=>setSharedProps(prev=>prev.map(x=>x.id===p.id?{...x,hasFunder:e.target.checked}:x))}
                        style={{width:20,height:20,accentColor:T.gold,cursor:autoFunded?"default":"pointer",opacity:autoFunded?0.6:1}}/>
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

// ─── Task Row (module level to avoid React #31) ───────────────────────────────
function TaskRow({t,onStatusChange,onDelete,onContact}){
  const sc=TASK_STATUS_COLORS[t.status]||TASK_STATUS_COLORS["Not Started"];
  const sc2=SC[t.propStatus]||{};
  return(
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"12px 18px",borderTop:`1px solid ${T.border}`,background:"#fff"}}
      onMouseEnter={e=>e.currentTarget.style.background="#FAFAFA"} onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
      <select value={t.status} onChange={e=>onStatusChange(t.propId,t.cat,t.text,e.target.value)}
        style={{background:sc.bg,color:sc.color,border:"none",borderRadius:20,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",outline:"none",flexShrink:0}}>
        {TASK_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
      </select>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,color:t.status==="Completed"||t.status==="N/A"?T.textTert:T.text,textDecoration:t.status==="Completed"?"line-through":"none",fontWeight:500}}>{t.text}</div>
        <div style={{fontSize:11,color:T.textSub,marginTop:2}}>{t.propAddr} · {t.cat}</div>
      </div>
      {t.assignee&&<span style={{fontSize:11,fontWeight:600,color:T.blue,background:"#EBF4FF",padding:"3px 9px",borderRadius:20,flexShrink:0}}>{t.assignee}</span>}
      <span style={{fontSize:10,fontWeight:700,color:sc2.color,background:sc2.bg,padding:"2px 8px",borderRadius:20,flexShrink:0}}>{t.propStatus}</span>
      {/* Contact icon — shows filled avatar if contact set */}
      <button onClick={()=>onContact(t)} title={t.taskContact?`Contact: ${t.taskContact.name}`:"Add contact"}
        style={{background:t.taskContact?"#EBF4FF":"none",border:t.taskContact?`1px solid ${T.blue}`:`1px solid ${T.border}`,borderRadius:"50%",width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:13,flexShrink:0,color:t.taskContact?T.blue:T.textTert}}
        onMouseEnter={e=>{e.currentTarget.style.borderColor=T.blue;e.currentTarget.style.color=T.blue;}}
        onMouseLeave={e=>{if(!t.taskContact){e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.textTert;}}}>
        {t.taskContact?t.taskContact.name[0]:"👤"}
      </button>
      <button onClick={()=>onDelete(t.propId,t.cat,t.text)} style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:16,lineHeight:1,padding:"2px 4px",flexShrink:0,borderRadius:6}}
        onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textTert}>🗑</button>
    </div>
  );
}

// ─── Tasks Page ───────────────────────────────────────────────────────────────
// TEAM_MEMBERS and CURRENT_USER now come from useData() (real Supabase auth + users table).

function TasksPage(){
  const { sharedProps, setSharedProps, contacts: CONTACTS, teamMembers: TEAM_MEMBERS, currentUser: CURRENT_USER, automations, setAutomations } = useData();
  const { isAdmin } = useAuth();
  const isMobile=useIsMobile();
  const[views,setViews]=useState(new Set(["my"]));
  const[filterMember,setFilterMember]=useState("");
  useEffect(()=>{ if(!filterMember && TEAM_MEMBERS.length) setFilterMember(TEAM_MEMBERS[0]); },[TEAM_MEMBERS,filterMember]);
  const[confirmDeleteProp,setConfirmDeleteProp]=useState(null);
  const[filterProp,setFilterProp]=useState("");
  const[taskContactTarget,setTaskContactTarget]=useState(null);
  const[contactSearch,setContactSearch]=useState(""); // the task we're setting a contact for

  function setTaskContact(propId,cat,text,contact){
    setSharedProps(prev=>prev.map(p=>{
      if(p.id!==propId) return p;
      const tasks=p.tasks||[];
      const existing=tasks.find(t=>t.cat===cat&&t.text===text);
      if(existing) return{...p,tasks:tasks.map(t=>t.cat===cat&&t.text===text?{...t,taskContact:contact}:t)};
      return{...p,tasks:[...tasks,{id:Date.now(),cat,text,status:"Not Started",assignee:"",taskContact:contact}]};
    }));
  }
  const[statusFilter,setStatusFilter]=useState(new Set()); // empty = show all
  const[showAutoBuilder,setShowAutoBuilder]=useState(false);

  // Collect all tasks from all properties
  const allTasks=[];
  sharedProps.forEach(prop=>{
    const savedTasks=prop.tasks||[];
    const deletedKeys=new Set(savedTasks.filter(t=>t.deleted).map(t=>`${t.cat}::${t.text}`));
    const checklist=DEFAULT_CHECKLISTS[prop.status]||[];
    checklist.forEach(({cat,tasks:catTasks})=>{
      catTasks.forEach(rawTask=>{
        const text=typeof rawTask==="string"?rawTask:rawTask.text;
        if(deletedKeys.has(`${cat}::${text}`)) return; // skip deleted
        const saved_t=savedTasks.find(t=>t.cat===cat&&t.text===text&&!t.deleted)||{status:"Not Started",assignee:"",contactVal:""};
        allTasks.push({propId:prop.id,propAddr:prop.address+(prop.city?`, ${prop.city}`:""),propStatus:prop.status,cat,text,...saved_t,isChecklist:true});
      });
    });
    // Custom tasks (not deleted, not from checklist)
    savedTasks.filter(t=>!t.deleted&&!checklist.some(c=>c.tasks.some(rt=>(typeof rt==="string"?rt:rt.text)===t.text))).forEach(t=>{
      allTasks.push({propId:prop.id,propAddr:prop.address+(prop.city?`, ${prop.city}`:""),propStatus:prop.status,...t,isChecklist:false});
    });
  });

  function updateTaskStatus(propId,cat,text,status){
    setSharedProps(prev=>prev.map(p=>{
      if(p.id!==propId) return p;
      const tasks=p.tasks||[];
      const existing=tasks.find(t=>t.cat===cat&&t.text===text&&!t.deleted);
      if(existing) return{...p,tasks:tasks.map(t=>t.cat===cat&&t.text===text?{...t,status}:t)};
      return{...p,tasks:[...tasks,{id:Date.now(),cat,text,status,assignee:"",contactVal:""}]};
    }));
  }

  function deleteTask(propId,cat,text,isChecklist){
    setSharedProps(prev=>prev.map(p=>{
      if(p.id!==propId) return p;
      const tasks=p.tasks||[];
      if(isChecklist){
        // Checklist tasks: mark deleted so they don't reappear
        const existing=tasks.find(t=>t.cat===cat&&t.text===text);
        if(existing) return{...p,tasks:tasks.map(t=>t.cat===cat&&t.text===text?{...t,deleted:true}:t)};
        return{...p,tasks:[...tasks,{id:Date.now(),cat,text,status:"Not Started",assignee:"",contactVal:"",deleted:true}]};
      }
      // Custom tasks: fully remove
      return{...p,tasks:tasks.filter(t=>!(t.cat===cat&&t.text===text))};
    }));
  }

  const myTasks=allTasks.filter(t=>t.assignee===CURRENT_USER);
  const assignedByMe=allTasks.filter(t=>t.assignee&&t.assignee!==CURRENT_USER);
  const memberTasks=allTasks.filter(t=>t.assignee===filterMember);
  const unassignedTasks=allTasks.filter(t=>!t.assignee);

  const baseViews=["my","assigned","member","unassigned","all"].filter(v=>views.has(v));
  const combined=baseViews.length===0||views.has("all")?allTasks
    :[...new Map(baseViews.flatMap(v=>v==="my"?myTasks:v==="assigned"?assignedByMe:v==="member"?memberTasks:v==="unassigned"?unassignedTasks:[])
        .map(t=>[`${t.propId}-${t.cat}-${t.text}`,t])).values()];
  const displayTasks=combined.filter(t=>statusFilter.size===0||statusFilter.has(t.status));
  const filteredDisplay=filterProp?displayTasks.filter(t=>t.propAddr===filterProp):displayTasks;
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
      {/* Task contact popup */}
      {taskContactTarget&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,backdropFilter:"blur(6px)"}}>
          <div style={{background:"#fff",borderRadius:20,width:"min(380px,92vw)",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",overflow:"hidden"}}>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:T.goldLight}}>
              <div style={{fontSize:13,fontWeight:700,color:T.gold}}>Task Contact</div>
              <button onClick={()=>{setTaskContactTarget(null);setContactSearch("");}} style={{background:"none",border:"none",fontSize:20,color:T.textTert,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{padding:"10px 16px 8px",fontSize:11,color:T.textSub,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>Task: {taskContactTarget.text}</div>
            {/* Search */}
            <div style={{padding:"0 16px 10px"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,background:T.bg,borderRadius:10,padding:"8px 12px",border:`1px solid ${T.border}`}}>
                <span style={{fontSize:14,color:T.textSub,flexShrink:0}}>🔍</span>
                <input autoFocus value={contactSearch} onChange={e=>setContactSearch(e.target.value)}
                  placeholder="Search contacts…"
                  style={{flex:1,background:"transparent",border:"none",outline:"none",fontSize:13,color:T.text,fontFamily:"inherit"}}/>
                {contactSearch&&<button onClick={()=>setContactSearch("")} style={{background:"none",border:"none",color:T.textTert,cursor:"pointer",fontSize:14,lineHeight:1,padding:0}}>×</button>}
              </div>
            </div>
            <div style={{maxHeight:240,overflowY:"auto"}}>
              {CONTACTS.filter(c=>c.name.toLowerCase().includes(contactSearch.toLowerCase())||c.role.toLowerCase().includes(contactSearch.toLowerCase())).map(c=>{
                const isSet=taskContactTarget.taskContact?.name===c.name;
                return(
                  <div key={c.id} onClick={()=>{setTaskContact(taskContactTarget.propId,taskContactTarget.cat,taskContactTarget.text,isSet?null:c);setTaskContactTarget(null);setContactSearch("");}}
                    style={{display:"flex",alignItems:"center",gap:12,padding:"10px 16px",cursor:"pointer",background:isSet?T.goldLight:"transparent",borderTop:`1px solid ${T.border}`}}
                    onMouseEnter={e=>e.currentTarget.style.background=isSet?T.goldLight:"#FAFAFA"} onMouseLeave={e=>e.currentTarget.style.background=isSet?T.goldLight:"transparent"}>
                    <div style={{width:36,height:36,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,color:"#fff",flexShrink:0}}>{c.name[0]}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:13,fontWeight:600,color:T.text}}>{c.name}</div>
                      <div style={{fontSize:11,color:T.textSub}}>{c.role} · {c.phone}</div>
                    </div>
                    {isSet&&<span style={{fontSize:11,color:T.gold,fontWeight:700}}>✓</span>}
                  </div>
                );
              })}
              {CONTACTS.filter(c=>c.name.toLowerCase().includes(contactSearch.toLowerCase())||c.role.toLowerCase().includes(contactSearch.toLowerCase())).length===0&&(
                <div style={{padding:"20px 16px",textAlign:"center",color:T.textTert,fontSize:13}}>No contacts match "{contactSearch}"</div>
              )}
            </div>
            {taskContactTarget.taskContact&&(
              <div style={{padding:"10px 16px",borderTop:`1px solid ${T.border}`}}>
                <button onClick={()=>{setTaskContact(taskContactTarget.propId,taskContactTarget.cat,taskContactTarget.text,null);setTaskContactTarget(null);setContactSearch("");}}
                  style={{width:"100%",padding:"8px",borderRadius:T.radiusSm,background:"#FFF0EF",border:`1px solid ${T.red}`,color:T.red,fontWeight:600,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  Remove Contact
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {/* Header */}
      <div style={{background:T.card,borderBottom:bdr,padding:isMobile?"14px 14px":"18px 28px",flexShrink:0}}>
        <div style={{fontSize:isMobile?19:22,fontWeight:700,color:T.text,marginBottom:14}}>Tasks</div>
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
          {[["my","My Tasks"],["assigned","Assigned by Me"],["member","By Team Member"],["unassigned","Unassigned"],["all","All Tasks"],...(isAdmin?[["automations","⚙ Automations"]]:[])].map(([k,l])=>{
            const active=views.has(k);
            return(
              <button key={k} onClick={()=>setViews(prev=>{const n=new Set(prev);active?n.delete(k):n.add(k);return n;})}
                style={{padding:"7px 16px",borderRadius:20,border:`1.5px solid ${active?T.gold:T.border}`,background:active?T.goldLight:"transparent",color:active?T.gold:T.textSub,fontWeight:active?700:400,fontSize:13,cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",gap:5}}>
                {active&&<span style={{fontSize:10}}>✓</span>}{l}{k==="my"&&myTasks.length>0?` (${myTasks.length})`:k==="unassigned"?` (${unassignedTasks.length})`:""}
              </button>
            );
          })}
        </div>
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
            {/* Filter bar */}
            <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
              {views.has("member")&&(
                <select value={filterMember} onChange={e=>setFilterMember(e.target.value)}
                  style={{padding:"7px 12px",borderRadius:T.radiusSm,border:bdr,background:T.card,color:T.text,fontSize:13,outline:"none",fontFamily:"inherit"}}>
                  {TEAM_MEMBERS.map(m=><option key={m}>{m}</option>)}
                </select>
              )}
              {/* Property filter */}
              <select value={filterProp} onChange={e=>setFilterProp(e.target.value)}
                style={{padding:"7px 12px",borderRadius:T.radiusSm,border:bdr,background:T.card,color:T.text,fontSize:13,outline:"none",fontFamily:"inherit",maxWidth:220}}>
                <option value="">All Properties</option>
                {[...new Set(allTasks.map(t=>t.propAddr))].sort().map(a=><option key={a} value={a}>{a}</option>)}
              </select>
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
            </div>

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
                <div style={{padding:"11px 18px",background:"#FAFAFA",borderBottom:bdr,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:13,fontWeight:700,color:T.text}}>{addr}</span>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,color:T.textSub}}>{ptasks.filter(t=>t.status==="Completed").length}/{ptasks.length} done</span>
                    {(()=>{const sc=SC[ptasks[0]?.propStatus]||{};return <span style={{fontSize:10,fontWeight:700,color:sc.color,background:sc.bg,padding:"2px 8px",borderRadius:20}}>{ptasks[0]?.propStatus}</span>;})()}
                    {confirmDeleteProp===addr
                      ?<div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:12,color:T.red}}>Delete all {ptasks.length}?</span>
                          <button onClick={()=>{ptasks.forEach(t=>deleteTask(t.propId,t.cat,t.text,t.isChecklist));setConfirmDeleteProp(null);}}
                            style={{padding:"3px 10px",borderRadius:6,background:T.red,border:"none",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Yes</button>
                          <button onClick={()=>setConfirmDeleteProp(null)}
                            style={{padding:"3px 10px",borderRadius:6,background:T.bg,border:`1px solid ${T.border}`,color:T.textSub,fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>No</button>
                        </div>
                      :<button onClick={()=>setConfirmDeleteProp(addr)}
                          style={{background:"none",border:`1px solid ${T.border}`,color:T.textTert,cursor:"pointer",fontSize:12,fontFamily:"inherit",padding:"2px 8px",borderRadius:6}}
                          onMouseEnter={e=>{e.currentTarget.style.color=T.red;e.currentTarget.style.borderColor=T.red;}}
                          onMouseLeave={e=>{e.currentTarget.style.color=T.textTert;e.currentTarget.style.borderColor=T.border;}}>
                          🗑 Delete All
                        </button>}
                  </div>
                </div>
                {ptasks.map(t=><TaskRow key={`${t.cat}-${t.text}`} t={t} onStatusChange={updateTaskStatus} onDelete={(pid,cat,text)=>deleteTask(pid,cat,text,t.isChecklist)} onContact={setTaskContactTarget}/>)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ComingSoon({label}){
  return <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,background:T.bg}}><div style={{width:64,height:64,borderRadius:18,background:T.goldLight,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28}}>🚧</div><div style={{fontSize:17,fontWeight:600,color:T.text}}>{label}</div><div style={{fontSize:14,color:T.textSub}}>Coming soon</div></div>;
}

// ─── App Shell ────────────────────────────────────────────────────────────────
// Members only see Tasks + Properties; admins see the full nav.
const MEMBER_KEYS = new Set(["tasks","properties"]);

export function GoldstoneShell(){
  const { sharedProps, setSharedProps, loading, saveError, clearSaveError } = useData();
  const { displayName, role, isAdmin, signOut } = useAuth();
  const isMobile = useIsMobile();

  const navItems = isAdmin ? NAV : NAV.filter(n=>MEMBER_KEYS.has(n.key));
  const[active,setActive]=useState(isAdmin?"properties":"tasks");
  const[navPropId,setNavPropId]=useState(null);
  useEffect(()=>{ if(!navItems.find(n=>n.key===active)) setActive(navItems[0]?.key||"tasks"); },[navItems,active]);

  function navigateToProperty(propId){
    setNavPropId(propId);
    setActive("properties");
  }

  const initials=(displayName||"?").trim().charAt(0).toUpperCase()||"?";
  const pageEl = active==="properties"
    ? <PropertiesPage sharedProps={sharedProps} setSharedProps={setSharedProps} initialSelId={navPropId} onNavConsumed={()=>setNavPropId(null)}/>
    : active==="leads" ? <NewLeadsPage/>
    : active==="portfolio" ? <PortfolioPage sharedProps={sharedProps} setSharedProps={setSharedProps} onNavigate={navigateToProperty}/>
    : active==="tasks" ? <TasksPage/>
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
        <nav style={{flex:1,padding:"12px 10px"}}>
          {navItems.map(({key,label,icon})=>{const isActive=active===key;return <button key={key} onClick={()=>setActive(key)} style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"10px 12px",borderRadius:T.radiusSm,border:"none",background:isActive?T.goldLight:"transparent",color:isActive?T.gold:T.textSub,fontWeight:isActive?600:400,fontSize:14,cursor:"pointer",marginBottom:2,transition:"all 0.15s",textAlign:"left",fontFamily:"inherit"}}><span style={{color:isActive?T.gold:T.textTert}}>{icon}</span>{label}</button>;})}
        </nav>
        <div style={{padding:"14px 16px",borderTop:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:"50%",background:`linear-gradient(135deg,${T.gold},${T.goldMid})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff",flexShrink:0}}>{initials}</div>
          <div style={{flex:1,minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{displayName}</div><div style={{fontSize:11,color:T.textSub,textTransform:"capitalize"}}>{role}</div></div>
          <button onClick={signOut} title="Sign out" style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:12,padding:"6px 10px"}}>Sign out</button>
        </div>
      </aside>
      <main style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        <div style={{minHeight:54,padding:isMobile?"max(8px,env(safe-area-inset-top)) 16px 8px":"0 24px",borderBottom:`1px solid ${T.border}`,background:T.card,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {isMobile&&<div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${T.goldMid},${T.gold})`,display:"flex",alignItems:"center",justifyContent:"center",color:T.goldLight,fontFamily:"Georgia,serif",fontWeight:700,fontSize:18}}>G</div>}
            <div style={{fontWeight:700,fontSize:17,color:T.text}}>{NAV.find(n=>n.key===active)?.label}</div>
          </div>
          {isMobile
            ? <button onClick={signOut} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textSub,cursor:"pointer",fontFamily:"inherit",fontSize:12,padding:"6px 10px"}}>Sign out</button>
            : <div style={{fontSize:13,color:T.textSub}}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>}
        </div>
        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          {pageEl}
        </div>
      </main>
      {isMobile&&(
        <nav className="gs-tabbar" style={{display:"flex",background:T.card,borderTop:`1px solid ${T.border}`,flexShrink:0,paddingTop:4}}>
          {navItems.map(({key,label,short,icon})=>{const isActive=active===key;return(
            <button key={key} onClick={()=>setActive(key)} style={{flex:1,minWidth:0,minHeight:52,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,border:"none",background:"transparent",color:isActive?T.gold:T.textTert,cursor:"pointer",fontFamily:"inherit",padding:"4px 2px",overflow:"hidden"}}>
              <span style={{color:isActive?T.gold:T.textTert}}>{icon}</span>
              <span style={{fontSize:10,fontWeight:isActive?700:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%"}}>{short||label}</span>
            </button>);})}
        </nav>
      )}
    </div>
  );
}
