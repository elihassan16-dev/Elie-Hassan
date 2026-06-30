// ─── Seed data ────────────────────────────────────────────────────────────────
// Extracted verbatim from the original goldstone.jsx. Used (a) by the app where
// it still needs mkLead, and (b) by the DataProvider to one-time-seed Supabase
// the first time an admin opens the app against empty tables.

// Compact property data: [id,addr,city,zip,status,pp,rehab,hp,fs,sp,txResp,lb,notes,app,abc,arc,li,hi,asp]
export const PR = [
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

export function parseProps(raw) {
  return raw.map((r) => {
    const [id, address, city, zip, status, pp, rehab, hp, fs, sp, txResp, lbCode, notes, app, abc, arc, li, hi, asp] = r;
    const purchasePrice = String(pp || "");
    const salePrice = String(sp || "");
    const holdPeriod = String(hp || "");
    const transferTaxResp = txResp || "Seller Pays";
    const buyingCostItems = [
      { id: 1, title: "Title Cost", autoType: "title", auto: true, resp: "Buyer Pays" },
      { id: 2, title: "Transfer Tax", autoType: "tax", auto: true, resp: transferTaxResp },
      { id: 3, title: "Miscellaneous", autoType: null, auto: false, resp: "Buyer Pays", amount: "1000" },
    ];
    const sellingCostItems = [
      { id: 1, title: "Commission", autoType: "commission", auto: true, resp: "Seller Pays", commissionPct: "2" },
      { id: 2, title: "Transfer Tax", autoType: "tax", auto: true, resp: "Seller Pays" },
      { id: 3, title: "Miscellaneous", autoType: null, auto: false, resp: "Seller Pays", amount: "2000" },
    ];
    const holdingCostItems = [
      { id: 1, title: "Property Taxes", amount: "", perYear: true, auto: false },
      { id: 2, title: "Insurance", amount: "", perYear: true, auto: false },
      { id: 3, title: "Utilities", amount: "150", perMonth: true, auto: true },
      { id: 4, title: "Miscellaneous", amount: "200", perMonth: true, auto: false },
    ];
    return {
      id, address, city, state: "NJ", zip, status,
      financials: {
        purchasePrice, rehabCosts: String(rehab || ""), holdPeriod, fundingSource: fs, salePrice,
        transferTaxResp,
        buyingCosts: "", buyingTransferTax: "", sellingCosts: "", sellingTransferTax: "", annualHoldingCosts: "",
        actualPurchasePrice: String(app || ""), actualBuyingCosts: String(abc || ""), actualRehabCosts: String(arc || ""),
        purchaseDate: "", sellingDate: "",
        locLoan: "", locInterest: String(li || ""), hmLoan: "", hmInterest: String(hi || ""),
        actualSalePrice: String(asp || ""), actualSellingCosts: "", actualSellingTransferTax: "",
        buyingCostItems, sellingCostItems, holdingCostItems,
      },
      propertyInfo: { type: "", beds: "", baths: "", sqft: "", yearBuilt: "", lot: "", parcel: "", lockboxCode: String(lbCode || ""), lockboxLocation: "", notes: String(notes || "") },
      tasks: [], contacts: [],
    };
  });
}

export const INIT_PROPS = parseProps(PR);

export const DEFAULT_CONTACTS = [
  { id: 1, name: "Mike Torres", role: "Contractor", phone: "404-555-0101", email: "mike@torres.com" },
  { id: 2, name: "Sarah Bloom", role: "Realtor", phone: "404-555-0192", email: "sarah@realty.com" },
  { id: 3, name: "James Whitfield", role: "Lender", phone: "404-555-0233", email: "james@lend.com" },
  { id: 4, name: "Priya Nair", role: "Attorney", phone: "404-555-0344", email: "priya@law.com" },
  { id: 5, name: "Tom Baxter", role: "Inspector", phone: "404-555-0455", email: "tom@inspect.com" },
];

export function mkLead(o = {}) {
  return {
    id: Date.now() + Math.random(), address: "", city: "", state: "NJ", zip: "", leadStatus: "New Leads",
    dateAdded: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), notes: "",
    tasks: [], contacts: [],
    info: { sellerName: "", sellerPhone: "", sellerEmail: "", source: "", askingPrice: "", closingTarget: "", type: "", beds: "", baths: "", sqft: "", yearBuilt: "", condition: "" },
    propertyInfo: { lockboxCode: "", dropboxLink: "", closingDateScheduled: "", mortgageCommitment: "", inspectionDue: "" },
    financials: {
      purchasePrice: "", buyingCosts: "", buyingTransferTax: "", transferTaxResp: "Seller Pays", rehabCosts: "", annualHoldingCosts: "", holdPeriod: "",
      salePrice: "", sellingCosts: "", sellingTransferTax: "",
      purchaseDate: "", sellingDate: "",
      locLoan: "", locInterest: "", hmLoan: "", hmInterest: "",
      hmLoanPct: "", rehabFinPct: "", hmRate: "", hmOrigPct: "", hmDocFee: "", gapRate: "",
      buyingCostItems: [
        { id: 1, title: "Title Cost", autoType: "title", auto: true, resp: "Buyer Pays" },
        { id: 2, title: "Transfer Tax", autoType: "tax", auto: true, resp: "Seller Pays" },
        { id: 3, title: "Miscellaneous", autoType: null, auto: false, resp: "Buyer Pays", amount: "1000" },
      ],
      sellingCostItems: [
        { id: 1, title: "Commission", autoType: "commission", auto: true, resp: "Seller Pays", commissionPct: "2" },
        { id: 2, title: "Transfer Tax", autoType: "tax", auto: true, resp: "Seller Pays" },
        { id: 3, title: "Miscellaneous", autoType: null, auto: false, resp: "Seller Pays", amount: "2000" },
      ],
      holdingCostItems: [
        { id: 1, title: "Property Taxes", amount: "", perYear: true, auto: false },
        { id: 2, title: "Insurance", amount: "", perYear: true, auto: false },
        { id: 3, title: "Utilities", amount: "150", perMonth: true, auto: true },
        { id: 4, title: "Miscellaneous", amount: "200", perMonth: true, auto: false },
      ],
    },
    ...o,
  };
}

export const INIT_LEADS = [
  mkLead({ id: 8001, address: "185 W Passaic Ave", city: "Bloomfield", state: "NJ", zip: "", dateAdded: "Jun 10, 2026",
    financials: { ...mkLead().financials, purchasePrice: "470000", buyingCosts: "3000", rehabCosts: "100000", annualHoldingCosts: "3000", holdPeriod: "6", salePrice: "750000", locLoan: "43200", hmLoan: "36355" } }),
  mkLead({ id: 8002, address: "116-120 Sycamore Ave", city: "Plainfield", state: "NJ", zip: "07060", dateAdded: "Jun 15, 2026" }),
  mkLead({ id: 8003, address: "21 Merion Pl", city: "Lawrence Township", state: "NJ", zip: "08648", dateAdded: "Jun 20, 2026",
    financials: { ...mkLead().financials, purchasePrice: "575000", buyingCosts: "4500", transferTaxResp: "Seller Pays", rehabCosts: "120000", annualHoldingCosts: "12000", holdPeriod: "6", salePrice: "900000", locLoan: "53363", hmLoan: "44800" } }),
];
