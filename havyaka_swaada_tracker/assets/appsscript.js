/**
 * ╔══════════════════════════════════════════════════════╗
 * ║   Havyaka Swaada Stall Tracker — Google Apps Script  ║
 * ║   Phase 3 + Performance Optimised                    ║
 * ║   Copy this entire file into the Apps Script editor  ║
 * ║   and deploy as a Web App (Anyone can access).       ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * AFTER DEPLOYING, set up the keepWarm trigger ONCE:
 *   Apps Script editor → Triggers (clock icon) → Add Trigger
 *   Function: keepWarm | Event source: Time-driven
 *   Type: Minutes timer | Every: 25 minutes
 *   This prevents the 5-10s cold-start delay.
 *
 * SHEET STRUCTURE:
 *   "Melas"     — master list of all melas
 *   "MenuItems" — global item registry
 *   "MelaMenu"  — per-mela item config
 *   "mela_{id}" — purchases per mela (auto-created)
 */

/* ═══════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════ */
const MELAS_SHEET            = 'Melas';
const RAW_MATERIALS_SHEET    = 'RawMaterials';
const RAW_PURCHASES_SHEET    = 'RawMaterialPurchases';

const RAW_MATERIALS_HEADERS  = ['RawMaterialId','Name','Unit','TotalQty','Status','CreatedAt'];
const RAW_PURCHASES_HEADERS  = ['PurchaseId','RawMaterialId','Qty','Cost','PurchasedAt','Note'];
const MENU_ITEMS_SHEET       = 'MenuItems';
const MELA_MENU_SHEET        = 'MelaMenu';
const CATEGORIES_SHEET       = 'Categories';
const EXPENSE_CATEGORIES_SHEET = 'ExpenseCategories';

const MELAS_HEADERS           = ['MelaId','MelaName','Area','OrganiserName','ContactPerson','ContactPhone','DateFrom','DateTo','Status','CreatedAt'];
const MENU_ITEMS_HEADERS      = ['ItemKey','ItemName','DefaultPrice','CreatedInMela','CreatedAt','Category'];
const MELA_MENU_HEADERS       = ['MelaId','ItemKey','SellingPrice','Status','SortOrder','AddedAt'];
const PURCHASES_HEADERS_NEW   = ['Timestamp','Date','CustomerName','Phone','CustomerType','SocialMedia','Items','TotalAmount','PaymentMode'];
const CATEGORIES_HEADERS      = ['CategoryName'];
const EXPENSE_CATEGORIES_HEADERS = ['CategoryName'];
const EXPENSE_HEADERS         = ['ExpenseId','Date','Category','Amount','Notes','CreatedAt'];

const DEFAULT_EXPENSE_CATEGORIES = ['Stall Rent','Ingredients','Labour','Transport','Packaging','Other'];

const OLD_COL_TO_KEY = {
  'NeerGojjuShot':'item_neerShot','NeerGojjuFull':'item_neerFull',
  'HunaseHannina':'item_hunase','HalfHunaseHannina':'item_halfHunase',
  'MandanGojju100':'item_mandan100','MandanGojju200':'item_mandan200',
  'MandanGojju500':'item_mandan500','MangoGula100':'item_mangoGula100',
  'MangoGula250':'item_mangoGula250',
};

// Default categories seeded on first run
const DEFAULT_CATEGORIES = ['Neer Gojju','Hunase','Mandan Gojju','Mango Gula'];

const DEFAULT_ITEMS = [
  {key:'item_neerShot',    name:'Neer Gojju Shot',            price:40,  category:'Neer Gojju'  },
  {key:'item_neerFull',    name:'Neer Gojju Full',             price:70,  category:'Neer Gojju'  },
  {key:'item_hunase',      name:'Hunase Hannina Paanaka',      price:50,  category:'Hunase'       },
  {key:'item_halfHunase',  name:'Half Hunase Hannina Paanaka', price:30,  category:'Hunase'       },
  {key:'item_mandan100',   name:'Mandan Gojju 100g',           price:149, category:'Mandan Gojju'},
  {key:'item_mandan200',   name:'Mandan Gojju 200g',           price:249, category:'Mandan Gojju'},
  {key:'item_mandan500',   name:'Mandan Gojju 500g',           price:499, category:'Mandan Gojju'},
  {key:'item_mangoGula100',name:'Mango Gula 100g',             price:149, category:'Mango Gula'  },
  {key:'item_mangoGula250',name:'Mango Gula 250g',             price:249, category:'Mango Gula'  },
];

// Default categories per item key (for migrating existing sheets)
const DEFAULT_ITEM_CATEGORIES = {
  'item_neerShot':'Neer Gojju','item_neerFull':'Neer Gojju',
  'item_hunase':'Hunase','item_halfHunase':'Hunase',
  'item_mandan100':'Mandan Gojju','item_mandan200':'Mandan Gojju','item_mandan500':'Mandan Gojju',
  'item_mangoGula100':'Mango Gula','item_mangoGula250':'Mango Gula',
};

/* ═══════════════════════════════════════
   SERVER-SIDE CACHE (CacheService)
   Reduces sheet-read time on warm calls.
   Cache is automatically invalidated on writes.
═══════════════════════════════════════ */
const CACHE_TTL = 300; // seconds (5 minutes)

function cGet(key) {
  try {
    const v = CacheService.getScriptCache().get(key);
    return v ? JSON.parse(v) : null;
  } catch(e) { return null; }
}

function cPut(key, data) {
  try {
    const str = JSON.stringify(data);
    // CacheService has a 100KB per-key limit — skip if too large
    if (str.length < 100000)
      CacheService.getScriptCache().put(key, str, CACHE_TTL);
  } catch(e) {}
}

function cDel() {
  try {
    CacheService.getScriptCache().removeAll(Array.from(arguments));
  } catch(e) {}
}

/* ═══════════════════════════════════════
   KEEP-WARM TRIGGER
   Set this up once in the Triggers panel
   (Time-driven, every 25 minutes).
═══════════════════════════════════════ */
function keepWarm() {
  // Accessing the spreadsheet keeps the script runtime alive,
  // preventing the 5–10s cold-start on the next real request.
  SpreadsheetApp.getActiveSpreadsheet().getName();
}

/* ═══════════════════════════════════════
   SHEET HELPERS
═══════════════════════════════════════ */
function styleHeader(sheet, cols) {
  sheet.getRange(1,1,1,cols).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function getMelasSheet(ss) {
  let s = ss.getSheetByName(MELAS_SHEET);
  if (!s) { s=ss.insertSheet(MELAS_SHEET); s.appendRow(MELAS_HEADERS); styleHeader(s,MELAS_HEADERS.length); }
  return s;
}

function getMenuItemsSheet(ss) {
  let s = ss.getSheetByName(MENU_ITEMS_SHEET);
  if (!s) {
    s = ss.insertSheet(MENU_ITEMS_SHEET);
    s.appendRow(MENU_ITEMS_HEADERS); styleHeader(s,MENU_ITEMS_HEADERS.length);
    const now = new Date().toISOString();
    DEFAULT_ITEMS.forEach(it => s.appendRow([it.key,it.name,it.price,'default',now,it.category||'']));
    cDel('menu_items');
  }
  return s;
}

function getCategoriesSheet(ss) {
  let s = ss.getSheetByName(CATEGORIES_SHEET);
  if (!s) {
    s = ss.insertSheet(CATEGORIES_SHEET);
    s.appendRow(CATEGORIES_HEADERS); styleHeader(s,1);
    DEFAULT_CATEGORIES.forEach(c => s.appendRow([c]));
  }
  return s;
}

/* Add Category column to existing MenuItems sheets and populate default items */
function ensureMenuItemsHasCategory(ss) {
  const sheet = getMenuItemsSheet(ss);
  const hdrs  = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  if (hdrs.includes('Category')) return; // already done

  const catCol = hdrs.length + 1;
  sheet.getRange(1, catCol).setValue('Category').setFontWeight('bold');

  const rows   = sheet.getDataRange().getValues();
  const keyIdx = rows[0].indexOf('ItemKey');
  for (let i = 1; i < rows.length; i++) {
    const cat = DEFAULT_ITEM_CATEGORIES[rows[i][keyIdx]] || '';
    sheet.getRange(i+1, catCol).setValue(cat);
  }
  cDel('menu_items');
}

function getMelaMenuSheet(ss) {
  let s = ss.getSheetByName(MELA_MENU_SHEET);
  if (!s) { s=ss.insertSheet(MELA_MENU_SHEET); s.appendRow(MELA_MENU_HEADERS); styleHeader(s,MELA_MENU_HEADERS.length); }
  return s;
}

function getExpenseCategoriesSheet(ss) {
  let s = ss.getSheetByName(EXPENSE_CATEGORIES_SHEET);
  if (!s) {
    s = ss.insertSheet(EXPENSE_CATEGORIES_SHEET);
    s.appendRow(EXPENSE_CATEGORIES_HEADERS); styleHeader(s,1);
    DEFAULT_EXPENSE_CATEGORIES.forEach(c => s.appendRow([c]));
  }
  return s;
}

function getExpensesSheet(ss, melaId) {
  const name = 'expenses_' + melaId;
  let s = ss.getSheetByName(name);
  if (!s) { s=ss.insertSheet(name); s.appendRow(EXPENSE_HEADERS); styleHeader(s,EXPENSE_HEADERS.length); }
  return s;
}


function getPurchasesSheet(ss, melaId) {
  const name = 'mela_'+melaId;
  let s = ss.getSheetByName(name);
  if (!s) { s=ss.insertSheet(name); s.appendRow(PURCHASES_HEADERS_NEW); styleHeader(s,PURCHASES_HEADERS_NEW.length); }
  return s;
}

function isNewFormatSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  if (!data || data.length===0) return true;
  return data[0].includes('Items');
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const hdrs = data[0];
  const tz   = Session.getScriptTimeZone();
  return data.slice(1).map(row => {
    const obj = {};
    hdrs.forEach((h,i) => {
      const v = row[i];
      obj[h] = (v instanceof Date) ? Utilities.formatDate(v,tz,'yyyy-MM-dd') : v;
    });
    return obj;
  });
}

/* ═══════════════════════════════════════
   RAW MATERIAL SHEET HELPERS
═══════════════════════════════════════ */
function getRawMaterialsSheet(ss) {
  let s = ss.getSheetByName(RAW_MATERIALS_SHEET);
  if (!s) {
    s = ss.insertSheet(RAW_MATERIALS_SHEET);
    s.appendRow(RAW_MATERIALS_HEADERS);
    styleHeader(s, RAW_MATERIALS_HEADERS.length);
  }
  return s;
}

function getRawPurchasesSheet(ss) {
  let s = ss.getSheetByName(RAW_PURCHASES_SHEET);
  if (!s) {
    s = ss.insertSheet(RAW_PURCHASES_SHEET);
    s.appendRow(RAW_PURCHASES_HEADERS);
    styleHeader(s, RAW_PURCHASES_HEADERS.length);
  }
  return s;
}

/* Adjust TotalQty on RawMaterials by delta (positive or negative) */
function adjustRawMaterialQty(ss, rawMaterialId, delta) {
  const sheet = getRawMaterialsSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const idCol  = hdrs.indexOf('RawMaterialId');
  const qtyCol = hdrs.indexOf('TotalQty');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === rawMaterialId) {
      const cur = Number(rows[i][qtyCol]) || 0;
      sheet.getRange(i + 1, qtyCol + 1).setValue(cur + delta);
      cDel('raw_materials');
      return true;
    }
  }
  return false;
}

/* ═══════════════════════════════════════
   MAIN ROUTER
═══════════════════════════════════════ */
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    switch(e.parameter.action) {
      case 'getMelas':            return handleGetMelas(ss);
      case 'createMela':          return handleCreateMela(ss,e);
      case 'updateMela':          return handleUpdateMela(ss,e);
      case 'archiveMela':         return handleArchiveMela(ss,e);
      case 'getExpenseCategories': return handleGetExpenseCategories(ss);
      case 'addExpenseCategory':   return handleAddExpenseCategory(ss,e);
      case 'getExpenses':          return handleGetExpenses(ss,e);
      case 'addExpense':           return handleAddExpense(ss,e);
      case 'updateExpense':        return handleUpdateExpense(ss,e);
      case 'deleteExpense':        return handleDeleteExpense(ss,e);
      case 'getGlobalExpenses':    return handleGetExpenses(ss, {...e, parameter: {...e.parameter, melaId:'global'}});
      case 'addGlobalExpense':     return handleAddExpense(ss,  {...e, parameter: {...e.parameter, data: patchMelaId(e.parameter.data,'global')}});
      case 'updateGlobalExpense':  return handleUpdateExpense(ss,{...e, parameter: {...e.parameter, data: patchMelaId(e.parameter.data,'global')}});
      case 'deleteGlobalExpense':  return handleDeleteExpense(ss,{...e, parameter: {...e.parameter, melaId:'global'}});
      case 'getCategories':        return handleGetCategories(ss);
      case 'addCategory':         return handleAddCategory(ss,e);
      case 'getMenuItems':        return handleGetMenuItems(ss,e);
      case 'getMelaMenu':         return handleGetMelaMenu(ss,e);
      case 'addToMelaMenu':       return handleAddToMelaMenu(ss,e);
      case 'createMenuItem':      return handleCreateMenuItem(ss,e);
      case 'updateMelaMenuItem':  return handleUpdateMelaMenuItem(ss,e);
      case 'archiveMelaMenuItem': return handleSetMenuStatus(ss,e,'archived');
      case 'restoreMelaMenuItem': return handleSetMenuStatus(ss,e,'active');
      case 'reorderMelaMenu':     return handleReorderMelaMenu(ss,e);
      case 'save':                return handleSavePurchase(ss,e);
      // ── Raw Materials ──
      case 'getRawMaterials':       return handleGetRawMaterials(ss,e);
      case 'addRawMaterial':        return handleAddRawMaterial(ss,e);
      case 'updateRawMaterial':     return handleUpdateRawMaterial(ss,e);
      case 'setRawMaterialStatus':  return handleSetRawMaterialStatus(ss,e);
      case 'getRawPurchases':       return handleGetRawPurchases(ss,e);
      case 'addRawPurchase':        return handleAddRawPurchase(ss,e);
      case 'updateRawPurchase':     return handleUpdateRawPurchase(ss,e);
      case 'deleteRawPurchase':     return handleDeleteRawPurchase(ss,e);
      case 'getData':             return handleGetData(ss,e);
      case 'updatePaymentMode':   return handleUpdatePaymentMode(ss,e);
      default: return ok({success:false,error:'Unknown action: '+e.parameter.action});
    }
  } catch(err) { return ok({success:false,error:err.message}); }
}

/* ═══════════════════════════════════════
   MELA HANDLERS
═══════════════════════════════════════ */
function handleGetMelas(ss) {
  const hit = cGet('melas');
  if (hit) return ok({data:hit});
  const data = sheetToObjects(getMelasSheet(ss));
  cPut('melas',data);
  return ok({data});
}

function handleCreateMela(ss,e) {
  const d=JSON.parse(e.parameter.data), melaId='m_'+Date.now();
  getPurchasesSheet(ss,melaId);
  getMelasSheet(ss).appendRow([melaId,d.name||'',d.area||'',d.organiser||'',
    d.contactPerson||'',d.contactPhone||'',d.dateFrom||'',d.dateTo||'','active',new Date().toISOString()]);
  cDel('melas');
  return ok({success:true,melaId});
}

function handleUpdateMela(ss,e) {
  const d=JSON.parse(e.parameter.data);
  const sheet=getMelasSheet(ss), rows=sheet.getDataRange().getValues(), hdrs=rows[0];
  for(let i=1;i<rows.length;i++) {
    if(rows[i][hdrs.indexOf('MelaId')]===d.melaId) {
      const r=i+1, set=(col,val)=>sheet.getRange(r,hdrs.indexOf(col)+1).setValue(val);
      set('MelaName',d.name||''); set('Area',d.area||''); set('OrganiserName',d.organiser||'');
      set('ContactPerson',d.contactPerson||''); set('ContactPhone',d.contactPhone||'');
      set('DateFrom',d.dateFrom||''); set('DateTo',d.dateTo||'');
      cDel('melas');
      return ok({success:true});
    }
  }
  return ok({success:false,error:'Mela not found'});
}

function handleArchiveMela(ss,e) {
  const sheet=getMelasSheet(ss), rows=sheet.getDataRange().getValues(), hdrs=rows[0];
  for(let i=1;i<rows.length;i++) {
    if(rows[i][hdrs.indexOf('MelaId')]===e.parameter.melaId) {
      sheet.getRange(i+1,hdrs.indexOf('Status')+1).setValue(e.parameter.status);
      cDel('melas');
      return ok({success:true});
    }
  }
  return ok({success:false,error:'Mela not found'});
}

/* ── Append a row to MelaMenu using actual header order (not assumed order) ── */
function appendMelaMenuRow(sheet, data) {
  const hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(hdrs.map(h => (h in data) ? data[h] : ''));
}

/* ═══════════════════════════════════════
   MENU HANDLERS
═══════════════════════════════════════ */
function handleGetCategories(ss) {
  const sheet = getCategoriesSheet(ss);
  const data  = sheetToObjects(sheet);
  const cats  = data.map(r => r.CategoryName).filter(Boolean);
  return ok({ data: cats });
}

function handleAddCategory(ss, e) {
  const name = e.parameter.name;
  if (!name) return ok({ success: false, error: 'Category name required' });
  getCategoriesSheet(ss).appendRow([name]);
  return ok({ success: true });
}

function handleGetMenuItems(ss, e) {
  ensureMenuItemsHasCategory(ss);
  if (e.parameter.noCache !== '1') {
    const hit = cGet('menu_items');
    if (hit) return ok({data:hit});
  }
  const data = sheetToObjects(getMenuItemsSheet(ss));
  cPut('menu_items',data);
  return ok({data});
}

function handleGetMelaMenu(ss,e) {
  const melaId=e.parameter.melaId, cKey='mela_menu_'+melaId;
  if (e.parameter.noCache !== '1') {
    const hit=cGet(cKey);
    if(hit) return ok({data:hit});
  }

  ensureMenuItemsHasCategory(ss);
  const allItems=sheetToObjects(getMenuItemsSheet(ss));
  const itemMap={};
  allItems.forEach(it=>{ itemMap[it.ItemKey]=it; });

  const melaMenu=sheetToObjects(getMelaMenuSheet(ss)).filter(r=>r.MelaId===melaId);
  const result=melaMenu.map(mm=>({
    ...mm,
    ItemName:      itemMap[mm.ItemKey]?.ItemName      || mm.ItemKey,
    DefaultPrice:  itemMap[mm.ItemKey]?.DefaultPrice  || 0,
    CreatedInMela: itemMap[mm.ItemKey]?.CreatedInMela || 'default',
    Category:      itemMap[mm.ItemKey]?.Category      || '',
    SortOrder:     (mm.SortOrder!==undefined&&mm.SortOrder!=='') ? Number(mm.SortOrder) : 9999,
  }));
  result.sort((a,b)=>a.SortOrder-b.SortOrder);

  cPut(cKey,result);
  return ok({data:result});
}

function handleAddToMelaMenu(ss,e) {
  const d=JSON.parse(e.parameter.data);
  const sheet=getMelaMenuSheet(ss), existing=sheetToObjects(sheet);
  const now=new Date().toISOString();
  const melaRows=existing.filter(r=>r.MelaId===d.melaId);
  let nextOrder=melaRows.length ? Math.max(...melaRows.map(r=>Number(r.SortOrder||0)))+1 : 1;
  d.items.forEach(item=>{
    if(!existing.find(r=>r.MelaId===d.melaId&&r.ItemKey===item.itemKey))
      appendMelaMenuRow(sheet,{MelaId:d.melaId,ItemKey:item.itemKey,
        SellingPrice:item.sellingPrice,Status:'active',SortOrder:nextOrder++,AddedAt:now});
  });
  cDel('mela_menu_'+d.melaId);
  return ok({success:true});
}

function handleCreateMenuItem(ss,e) {
  const d=JSON.parse(e.parameter.data), itemKey='item_'+Date.now(), now=new Date().toISOString();
  getMenuItemsSheet(ss).appendRow([itemKey, d.name, d.price, d.melaId, now, d.category||'']);
  const mmSheet=getMelaMenuSheet(ss), existing=sheetToObjects(mmSheet).filter(r=>r.MelaId===d.melaId);
  const nextOrder=existing.length ? Math.max(...existing.map(r=>Number(r.SortOrder||0)))+1 : 1;
  appendMelaMenuRow(mmSheet,{MelaId:d.melaId,ItemKey:itemKey,
    SellingPrice:d.price,Status:'active',SortOrder:nextOrder,AddedAt:now});
  cDel('menu_items','mela_menu_'+d.melaId);
  return ok({success:true,itemKey});
}

function handleUpdateMelaMenuItem(ss,e) {
  const d=JSON.parse(e.parameter.data);
  // Update price in MelaMenu
  const mmSheet=getMelaMenuSheet(ss), mmRows=mmSheet.getDataRange().getValues(), mmHdrs=mmRows[0];
  for(let i=1;i<mmRows.length;i++) {
    if(mmRows[i][mmHdrs.indexOf('MelaId')]===d.melaId&&mmRows[i][mmHdrs.indexOf('ItemKey')]===d.itemKey) {
      mmSheet.getRange(i+1,mmHdrs.indexOf('SellingPrice')+1).setValue(d.sellingPrice); break;
    }
  }
  // Update name and/or category in MenuItems (global)
  if(d.itemName || d.category !== undefined) {
    const miSheet=getMenuItemsSheet(ss), miRows=miSheet.getDataRange().getValues(), miHdrs=miRows[0];
    for(let i=1;i<miRows.length;i++) {
      if(miRows[i][miHdrs.indexOf('ItemKey')]===d.itemKey) {
        if(d.itemName)            miSheet.getRange(i+1,miHdrs.indexOf('ItemName')+1).setValue(d.itemName);
        if(d.category!==undefined) miSheet.getRange(i+1,miHdrs.indexOf('Category')+1).setValue(d.category);
        break;
      }
    }
    cDel('menu_items');
  }
  cDel('mela_menu_'+d.melaId);
  return ok({success:true});
}

function handleSetMenuStatus(ss,e,status) {
  const sheet=getMelaMenuSheet(ss), rows=sheet.getDataRange().getValues(), hdrs=rows[0];
  for(let i=1;i<rows.length;i++) {
    if(rows[i][hdrs.indexOf('MelaId')]===e.parameter.melaId&&rows[i][hdrs.indexOf('ItemKey')]===e.parameter.itemKey) {
      sheet.getRange(i+1,hdrs.indexOf('Status')+1).setValue(status);
      cDel('mela_menu_'+e.parameter.melaId);
      return ok({success:true});
    }
  }
  return ok({success:false,error:'Item not found'});
}

function handleReorderMelaMenu(ss,e) {
  const d=JSON.parse(e.parameter.data);
  const sheet=getMelaMenuSheet(ss);
  let rows=sheet.getDataRange().getValues(), hdrs=rows[0];
  let sortColIdx=hdrs.indexOf('SortOrder');
  if(sortColIdx===-1) {
    const nc=hdrs.length+1;
    sheet.getRange(1,nc).setValue('SortOrder');
    sheet.getRange(1,nc).setFontWeight('bold');
    sortColIdx=nc-1;
    rows=sheet.getDataRange().getValues(); hdrs=rows[0];
  }
  const melaIdCol=hdrs.indexOf('MelaId'), itemKeyCol=hdrs.indexOf('ItemKey');
  const orderMap={};
  d.order.forEach((key,i)=>{ orderMap[key]=i+1; });
  for(let i=1;i<rows.length;i++) {
    if(rows[i][melaIdCol]===d.melaId&&orderMap[rows[i][itemKeyCol]]!==undefined)
      sheet.getRange(i+1,sortColIdx+1).setValue(orderMap[rows[i][itemKeyCol]]);
  }
  cDel('mela_menu_'+d.melaId);
  return ok({success:true});
}

/* ═══════════════════════════════════════
   EXPENSE HANDLERS
═══════════════════════════════════════ */
function handleGetExpenseCategories(ss) {
  const data = sheetToObjects(getExpenseCategoriesSheet(ss));
  return ok({ data: data.map(r=>r.CategoryName).filter(Boolean) });
}

function handleAddExpenseCategory(ss,e) {
  const name=e.parameter.name;
  if (!name) return ok({success:false,error:'Category name required'});
  getExpenseCategoriesSheet(ss).appendRow([name]);
  return ok({success:true});
}

function handleGetExpenses(ss,e) {
  const melaId=e.parameter.melaId;
  if (!melaId) return ok({data:[],error:'melaId required'});
  const cKey='expenses_'+melaId;
  if (e.parameter.noCache!=='1') { const hit=cGet(cKey); if(hit) return ok({data:hit}); }
  const data=sheetToObjects(getExpensesSheet(ss,melaId));
  cPut(cKey,data);
  return ok({data});
}

function handleAddExpense(ss,e) {
  const d=JSON.parse(e.parameter.data);
  const expenseId='exp_'+Date.now(), now=new Date().toISOString();
  getExpensesSheet(ss,d.melaId).appendRow([expenseId,d.date,d.category,d.amount,d.notes||'',now]);
  cDel('expenses_'+d.melaId);
  return ok({success:true,expenseId});
}

function handleUpdateExpense(ss,e) {
  const d=JSON.parse(e.parameter.data);
  const sheet=getExpensesSheet(ss,d.melaId);
  const rows=sheet.getDataRange().getValues(), hdrs=rows[0];
  const idCol=hdrs.indexOf('ExpenseId');
  for (let i=1;i<rows.length;i++) {
    if (rows[i][idCol]===d.expenseId) {
      const set=(col,val)=>{ const c=hdrs.indexOf(col); if(c>=0) sheet.getRange(i+1,c+1).setValue(val); };
      set('Date',d.date); set('Category',d.category);
      set('Amount',d.amount); set('Notes',d.notes||'');
      cDel('expenses_'+d.melaId);
      return ok({success:true});
    }
  }
  return ok({success:false,error:'Expense not found'});
}

function handleDeleteExpense(ss,e) {
  const melaId=e.parameter.melaId, expenseId=e.parameter.expenseId;
  const sheet=getExpensesSheet(ss,melaId);
  const rows=sheet.getDataRange().getValues(), hdrs=rows[0];
  const idCol=hdrs.indexOf('ExpenseId');
  for (let i=1;i<rows.length;i++) {
    if (rows[i][idCol]===expenseId) {
      sheet.deleteRow(i+1);
      cDel('expenses_'+melaId);
      return ok({success:true});
    }
  }
  return ok({success:false,error:'Expense not found'});
}


function migrateToNewFormat(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 1) return;
  const oldHdrs = data[0];
  const tz      = Session.getScriptTimeZone();

  // Convert each old row to new format
  const newRows = data.slice(1).map(row => {
    const old = {};
    oldHdrs.forEach((h, i) => {
      const v = row[i];
      old[h] = (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v;
    });
    // Build items JSON from old columns
    const items = {};
    Object.entries(OLD_COL_TO_KEY).forEach(([col, key]) => {
      const qty = Number(old[col] || 0);
      if (qty > 0) items[key] = { qty, price: null }; // price unknown for historical rows
    });
    return [
      old.Timestamp||'', old.Date||'', old.CustomerName||'', old.Phone||'',
      old.CustomerType||'', old.SocialMedia||'',
      JSON.stringify(items), old.TotalAmount||0, old.PaymentMode||'',
    ];
  });

  // Rewrite the sheet with new headers
  sheet.clearContents();
  sheet.appendRow(PURCHASES_HEADERS_NEW);
  styleHeader(sheet, PURCHASES_HEADERS_NEW.length);
  if (newRows.length > 0)
    sheet.getRange(2, 1, newRows.length, PURCHASES_HEADERS_NEW.length).setValues(newRows);
}

/* ═══════════════════════════════════════
   PURCHASE HANDLERS
═══════════════════════════════════════ */
function handleSavePurchase(ss,e) {
  const melaId=e.parameter.melaId;
  if(!melaId) return ok({success:false,error:'melaId required'});
  const d=JSON.parse(e.parameter.data);
  const sheet=getPurchasesSheet(ss,melaId);

  // If old-format sheet has new item keys not in OLD_COL_TO_KEY → auto-migrate
  let useNew = isNewFormatSheet(sheet);
  if (!useNew) {
    const knownKeys = new Set(Object.values(OLD_COL_TO_KEY));
    const hasNewItems = Object.keys(d.items).some(k => !knownKeys.has(k));
    if (hasNewItems) { migrateToNewFormat(sheet); useNew = true; }
  }

  if (useNew) {
    sheet.appendRow([
      d.timestamp, d.date, d.customerName||'', d.phone||'',
      d.customerType, d.socialMedia||'',
      JSON.stringify(d.items), d.totalAmount, d.paymentMode,
    ]);
  } else {
    const getQty=val=>(val&&typeof val==='object')?(val.qty||0):(Number(val)||0);
    const row=[d.timestamp,d.date,d.customerName||'',d.phone||'',d.customerType,d.socialMedia||''];
    Object.entries(OLD_COL_TO_KEY).forEach(([col,key])=>row.push(getQty(d.items[key])));
    row.push(d.totalAmount,d.paymentMode);
    sheet.appendRow(row);
  }
  return ok({success:true});
}

function handleGetData(ss,e) {
  const melaId=e.parameter.melaId;
  if(!melaId) return ok({data:[],error:'melaId required'});
  const sheet=getPurchasesSheet(ss,melaId);
  const raw=sheet.getDataRange().getValues();
  if(raw.length<2) return ok({data:[],isNewFormat:isNewFormatSheet(sheet)});
  const hdrs=raw[0], tz=Session.getScriptTimeZone();
  const data=raw.slice(1).map((row,i)=>{
    const obj={_rowIndex:i+2}; // 1-based sheet row; row 1 = header
    hdrs.forEach((h,j)=>{
      const v=row[j];
      obj[h]=(v instanceof Date)?Utilities.formatDate(v,tz,'yyyy-MM-dd'):v;
    });
    return obj;
  });
  return ok({data,isNewFormat:isNewFormatSheet(sheet)});
}

function handleUpdatePaymentMode(ss,e) {
  const melaId=e.parameter.melaId, rowIndex=Number(e.parameter.rowIndex), newMode=e.parameter.paymentMode;
  if(!melaId||!rowIndex||!newMode) return ok({success:false,error:'melaId, rowIndex and paymentMode required'});
  const sheet=getPurchasesSheet(ss,melaId);
  const hdrs=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  const pmCol=hdrs.indexOf('PaymentMode')+1;
  if(!pmCol) return ok({success:false,error:'PaymentMode column not found'});
  sheet.getRange(rowIndex,pmCol).setValue(newMode);
  return ok({success:true});
}

/* ═══════════════════════════════════════
   RAW MATERIAL HANDLERS
═══════════════════════════════════════ */

function handleGetRawMaterials(ss, e) {
  if (e.parameter.noCache !== '1') {
    const hit = cGet('raw_materials');
    if (hit) return ok({ data: hit });
  }
  const data = sheetToObjects(getRawMaterialsSheet(ss));
  cPut('raw_materials', data);
  return ok({ data });
}

function handleAddRawMaterial(ss, e) {
  const d   = JSON.parse(e.parameter.data);
  const id  = 'rm_' + Date.now();
  const now = new Date().toISOString();
  // TotalQty starts at 0 — qty comes in via purchase entries
  getRawMaterialsSheet(ss).appendRow([id, d.name, d.unit, 0, 'active', now]);
  cDel('raw_materials');
  return ok({ success: true, rawMaterialId: id });
}

function handleUpdateRawMaterial(ss, e) {
  const d     = JSON.parse(e.parameter.data);
  const sheet = getRawMaterialsSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const idCol = hdrs.indexOf('RawMaterialId');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === d.rawMaterialId) {
      const set = (col, val) => { const c = hdrs.indexOf(col); if (c >= 0) sheet.getRange(i+1, c+1).setValue(val); };
      if (d.name !== undefined) set('Name', d.name);
      if (d.unit !== undefined) set('Unit', d.unit);
      cDel('raw_materials');
      return ok({ success: true });
    }
  }
  return ok({ success: false, error: 'Raw material not found' });
}

function handleSetRawMaterialStatus(ss, e) {
  const sheet  = getRawMaterialsSheet(ss);
  const rows   = sheet.getDataRange().getValues();
  const hdrs   = rows[0];
  const idCol  = hdrs.indexOf('RawMaterialId');
  const stCol  = hdrs.indexOf('Status');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === e.parameter.rawMaterialId) {
      sheet.getRange(i + 1, stCol + 1).setValue(e.parameter.status);
      cDel('raw_materials');
      return ok({ success: true });
    }
  }
  return ok({ success: false, error: 'Raw material not found' });
}

/* ── Raw Purchases ── */
function handleGetRawPurchases(ss, e) {
  const rmId = e.parameter.rawMaterialId;
  const cKey = rmId ? 'raw_purchases_' + rmId : 'raw_purchases_all';
  if (e.parameter.noCache !== '1') {
    const hit = cGet(cKey);
    if (hit) return ok({ data: hit });
  }
  let data = sheetToObjects(getRawPurchasesSheet(ss));
  if (rmId) data = data.filter(r => r.RawMaterialId === rmId);
  cPut(cKey, data);
  return ok({ data });
}

function handleAddRawPurchase(ss, e) {
  const d   = JSON.parse(e.parameter.data);
  const id  = 'rp_' + Date.now();
  const now = new Date().toISOString();
  const qty = Number(d.qty) || 0;
  getRawPurchasesSheet(ss).appendRow([id, d.rawMaterialId, qty, Number(d.cost)||0, d.purchasedAt||now, d.note||'']);
  // Add qty to master
  adjustRawMaterialQty(ss, d.rawMaterialId, qty);
  cDel('raw_purchases_' + d.rawMaterialId, 'raw_purchases_all', 'raw_materials');
  return ok({ success: true, purchaseId: id });
}

function handleUpdateRawPurchase(ss, e) {
  const d     = JSON.parse(e.parameter.data);
  const sheet = getRawPurchasesSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const idCol = hdrs.indexOf('PurchaseId');
  const qtyCol = hdrs.indexOf('Qty');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === d.purchaseId) {
      const oldQty = Number(rows[i][qtyCol]) || 0;
      const newQty = Number(d.qty) || 0;
      const delta  = newQty - oldQty;
      const set = (col, val) => { const c = hdrs.indexOf(col); if (c >= 0) sheet.getRange(i+1, c+1).setValue(val); };
      set('Qty', newQty);
      set('Cost', Number(d.cost) || 0);
      set('PurchasedAt', d.purchasedAt || '');
      set('Note', d.note || '');
      // Adjust master qty by the difference
      const rmId = rows[i][hdrs.indexOf('RawMaterialId')];
      if (delta !== 0) adjustRawMaterialQty(ss, rmId, delta);
      cDel('raw_purchases_' + rmId, 'raw_purchases_all', 'raw_materials');
      return ok({ success: true });
    }
  }
  return ok({ success: false, error: 'Purchase not found' });
}

function handleDeleteRawPurchase(ss, e) {
  const sheet  = getRawPurchasesSheet(ss);
  const rows   = sheet.getDataRange().getValues();
  const hdrs   = rows[0];
  const idCol  = hdrs.indexOf('PurchaseId');
  const qtyCol = hdrs.indexOf('Qty');
  const rmCol  = hdrs.indexOf('RawMaterialId');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === e.parameter.purchaseId) {
      const rmId  = rows[i][rmCol];
      const qty   = Number(rows[i][qtyCol]) || 0;
      sheet.deleteRow(i + 1);
      // Deleting a purchase always reverses the qty that was added when it was logged.
      // (If material is spoilt, that is handled at the preparation stage, not here.)
      adjustRawMaterialQty(ss, rmId, -qty);
      cDel('raw_purchases_' + rmId, 'raw_purchases_all', 'raw_materials');
      return ok({ success: true });
    }
  }
  return ok({ success: false, error: 'Purchase not found' });
}

/* ═══════════════════════════════════════
   GLOBAL EXPENSE HELPER
   Patches melaId into a JSON data string so global expense
   actions can reuse the existing per-mela handlers.
═══════════════════════════════════════ */
function patchMelaId(dataStr, melaId) {
  try {
    const obj = JSON.parse(dataStr);
    obj.melaId = melaId;
    return JSON.stringify(obj);
  } catch(e) { return dataStr; }
}

/* ═══════════════════════════════════════
   RESPONSE HELPER
═══════════════════════════════════════ */
function ok(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
