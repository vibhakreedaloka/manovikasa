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
const RECIPES_SHEET          = 'Recipes';
const RECIPES_HEADERS        = ['RecipeId','ItemKey','RawMaterialId','QtyPerUnit','CreatedAt'];
const PREP_LOG_SHEET         = 'PreparationLog';
const MELA_ALLOC_SHEET       = 'MelaAllocations';
const SALE_DEDUCTIONS_SHEET  = 'SaleDeductions';
const SALE_DEDUCTIONS_HEADERS = ['DeductionId','TransactionId','MelaId','ItemKey','QtySold','CostOfGoods','SaleDate','CreatedAt'];
const MELA_ALLOC_HEADERS     = ['AllocationId','MelaId','ItemKey','QtyAllocated','QtyReturnedToStock','QtyDamaged','QtyKeptAtStall','ReturnNote','AllocatedAt','Status'];
const PREP_STOCK_SHEET       = 'PreparedStock';
const PREP_LOG_HEADERS       = ['PrepId','ItemKey','QtyPrepared','PreparedAt','Note','RawMaterialsReturned'];
const PREP_STOCK_HEADERS     = ['ItemKey','AvailableQty'];
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
const PURCHASES_HEADERS_NEW   = ['TransactionId','Timestamp','Date','CustomerName','Phone','CustomerType','SocialMedia','Items','TotalAmount','PaymentMode'];
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

/* Ensure the purchases sheet has TransactionId as its first column.
   Existing new-format sheets (Items present, no TransactionId) get it inserted. */
function ensureTransactionIdColumn(sheet) {
  const data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) return;
  const hdrs = data[0];
  if (hdrs[0] === 'TransactionId') return; // already in place
  if (!hdrs.includes('Items')) return;     // old format — migration handles this separately

  // Insert empty TransactionId column at position 1
  sheet.insertColumnBefore(1);
  sheet.getRange(1, 1).setValue('TransactionId');
  styleHeader(sheet, hdrs.length + 1);
  // Leave existing data rows with empty TransactionId (legacy rows)
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

function getRecipesSheet(ss) {
  let s = ss.getSheetByName(RECIPES_SHEET);
  if (!s) {
    s = ss.insertSheet(RECIPES_SHEET);
    s.appendRow(RECIPES_HEADERS);
    styleHeader(s, RECIPES_HEADERS.length);
  }
  return s;
}

function getPrepLogSheet(ss) {
  let s = ss.getSheetByName(PREP_LOG_SHEET);
  if (!s) {
    s = ss.insertSheet(PREP_LOG_SHEET);
    s.appendRow(PREP_LOG_HEADERS);
    styleHeader(s, PREP_LOG_HEADERS.length);
  }
  return s;
}

function getPrepStockSheet(ss) {
  let s = ss.getSheetByName(PREP_STOCK_SHEET);
  if (!s) {
    s = ss.insertSheet(PREP_STOCK_SHEET);
    s.appendRow(PREP_STOCK_HEADERS);
    styleHeader(s, PREP_STOCK_HEADERS.length);
  }
  return s;
}

function getMelaAllocSheet(ss) {
  let s = ss.getSheetByName(MELA_ALLOC_SHEET);
  if (!s) {
    s = ss.insertSheet(MELA_ALLOC_SHEET);
    s.appendRow(MELA_ALLOC_HEADERS);
    styleHeader(s, MELA_ALLOC_HEADERS.length);
  }
  return s;
}

function getSaleDeductionsSheet(ss) {
  let s = ss.getSheetByName(SALE_DEDUCTIONS_SHEET);
  if (!s) {
    s = ss.insertSheet(SALE_DEDUCTIONS_SHEET);
    s.appendRow(SALE_DEDUCTIONS_HEADERS);
    styleHeader(s, SALE_DEDUCTIONS_HEADERS.length);
  }
  return s;
}

/* Compute weighted average cost per unit for a raw material
   based on all purchase history. Returns 0 if no purchases. */
function weightedAvgCost(ss, rawMaterialId) {
  const purchases = sheetToObjects(getRawPurchasesSheet(ss))
    .filter(p => p.RawMaterialId === rawMaterialId);
  const totalQty  = purchases.reduce((s, p) => s + Number(p.Qty  || 0), 0);
  const totalCost = purchases.reduce((s, p) => s + Number(p.Cost || 0), 0);
  return totalQty > 0 ? totalCost / totalQty : 0;
}

/* Compute cost of goods for one sale line:
   { itemKey, qtySold } → total ingredient cost */
function computeCOGS(ss, itemKey, qtySold) {
  const recipe = getRecipeMap(ss, itemKey);
  if (!Object.keys(recipe).length) return 0;
  let cost = 0;
  Object.entries(recipe).forEach(([rmId, qtyPerUnit]) => {
    cost += weightedAvgCost(ss, rmId) * qtyPerUnit * qtySold;
  });
  return cost;
}

/* Write SaleDeduction rows for a transaction's items.
   items: { itemKey: { qty, price } } */
function writeSaleDeductions(ss, transactionId, melaId, items, saleDate) {
  const sheet = getSaleDeductionsSheet(ss);
  const now   = new Date().toISOString();
  Object.entries(items).forEach(([itemKey, val]) => {
    const qtySold = Number(val.qty || val || 0);
    if (qtySold <= 0) return;
    const cogs = computeCOGS(ss, itemKey, qtySold);
    sheet.appendRow(['ded_' + Date.now() + '_' + itemKey, transactionId, melaId, itemKey, qtySold, cogs, saleDate||'', now]);
  });
  cDel('sale_ded_' + melaId);
}

/* Delete all SaleDeduction rows for a transactionId */
function deleteSaleDeductions(ss, transactionId) {
  const sheet = getSaleDeductionsSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const txCol = hdrs.indexOf('TransactionId');
  const melaId = null;
  // Delete from bottom up to preserve row indices
  for (let i = rows.length - 1; i >= 1; i--) {
    if (rows[i][txCol] === transactionId) {
      sheet.deleteRow(i + 1);
    }
  }
  // Invalidate all mela deduction caches (we don't know which mela without scanning)
  cDel('sale_ded_all');
}

/* Adjust PreparedStock for an ItemKey by delta (+/-).
   Upserts the row — creates it if it doesn't exist yet. */
function adjustPreparedStock(ss, itemKey, delta) {
  const sheet = getPrepStockSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const ikCol = hdrs.indexOf('ItemKey');
  const qyCol = hdrs.indexOf('AvailableQty');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][ikCol] === itemKey) {
      const cur = Number(rows[i][qyCol]) || 0;
      sheet.getRange(i + 1, qyCol + 1).setValue(Math.max(0, cur + delta));
      cDel('prep_stock');
      return;
    }
  }
  // Row doesn't exist yet — insert
  sheet.appendRow([itemKey, Math.max(0, delta)]);
  cDel('prep_stock');
}

/* Fetch all recipe lines for an ItemKey as a map { rawMaterialId: qtyPerUnit } */
function getRecipeMap(ss, itemKey) {
  const rows  = sheetToObjects(getRecipesSheet(ss));
  const lines = rows.filter(r => r.ItemKey === itemKey);
  const map   = {};
  lines.forEach(r => { map[r.RawMaterialId] = Number(r.QtyPerUnit) || 0; });
  return map;
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
      case 'updateTransaction':   return handleUpdateTransaction(ss,e);
      case 'deleteTransaction':   return handleDeleteTransaction(ss,e);
      case 'getSaleDeductions':   return handleGetSaleDeductions(ss,e);
      // ── Mela Allocations ──
      case 'getMelaAllocations':    return handleGetMelaAllocations(ss,e);
      case 'addMelaAllocation':     return handleAddMelaAllocation(ss,e);
      case 'returnMelaAllocation':  return handleReturnMelaAllocation(ss,e);
      // ── Preparations ──
      case 'getPreparationLog':     return handleGetPreparationLog(ss,e);
      case 'getPreparedStock':      return handleGetPreparedStock(ss,e);
      case 'addPreparation':        return handleAddPreparation(ss,e);
      case 'updatePreparation':     return handleUpdatePreparation(ss,e);
      case 'deletePreparation':     return handleDeletePreparation(ss,e);
      // ── Recipes ──
      case 'getRecipes':            return handleGetRecipes(ss,e);
      case 'saveRecipe':            return handleSaveRecipe(ss,e);
      case 'deleteRecipeLine':      return handleDeleteRecipeLine(ss,e);
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

  // Rewrite the sheet with new headers (TransactionId prepended as empty for legacy rows)
  const migratedRows = newRows.map(r => ['', ...r]); // prepend empty TransactionId
  sheet.clearContents();
  sheet.appendRow(PURCHASES_HEADERS_NEW);
  styleHeader(sheet, PURCHASES_HEADERS_NEW.length);
  if (migratedRows.length > 0)
    sheet.getRange(2, 1, migratedRows.length, PURCHASES_HEADERS_NEW.length).setValues(migratedRows);
}

/* ═══════════════════════════════════════
   PURCHASE HANDLERS
═══════════════════════════════════════ */
function handleSavePurchase(ss,e) {
  const melaId=e.parameter.melaId;
  if(!melaId) return ok({success:false,error:'melaId required'});
  const d=JSON.parse(e.parameter.data);
  const sheet=getPurchasesSheet(ss,melaId);
  ensureTransactionIdColumn(sheet); // self-heal: add TransactionId column if missing

  // Generate a unique TransactionId for new sales
  const transactionId = d.transactionId || ('tx_' + Date.now());

  // If old-format sheet has new item keys not in OLD_COL_TO_KEY → auto-migrate
  let useNew = isNewFormatSheet(sheet);
  if (!useNew) {
    const knownKeys = new Set(Object.values(OLD_COL_TO_KEY));
    const hasNewItems = Object.keys(d.items).some(k => !knownKeys.has(k));
    if (hasNewItems) { migrateToNewFormat(sheet); useNew = true; }
  }

  if (useNew) {
    sheet.appendRow([
      transactionId, d.timestamp, d.date, d.customerName||'', d.phone||'',
      d.customerType, d.socialMedia||'',
      JSON.stringify(d.items), d.totalAmount, d.paymentMode,
    ]);
  } else {
    const getQty=val=>(val&&typeof val==='object')?(val.qty||0):(Number(val)||0);
    const row=[transactionId,d.timestamp,d.date,d.customerName||'',d.phone||'',d.customerType,d.socialMedia||''];
    Object.entries(OLD_COL_TO_KEY).forEach(([col,key])=>row.push(getQty(d.items[key])));
    row.push(d.totalAmount,d.paymentMode);
    sheet.appendRow(row);
  }

  // Write sale deductions (COGS per item sold)
  writeSaleDeductions(ss, transactionId, melaId, d.items, d.date);

  return ok({success:true, transactionId});
}

function handleGetData(ss,e) {
  const melaId=e.parameter.melaId;
  if(!melaId) return ok({data:[],error:'melaId required'});
  const sheet=getPurchasesSheet(ss,melaId);
  ensureTransactionIdColumn(sheet); // self-heal: add TransactionId column if missing
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
   TRANSACTION EDIT / DELETE HANDLERS
═══════════════════════════════════════ */

/* Update a transaction row in full.
   Identifies the row by TransactionId (new rows) or rowIndex (legacy rows).
   Reverses old deductions, writes new ones. */
function handleUpdateTransaction(ss, e) {
  const melaId = e.parameter.melaId;
  const d      = JSON.parse(e.parameter.data);
  if (!melaId) return ok({ success: false, error: 'melaId required' });

  const sheet = getPurchasesSheet(ss, melaId);
  ensureTransactionIdColumn(sheet); // self-heal
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];

  const txIdCol  = hdrs.indexOf('TransactionId');
  const riCol    = hdrs.indexOf('_rowIndex'); // doesn't exist in sheet — use sheet row

  // Find the row: by TransactionId if present, else by rowIndex (1-based sheet row)
  let targetRow = -1;
  if (d.transactionId && txIdCol >= 0) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][txIdCol] === d.transactionId) { targetRow = i + 1; break; }
    }
  }
  // Fall back to rowIndex (legacy rows without TransactionId)
  if (targetRow < 0 && d.rowIndex) {
    targetRow = Number(d.rowIndex);
  }
  if (targetRow < 0) return ok({ success: false, error: 'Transaction not found' });

  // Determine old TransactionId for deduction reversal
  const oldTxId = txIdCol >= 0 ? rows[targetRow - 1][txIdCol] : null;

  // Build the new row values
  const transactionId = oldTxId || d.transactionId || ('tx_' + Date.now());
  const set = (col, val) => {
    const c = hdrs.indexOf(col);
    if (c >= 0) sheet.getRange(targetRow, c + 1).setValue(val);
  };

  if (txIdCol >= 0) set('TransactionId', transactionId);
  set('Timestamp',    d.timestamp    || new Date().toISOString());
  set('Date',         d.date         || '');
  set('CustomerName', d.customerName || '');
  set('Phone',        d.phone        || '');
  set('CustomerType', d.customerType || 'normal');
  set('SocialMedia',  d.socialMedia  || '');
  set('Items',        JSON.stringify(d.items));
  set('TotalAmount',  d.totalAmount  || 0);
  set('PaymentMode',  d.paymentMode  || 'cash');

  // Reverse old deductions, write new ones
  if (oldTxId) deleteSaleDeductions(ss, oldTxId);
  writeSaleDeductions(ss, transactionId, melaId, d.items, d.date);

  cDel('sale_ded_' + melaId);
  return ok({ success: true, transactionId });
}

/* Delete a transaction row.
   Identifies by TransactionId or rowIndex. Reverses deductions. */
function handleDeleteTransaction(ss, e) {
  const melaId = e.parameter.melaId;
  if (!melaId) return ok({ success: false, error: 'melaId required' });

  const sheet = getPurchasesSheet(ss, melaId);
  ensureTransactionIdColumn(sheet); // self-heal
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const txIdCol = hdrs.indexOf('TransactionId');

  let targetRow = -1;
  let oldTxId   = null;

  if (e.parameter.transactionId && txIdCol >= 0) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][txIdCol] === e.parameter.transactionId) {
        targetRow = i + 1;
        oldTxId   = rows[i][txIdCol];
        break;
      }
    }
  }
  if (targetRow < 0 && e.parameter.rowIndex) {
    targetRow = Number(e.parameter.rowIndex);
    if (txIdCol >= 0) oldTxId = rows[targetRow - 1]?.[txIdCol] || null;
  }
  if (targetRow < 0) return ok({ success: false, error: 'Transaction not found' });

  // Reverse deductions before deleting
  if (oldTxId) deleteSaleDeductions(ss, oldTxId);

  sheet.deleteRow(targetRow);
  cDel('sale_ded_' + melaId);
  return ok({ success: true });
}

/* Get all sale deductions for a mela */
function handleGetSaleDeductions(ss, e) {
  const melaId = e.parameter.melaId;
  if (!melaId) return ok({ data: [], error: 'melaId required' });
  const cKey = 'sale_ded_' + melaId;
  if (e.parameter.noCache !== '1') {
    const hit = cGet(cKey);
    if (hit) return ok({ data: hit });
  }
  const data = sheetToObjects(getSaleDeductionsSheet(ss)).filter(r => r.MelaId === melaId);
  cPut(cKey, data);
  return ok({ data });
}

/* ═══════════════════════════════════════
   MELA ALLOCATION HANDLERS
═══════════════════════════════════════ */

function handleGetMelaAllocations(ss, e) {
  const melaId = e.parameter.melaId;
  if (!melaId) return ok({ data: [], error: 'melaId required' });
  const cKey = 'mela_alloc_' + melaId;
  if (e.parameter.noCache !== '1') {
    const hit = cGet(cKey);
    if (hit) return ok({ data: hit });
  }
  const data = sheetToObjects(getMelaAllocSheet(ss)).filter(r => r.MelaId === melaId);
  cPut(cKey, data);
  return ok({ data });
}

/* Take items from PreparedStock to a mela.
   d: { melaId, itemKey, qty, note, allocatedAt } */
function handleAddMelaAllocation(ss, e) {
  const d   = JSON.parse(e.parameter.data);
  const qty = Number(d.qty) || 0;
  if (qty <= 0) return ok({ success: false, error: 'Qty must be greater than 0' });

  // Check PreparedStock availability
  const stockRows = sheetToObjects(getPrepStockSheet(ss));
  const stockRow  = stockRows.find(r => r.ItemKey === d.itemKey);
  const available = Number(stockRow?.AvailableQty || 0);
  if (qty > available) {
    return ok({
      success: false,
      error: 'Insufficient prepared stock',
      available,
    });
  }

  // Deduct from PreparedStock
  adjustPreparedStock(ss, d.itemKey, -qty);

  // Create allocation row
  const allocId = 'alloc_' + Date.now();
  const now     = new Date().toISOString();
  getMelaAllocSheet(ss).appendRow([
    allocId, d.melaId, d.itemKey,
    qty,   // QtyAllocated
    0,     // QtyReturnedToStock
    0,     // QtyDamaged
    0,     // QtyKeptAtStall
    d.note || '',
    d.allocatedAt || now,
    'active',
  ]);

  cDel('mela_alloc_' + d.melaId, 'prep_stock');
  return ok({ success: true, allocId });
}

/* Return items from a mela allocation.
   d: { allocId, melaId, qtyReturnedToStock, qtyDamaged, returnNote }
   (qtyKeptAtStall always defaults to 0 — implicit, not sent from client)
   The three qtys must add up to <= QtyAllocated - already-returned/damaged/kept.
*/
function handleReturnMelaAllocation(ss, e) {
  const d     = JSON.parse(e.parameter.data);
  const sheet = getMelaAllocSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];

  const col = h => hdrs.indexOf(h);
  const idCol    = col('AllocationId');
  const ikCol    = col('ItemKey');
  const qaCol    = col('QtyAllocated');
  const qrCol    = col('QtyReturnedToStock');
  const qdCol    = col('QtyDamaged');
  const qkCol    = col('QtyKeptAtStall');
  const rnCol    = col('ReturnNote');
  const stCol    = col('Status');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] !== d.allocId) continue;

    const itemKey      = rows[i][ikCol];
    const qtyAllocated = Number(rows[i][qaCol]) || 0;
    const qtyRetPrev   = Number(rows[i][qrCol]) || 0;
    const qtyDmgPrev   = Number(rows[i][qdCol]) || 0;
    const qtyKptPrev   = Number(rows[i][qkCol]) || 0;

    const alreadyDisposed = qtyRetPrev + qtyDmgPrev + qtyKptPrev;
    const stillAtStall    = qtyAllocated - alreadyDisposed;

    const newRet = Number(d.qtyReturnedToStock || 0);
    const newDmg = Number(d.qtyDamaged         || 0);
    const newKpt = Number(d.qtyKeptAtStall      || 0);
    const total  = newRet + newDmg + newKpt;

    if (total <= 0)             return ok({ success: false, error: 'Enter at least one non-zero quantity' });
    if (total > stillAtStall)   return ok({ success: false, error: `Only ${stillAtStall} units still at stall`, stillAtStall });

    // Update the row (accumulate onto existing values)
    const r = i + 1;
    sheet.getRange(r, qrCol + 1).setValue(qtyRetPrev + newRet);
    sheet.getRange(r, qdCol + 1).setValue(qtyDmgPrev + newDmg);
    sheet.getRange(r, qkCol + 1).setValue(qtyKptPrev + newKpt);
    if (d.returnNote) sheet.getRange(r, rnCol + 1).setValue(d.returnNote);

    // Mark fully disposed allocations as 'returned'
    const totalDisposed = alreadyDisposed + total;
    if (totalDisposed >= qtyAllocated) {
      sheet.getRange(r, stCol + 1).setValue('returned');
    }

    // Restore returned qty to PreparedStock
    if (newRet > 0) adjustPreparedStock(ss, itemKey, newRet);

    cDel('mela_alloc_' + d.melaId, 'prep_stock');
    return ok({ success: true, stillAtStall: stillAtStall - total });
  }
  return ok({ success: false, error: 'Allocation not found' });
}

/* ═══════════════════════════════════════
   PREPARATION HANDLERS
═══════════════════════════════════════ */

function handleGetPreparationLog(ss, e) {
  const itemKey = e.parameter.itemKey || null;
  const cKey    = itemKey ? 'prep_log_' + itemKey : 'prep_log_all';
  if (e.parameter.noCache !== '1') {
    const hit = cGet(cKey);
    if (hit) return ok({ data: hit });
  }
  let data = sheetToObjects(getPrepLogSheet(ss));
  if (itemKey) data = data.filter(r => r.ItemKey === itemKey);
  // Sort newest first
  data.sort((a, b) => (b.PreparedAt || '').localeCompare(a.PreparedAt || ''));
  cPut(cKey, data);
  return ok({ data });
}

function handleGetPreparedStock(ss, e) {
  if (e.parameter.noCache !== '1') {
    const hit = cGet('prep_stock');
    if (hit) return ok({ data: hit });
  }
  const data = sheetToObjects(getPrepStockSheet(ss));
  cPut('prep_stock', data);
  return ok({ data });
}

function handleAddPreparation(ss, e) {
  const d      = JSON.parse(e.parameter.data);
  const prepId = 'prep_' + Date.now();
  const now    = new Date().toISOString();
  const qty    = Number(d.qty) || 0;
  if (qty <= 0) return ok({ success: false, error: 'Qty must be greater than 0' });

  // 1. Fetch recipe — must have at least one ingredient to deduct
  const recipe = getRecipeMap(ss, d.itemKey);
  const hasRecipe = Object.keys(recipe).length > 0;

  // 2. Check sufficient raw material stock
  if (hasRecipe) {
    const rmSheet = getRawMaterialsSheet(ss);
    const rmRows  = sheetToObjects(rmSheet);
    const rmMap   = {};
    rmRows.forEach(r => { rmMap[r.RawMaterialId] = Number(r.TotalQty) || 0; });
    const shortfalls = [];
    Object.entries(recipe).forEach(([rmId, qtyPer]) => {
      const needed  = qtyPer * qty;
      const have    = rmMap[rmId] || 0;
      if (needed > have) {
        shortfalls.push({ rmId, needed, have });
      }
    });
    if (shortfalls.length > 0) {
      // Return shortfall info so the client can show a clear error
      return ok({
        success: false,
        error: 'Insufficient raw materials',
        shortfalls,
      });
    }
    // 3. Deduct raw materials
    Object.entries(recipe).forEach(([rmId, qtyPer]) => {
      adjustRawMaterialQty(ss, rmId, -(qtyPer * qty));
    });
  }

  // 4. Add to PreparedStock
  adjustPreparedStock(ss, d.itemKey, qty);

  // 5. Log the preparation
  getPrepLogSheet(ss).appendRow([
    prepId, d.itemKey, qty, d.preparedAt || now, d.note || '', 'false'
  ]);

  cDel('prep_log_all', 'prep_log_' + d.itemKey, 'raw_materials', 'prep_stock');
  return ok({ success: true, prepId, hasRecipe });
}

function handleUpdatePreparation(ss, e) {
  const d     = JSON.parse(e.parameter.data);
  const sheet = getPrepLogSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const idCol  = hdrs.indexOf('PrepId');
  const ikCol  = hdrs.indexOf('ItemKey');
  const qtyCol = hdrs.indexOf('QtyPrepared');
  const atCol  = hdrs.indexOf('PreparedAt');
  const ntCol  = hdrs.indexOf('Note');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] !== d.prepId) continue;

    const itemKey = rows[i][ikCol];
    const oldQty  = Number(rows[i][qtyCol]) || 0;
    const newQty  = Number(d.qty) || 0;
    if (newQty <= 0) return ok({ success: false, error: 'Qty must be greater than 0' });
    const delta = newQty - oldQty;

    const recipe    = getRecipeMap(ss, itemKey);
    const hasRecipe = Object.keys(recipe).length > 0;

    if (hasRecipe && delta !== 0) {
      if (delta > 0) {
        // Need more raw materials — check stock for the additional qty
        const rmRows = sheetToObjects(getRawMaterialsSheet(ss));
        const rmMap  = {};
        rmRows.forEach(r => { rmMap[r.RawMaterialId] = Number(r.TotalQty) || 0; });
        const shortfalls = [];
        Object.entries(recipe).forEach(([rmId, qtyPer]) => {
          const needed = qtyPer * delta;
          const have   = rmMap[rmId] || 0;
          if (needed > have) shortfalls.push({ rmId, needed, have });
        });
        if (shortfalls.length > 0) return ok({ success: false, error: 'Insufficient raw materials', shortfalls });
      }
      // Apply delta to raw materials (positive delta = more consumed, negative = returned)
      Object.entries(recipe).forEach(([rmId, qtyPer]) => {
        adjustRawMaterialQty(ss, rmId, -(qtyPer * delta));
      });
    }

    // Update PreparedStock
    if (delta !== 0) adjustPreparedStock(ss, itemKey, delta);

    // Update the log row
    sheet.getRange(i + 1, qtyCol + 1).setValue(newQty);
    if (d.preparedAt) sheet.getRange(i + 1, atCol + 1).setValue(d.preparedAt);
    if (d.note !== undefined) sheet.getRange(i + 1, ntCol + 1).setValue(d.note || '');

    cDel('prep_log_all', 'prep_log_' + itemKey, 'raw_materials', 'prep_stock');
    return ok({ success: true });
  }
  return ok({ success: false, error: 'Preparation not found' });
}

function handleDeletePreparation(ss, e) {
  const sheet = getPrepLogSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const idCol  = hdrs.indexOf('PrepId');
  const ikCol  = hdrs.indexOf('ItemKey');
  const qtyCol = hdrs.indexOf('QtyPrepared');

  // restoreRawMaterials: 'true' = put raw materials back, 'false' = keep deducted (spoilt)
  const restore = e.parameter.restoreRawMaterials === 'true';

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] !== e.parameter.prepId) continue;

    const itemKey = rows[i][ikCol];
    const qty     = Number(rows[i][qtyCol]) || 0;

    // Always remove from PreparedStock
    adjustPreparedStock(ss, itemKey, -qty);

    // Conditionally restore raw materials
    if (restore) {
      const recipe = getRecipeMap(ss, itemKey);
      Object.entries(recipe).forEach(([rmId, qtyPer]) => {
        adjustRawMaterialQty(ss, rmId, qtyPer * qty);
      });
    }

    sheet.deleteRow(i + 1);
    cDel('prep_log_all', 'prep_log_' + itemKey, 'raw_materials', 'prep_stock');
    return ok({ success: true });
  }
  return ok({ success: false, error: 'Preparation not found' });
}

/* ═══════════════════════════════════════
   RECIPE HANDLERS
═══════════════════════════════════════ */

/* Returns all recipe lines, optionally filtered by ItemKey */
function handleGetRecipes(ss, e) {
  const itemKey = e.parameter.itemKey || null;
  const cKey    = itemKey ? 'recipes_' + itemKey : 'recipes_all';
  if (e.parameter.noCache !== '1') {
    const hit = cGet(cKey);
    if (hit) return ok({ data: hit });
  }
  let data = sheetToObjects(getRecipesSheet(ss));
  if (itemKey) data = data.filter(r => r.ItemKey === itemKey);
  cPut(cKey, data);
  return ok({ data });
}

/* Upsert a single recipe line (one raw material entry for an ItemKey).
   If RecipeId is provided → update qty. If not → insert new line.
   Enforces: same ItemKey+RawMaterialId combo cannot appear twice. */
function handleSaveRecipe(ss, e) {
  const d     = JSON.parse(e.parameter.data);
  const sheet = getRecipesSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const idCol  = hdrs.indexOf('RecipeId');
  const ikCol  = hdrs.indexOf('ItemKey');
  const rmCol  = hdrs.indexOf('RawMaterialId');
  const qtyCol = hdrs.indexOf('QtyPerUnit');
  const now    = new Date().toISOString();

  if (d.recipeId) {
    // Update existing line
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][idCol] === d.recipeId) {
        sheet.getRange(i + 1, qtyCol + 1).setValue(Number(d.qtyPerUnit));
        cDel('recipes_' + d.itemKey, 'recipes_all');
        return ok({ success: true });
      }
    }
    return ok({ success: false, error: 'Recipe line not found' });
  } else {
    // Check duplicate
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][ikCol] === d.itemKey && rows[i][rmCol] === d.rawMaterialId) {
        return ok({ success: false, error: 'This raw material is already in the recipe. Edit the existing line instead.' });
      }
    }
    const recipeId = 'rc_' + Date.now();
    sheet.appendRow([recipeId, d.itemKey, d.rawMaterialId, Number(d.qtyPerUnit), now]);
    cDel('recipes_' + d.itemKey, 'recipes_all');
    return ok({ success: true, recipeId });
  }
}

/* Delete a single recipe line by RecipeId */
function handleDeleteRecipeLine(ss, e) {
  const sheet = getRecipesSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const idCol = hdrs.indexOf('RecipeId');
  const ikCol = hdrs.indexOf('ItemKey');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idCol] === e.parameter.recipeId) {
      const itemKey = rows[i][ikCol];
      sheet.deleteRow(i + 1);
      cDel('recipes_' + itemKey, 'recipes_all');
      return ok({ success: true });
    }
  }
  return ok({ success: false, error: 'Recipe line not found' });
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
