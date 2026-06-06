const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const DIMENSION_STORE_NAME = "dimension-files";
const FACT_STORE_NAME = "fact-files";
const CATEGORY_DIMENSION_SLOT = "dimension-3";
const PURCHASE_ASSIGNMENT_SLOT = "dimension-1";
const PURCHASE_UNDELIVERED_FACT_SLOT = "fact-5";
const KINGDEE_MATERIAL_FACT_SLOT = "fact-3";
const CATEGORY_TABLE = "Dim-YL医疗器械商品分类";
const PURCHASE_TABLE = "Dim-采购部分工明细";
const SOURCE_LABEL = "数据来源：本地文件库 / 信息缺失";

const missingEls = {
  sourceNote: document.querySelector("#missingSourceNote"),
  filterBar: document.querySelector("#missingFilterBar"),
  maintainTableFilter: document.querySelector("#maintainTableFilter"),
  missingFieldFilter: document.querySelector("#missingFieldFilter"),
  state: document.querySelector("#missingState"),
  rows: document.querySelector("#missingRows"),
  downloadButton: document.querySelector("#missingDownloadButton"),
  materialCount: document.querySelector("#missingMaterialCount"),
  categoryCount: document.querySelector("#missingCategoryCount"),
  purchaseCount: document.querySelector("#missingPurchaseCount"),
  orderRowCount: document.querySelector("#missingOrderRowCount"),
};

const missingState = {
  rows: [],
  filteredRows: [],
  selectedMaintainTables: new Set(),
  selectedMissingFields: new Set(),
  message: "",
};

const maintainTableFilterConfig = {
  key: "maintainTable",
  element: missingEls.maintainTableFilter,
  label: "全部维护维度表",
  selectedKey: "selectedMaintainTables",
  optionKey: "maintainTable",
};

const missingFieldFilterConfig = {
  key: "missingField",
  element: missingEls.missingFieldFilter,
  label: "全部待维护字段",
  selectedKey: "selectedMissingFields",
  optionKey: "missingField",
};

const missingFilterConfigs = [maintainTableFilterConfig, missingFieldFilterConfig];

const orderColumnAliases = {
  materialCode: ["物料编码", "商品编码", "存货编码", "产品编码", "品号"],
  sku: ["SKU", "sku", "领星SKU"],
  itemName: ["物品名称", "物料名称", "商品名称", "存货名称", "产品名称", "金蝶名称", "品名"],
  supplier: ["供应商", "供应商名称", "供方名称"],
  supplierShort: ["供应商简称", "供方简称", "简称"],
  orderUser: ["采购下单人", "下单人", "采购员", "采购负责人"],
  orderedQty: ["下单数量-备货需求-OA申请为准", "下单数量", "订单数量"],
  shippedQty: ["发货数量", "已发货数量"],
  remainingQty: ["未发货数量", "剩余数量", "未交付数量"],
};

async function initMissingDashboard() {
  missingFilterConfigs.forEach(renderFilterShell);
  missingEls.filterBar.addEventListener("click", handleFilterBarClick);
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#missingFilterBar")) closeFilterMenus();
  });
  missingEls.downloadButton.addEventListener("click", downloadMissingRows);
  await loadMissingData();
}

async function loadMissingData() {
  try {
    const db = await openAppDb();
    const [factRecord, kingdeeMaterialRecord, categoryRecord, purchaseRecord] = await Promise.all([
      getRecord(db, FACT_STORE_NAME, PURCHASE_UNDELIVERED_FACT_SLOT),
      getRecord(db, FACT_STORE_NAME, KINGDEE_MATERIAL_FACT_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, CATEGORY_DIMENSION_SLOT),
      getRecord(db, DIMENSION_STORE_NAME, PURCHASE_ASSIGNMENT_SLOT),
    ]);
    db.close();

    const appliedFact = getAppliedLibraryRecord(factRecord);
    const appliedKingdeeMaterial = getAppliedLibraryRecord(kingdeeMaterialRecord);
    const appliedCategory = getAppliedLibraryRecord(categoryRecord);
    const appliedPurchase = getAppliedLibraryRecord(purchaseRecord);

    if (!appliedFact?.file && !appliedKingdeeMaterial?.file) {
      renderMissing([], "请先在事实表文件库上传并确认应用采购未交付表或金蝶物料列表");
      return;
    }

    const factRows = appliedFact?.file ? await readPurchaseUndeliveredWorkbook(appliedFact.file) : [];
    const kingdeeMaterialRows = appliedKingdeeMaterial?.file ? await readKingdeeMaterialWorkbook(appliedKingdeeMaterial.file) : [];
    const categoryMap = appliedCategory?.file ? await readCategoryDimension(appliedCategory.file) : new Map();
    const purchaseMap = appliedPurchase?.file ? await readPurchaseAssignment(appliedPurchase.file) : new Map();
    const rows = [
      ...buildMissingRows(factRows, categoryMap, purchaseMap),
      ...buildKingdeeMaterialMissingRows(kingdeeMaterialRows, categoryMap),
    ];
    updateSourceNote(appliedFact, appliedKingdeeMaterial);
    renderMissing(rows);
  } catch (error) {
    console.error(error);
    renderMissing([], "信息缺失读取失败");
  }
}

function buildKingdeeMaterialMissingRows(kingdeeRows, categoryMap) {
  return kingdeeRows
    .filter((row) => row.materialCode && !categoryMap.has(normalizeMaterialCode(row.materialCode)))
    .map((row) => ({
      maintainTable: CATEGORY_TABLE,
      missingField: "物料编码未建档（金蝶物料列表C列）",
      businessUnits: row.sheetName,
      materialCode: row.materialCode,
      sku: row.sku,
      itemName: row.itemName,
      supplier: row.supplier,
      supplierShort: "",
      orderUser: "",
      rowCount: 1,
      orderedQty: 0,
      shippedQty: 0,
      remainingQty: 0,
    }))
    .sort((a, b) => String(a.materialCode).localeCompare(String(b.materialCode), "zh-CN"));
}

function buildMissingRows(factRows, categoryMap, purchaseMap) {
  const grouped = new Map();
  factRows.forEach((row) => {
    const materialCode = normalizeMaterialCode(row.materialCode);
    if (!materialCode) return;
    if (!grouped.has(materialCode)) {
      grouped.set(materialCode, {
        materialCode: row.materialCode,
        sku: row.sku,
        itemName: row.itemName,
        supplier: row.supplier,
        supplierShort: row.supplierShort,
        orderUser: row.orderUser,
        businessUnits: new Set(),
        rowCount: 0,
        orderedQty: 0,
        shippedQty: 0,
        remainingQty: 0,
      });
    }
    const item = grouped.get(materialCode);
    if (row.businessUnit) item.businessUnits.add(row.businessUnit);
    item.sku ||= row.sku;
    item.itemName ||= row.itemName;
    item.supplier ||= row.supplier;
    item.supplierShort ||= row.supplierShort;
    item.orderUser ||= row.orderUser;
    item.rowCount += 1;
    item.orderedQty += Number(row.orderedQty) || 0;
    item.shippedQty += Number(row.shippedQty) || 0;
    item.remainingQty += Number(row.remainingQty) || 0;
  });

  return [...grouped.values()]
    .flatMap((item) => createMissingDetails(item, categoryMap, purchaseMap))
    .sort((a, b) => b.rowCount - a.rowCount || String(a.materialCode).localeCompare(String(b.materialCode), "zh-CN"));
}

function createMissingDetails(item, categoryMap, purchaseMap) {
  const key = normalizeMaterialCode(item.materialCode);
  const category = categoryMap.get(key);
  const purchase = purchaseMap.get(key);
  const details = [];

  if (!category) {
    addMissingDetail(details, item, CATEGORY_TABLE, "物料编码未建档");
  } else {
    if (!category.salesLine) addMissingDetail(details, item, CATEGORY_TABLE, "销售产品线");
    if (!category.salesSeries) addMissingDetail(details, item, CATEGORY_TABLE, "销售系列");
    if (!category.purchaseGroup) addMissingDetail(details, item, CATEGORY_TABLE, "采购分组");
    if (!category.sku) addMissingDetail(details, item, CATEGORY_TABLE, "SKU");
    if (!category.itemName) addMissingDetail(details, item, CATEGORY_TABLE, "物品名称");
  }

  if (!purchase) {
    addMissingDetail(details, item, PURCHASE_TABLE, "物料编码未建档");
  } else {
    if (!purchase.supplier) addMissingDetail(details, item, PURCHASE_TABLE, "供应商");
    if (!purchase.supplierShort) addMissingDetail(details, item, PURCHASE_TABLE, "供应商简称");
    if (!purchase.orderUser) addMissingDetail(details, item, PURCHASE_TABLE, "采购下单人");
  }

  return details.map((detail) => ({
    ...detail,
    sku: category?.sku || item.sku,
    itemName: category?.itemName || item.itemName,
    supplier: purchase?.supplier || item.supplier,
    supplierShort: purchase?.supplierShort || item.supplierShort,
    orderUser: purchase?.orderUser || item.orderUser,
  }));
}

function addMissingDetail(details, item, maintainTable, missingField) {
  details.push({
    maintainTable,
    missingField,
    businessUnits: [...item.businessUnits].join("、"),
    materialCode: item.materialCode,
    sku: item.sku,
    itemName: item.itemName,
    supplier: item.supplier,
    supplierShort: item.supplierShort,
    orderUser: item.orderUser,
    rowCount: item.rowCount,
    orderedQty: item.orderedQty,
    shippedQty: item.shippedQty,
    remainingQty: item.remainingQty,
  });
}

async function readCategoryDimension(file) {
  const rows = await readWorkbookRows(file, "Dim-YL医疗器械商品分类");
  const map = new Map();
  rows.slice(1).forEach((row) => {
    const materialCode = normalizeMaterialCode(row[0]);
    if (!materialCode) return;
    map.set(materialCode, {
      sku: String(row[2] ?? "").trim(),
      itemName: String(row[3] ?? "").trim(),
      salesLine: String(row[6] ?? "").trim(),
      salesSeries: String(row[7] ?? "").trim(),
      purchaseGroup: String(row[20] ?? "").trim(),
    });
  });
  return map;
}

async function readPurchaseAssignment(file) {
  const rows = await readWorkbookRows(file, "产品线明细");
  const map = new Map();
  rows.slice(1).forEach((row) => {
    const materialCode = normalizeMaterialCode(row[3]);
    if (!materialCode) return;
    map.set(materialCode, {
      orderUser: String(row[2] ?? "").trim(),
      supplier: String(row[6] ?? "").trim(),
      supplierShort: String(row[7] ?? "").trim(),
    });
  });
  return map;
}

async function readPurchaseUndeliveredWorkbook(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return parsePurchaseUndeliveredSheet(csvToRows(await file.text()), "未匹配");
  }
  if (!window.XLSX) throw new Error("XLSX parser is not available.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  return workbook.SheetNames.flatMap((sheetName) => {
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
    return parsePurchaseUndeliveredSheet(rows, getBusinessUnitFromSheetName(sheetName));
  });
}

async function readKingdeeMaterialWorkbook(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    return parseKingdeeMaterialRows(csvToRows(await file.text()), "金蝶物料列表");
  }
  if (!window.XLSX) throw new Error("XLSX parser is not available.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  return workbook.SheetNames.flatMap((sheetName) => {
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
    return parseKingdeeMaterialRows(rows, sheetName);
  });
}

function parseKingdeeMaterialRows(rows, sheetName) {
  const seen = new Set();
  return rows
    .slice(1)
    .map((row) => {
      const materialCode = String(row[2] ?? "").trim();
      const key = normalizeMaterialCode(materialCode);
      if (!key || seen.has(key)) return null;
      seen.add(key);
      return {
        sheetName,
        materialCode,
        sku: String(row[1] ?? "").trim(),
        itemName: String(row[3] ?? row[4] ?? "").trim(),
        supplier: String(row[5] ?? "").trim(),
      };
    })
    .filter(Boolean);
}

function parsePurchaseUndeliveredSheet(rows, businessUnit) {
  const headerIndex = rows.findIndex((row) => row.some((cell) => hasKnownHeader(cell)));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const headerMap = createHeaderMap(headers);
  if (headerMap.materialCode === undefined) {
    const inferredColumn = inferMaterialCodeColumn(headers, rows.slice(headerIndex + 1), new Set(Object.values(headerMap)));
    if (inferredColumn !== undefined) headerMap.materialCode = inferredColumn;
  }
  if (headerMap.materialCode === undefined) return [];
  return rows
    .slice(headerIndex + 1)
    .map((row) => ({
      businessUnit,
      materialCode: getRowValue(row, headerMap.materialCode),
      sku: getRowValue(row, headerMap.sku),
      itemName: getRowValue(row, headerMap.itemName),
      supplier: getRowValue(row, headerMap.supplier),
      supplierShort: getRowValue(row, headerMap.supplierShort),
      orderUser: getRowValue(row, headerMap.orderUser),
      orderedQty: parseNumber(getRowValue(row, headerMap.orderedQty)),
      shippedQty: parseNumber(getRowValue(row, headerMap.shippedQty)),
      remainingQty: parseNumber(getRowValue(row, headerMap.remainingQty)),
    }))
    .filter((row) => row.materialCode || row.sku || row.itemName);
}

async function readWorkbookRows(file, preferredSheetName = "") {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return csvToRows(await file.text());
  if (!window.XLSX) throw new Error("XLSX parser is not available.");
  const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames.find((name) => preferredSheetName && name.includes(preferredSheetName)) || workbook.SheetNames[0];
  return window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
}

function createHeaderMap(headers) {
  return Object.fromEntries(
    Object.entries(orderColumnAliases)
      .map(([key, aliases]) => {
        const index = headers.findIndex((header) => aliases.some((alias) => normalizeHeader(header) === normalizeHeader(alias)));
        return [key, index >= 0 ? index : undefined];
      })
      .filter(([, index]) => index !== undefined)
  );
}

function hasKnownHeader(value) {
  const header = normalizeHeader(value);
  return Object.values(orderColumnAliases).some((aliases) => aliases.some((alias) => normalizeHeader(alias) === header));
}

function inferMaterialCodeColumn(headers, dataRows, usedColumns) {
  const candidates = headers.map((_, index) => index).filter((index) => !usedColumns.has(index));
  let bestColumn;
  let bestScore = 0;
  candidates.forEach((column) => {
    const score = dataRows.slice(0, 50).reduce((sum, row) => sum + scoreMaterialCodeCell(row[column]), 0);
    if (score > bestScore) {
      bestColumn = column;
      bestScore = score;
    }
  });
  return bestScore >= 3 ? bestColumn : undefined;
}

function scoreMaterialCodeCell(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const normalized = normalizeMaterialCode(raw);
  if (normalized.length < 4 || /[\u4e00-\u9fff]/.test(normalized)) return 0;
  let score = 1;
  if (/\d/.test(normalized)) score += 2;
  if (/^[a-z0-9._-]+$/i.test(normalized)) score += 1;
  return score;
}

function handleFilterBarClick(event) {
  const toggle = event.target.closest("[data-filter-toggle]");
  if (toggle) {
    const config = getFilterConfig(toggle.dataset.filterToggle);
    if (!config) return;
    closeFilterMenus(config.key);
    config.element.classList.toggle("open");
    return;
  }

  const option = event.target.closest("[data-filter-option]");
  if (!option) return;
  toggleFilterOption(option.dataset.filterKey, option.dataset.filterOption);
  applyMissingFilters();
}

function renderFilterShell(config) {
  config.element.innerHTML = `
    <button class="multi-filter-button" type="button" data-filter-toggle="${config.key}">
      <span>${config.label}</span>
      <i aria-hidden="true">\u25be</i>
    </button>
    <div class="multi-filter-menu" role="menu"></div>
  `;
}

function updateMissingFilterOptions() {
  syncFilterOptions(maintainTableFilterConfig, getOptionRowsForFilter(maintainTableFilterConfig));
  syncFilterOptions(missingFieldFilterConfig, getOptionRowsForFilter(missingFieldFilterConfig));
  syncFilterOptions(maintainTableFilterConfig, getOptionRowsForFilter(maintainTableFilterConfig));
}

function syncFilterOptions(config, scopedRows) {
  const options = getOptionsFromRows(scopedRows, config.optionKey);
  const selectedSet = missingState[config.selectedKey];
  const availableValues = new Set(options.map((option) => option.value));
  [...selectedSet].forEach((value) => {
    if (!availableValues.has(value)) selectedSet.delete(value);
  });

  const button = config.element.querySelector(".multi-filter-button span");
  const menu = config.element.querySelector(".multi-filter-menu");
  const selectedValues = [...selectedSet];
  button.textContent = getFilterButtonLabel(config, selectedValues);
  menu.innerHTML = `
    <label class="multi-filter-option ${selectedValues.length ? "" : "selected"}" data-filter-key="${config.key}" data-filter-option="all">
      <input type="checkbox" ${selectedValues.length ? "" : "checked"} />
      <span>${config.label}</span>
    </label>
    ${options
      .map(
        (option) => `
          <label class="multi-filter-option ${selectedSet.has(option.value) ? "selected" : ""}" data-filter-key="${config.key}" data-filter-option="${escapeAttribute(option.value)}">
            <input type="checkbox" ${selectedSet.has(option.value) ? "checked" : ""} />
            <span>${escapeHtml(option.label)}</span>
          </label>`
      )
      .join("")}
  `;
}

function getOptionRowsForFilter(config) {
  const filters = getMissingFilterValues();
  return filterMissingRows({
    ...filters,
    [config.key]: [],
  });
}

function getOptionsFromRows(rows, optionKey) {
  return [...new Set(rows.map((row) => row[optionKey]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "zh-CN"))
    .map((value) => ({ value, label: value }));
}

function getFilterButtonLabel(config, selectedValues) {
  if (!selectedValues.length) return config.label;
  if (selectedValues.length === 1) return selectedValues[0];
  if (selectedValues.length === 2) return selectedValues.join("、");
  return `已选${selectedValues.length}项`;
}

function toggleFilterOption(key, value) {
  const config = getFilterConfig(key);
  if (!config) return;
  const selectedSet = missingState[config.selectedKey];
  if (value === "all") {
    selectedSet.clear();
  } else if (selectedSet.has(value)) {
    selectedSet.delete(value);
  } else {
    selectedSet.add(value);
  }
}

function getFilterConfig(key) {
  return missingFilterConfigs.find((config) => config.key === key);
}

function closeFilterMenus(activeKey = "") {
  missingFilterConfigs.forEach((config) => {
    if (config.key !== activeKey) config.element.classList.remove("open");
  });
}

function renderMissing(rows, message = "") {
  missingState.rows = rows;
  missingState.message = message;
  applyMissingFilters();
}

function applyMissingFilters() {
  updateMissingFilterOptions();
  missingState.filteredRows = filterMissingRows(getMissingFilterValues());
  renderMissingView();
}

function getMissingFilterValues() {
  return {
    maintainTable: [...missingState.selectedMaintainTables],
    missingField: [...missingState.selectedMissingFields],
  };
}

function filterMissingRows(filters) {
  return missingState.rows.filter(
    (row) =>
      matchesFilter(row.maintainTable, filters.maintainTable) &&
      matchesFilter(row.missingField, filters.missingField)
  );
}

function matchesFilter(value, selectedValues = []) {
  return !selectedValues?.length || selectedValues.includes(value);
}

function renderMissingView() {
  const rows = missingState.filteredRows;
  const message = missingState.message;
  const categoryRows = rows.filter((row) => row.maintainTable === CATEGORY_TABLE);
  const purchaseRows = rows.filter((row) => row.maintainTable === PURCHASE_TABLE);
  const materialCodes = new Set(rows.map((row) => normalizeMaterialCode(row.materialCode)).filter(Boolean));
  missingEls.materialCount.textContent = formatNumber(materialCodes.size);
  missingEls.categoryCount.textContent = formatNumber(categoryRows.length);
  missingEls.purchaseCount.textContent = formatNumber(purchaseRows.length);
  missingEls.orderRowCount.textContent = formatNumber(sumBy(rows, "rowCount"));
  missingEls.state.textContent = message || (rows.length ? `待维护 ${rows.length} 条` : "暂无缺失");
  missingEls.downloadButton.disabled = Boolean(message) || !rows.length;
  missingEls.rows.innerHTML = rows.length
    ? rows.map(renderMissingRow).join("")
    : `<tr><td colspan="13" class="empty-table-cell">${escapeHtml(message || "暂无缺失")}</td></tr>`;
}

function renderMissingRow(row) {
  return `
    <tr>
      <td>${escapeHtml(row.maintainTable || "--")}</td>
      <td>${escapeHtml(row.missingField || "--")}</td>
      <td>${escapeHtml(row.businessUnits || "--")}</td>
      <td>${escapeHtml(row.materialCode || "--")}</td>
      <td>${escapeHtml(row.sku || "--")}</td>
      <td>${escapeHtml(row.itemName || "--")}</td>
      <td>${escapeHtml(row.supplier || "--")}</td>
      <td>${escapeHtml(row.supplierShort || "--")}</td>
      <td>${escapeHtml(row.orderUser || "--")}</td>
      <td>${formatNumber(row.rowCount)}</td>
      <td>${formatNumber(row.orderedQty)}</td>
      <td>${formatNumber(row.shippedQty)}</td>
      <td>${formatNumber(row.remainingQty)}</td>
    </tr>
  `;
}

function downloadMissingRows() {
  if (!missingState.filteredRows.length || !window.XLSX) return;
  const exportRows = missingState.filteredRows.map((row) => ({
    维护维度表: row.maintainTable,
    待维护字段: row.missingField,
    事业部: row.businessUnits,
    物料编码: row.materialCode,
    SKU: row.sku,
    物品名称: row.itemName,
    供应商: row.supplier,
    供应商简称: row.supplierShort,
    采购下单人: row.orderUser,
    订单行数: row.rowCount,
    下单数量: row.orderedQty,
    发货数量: row.shippedQty,
    剩余数量: row.remainingQty,
  }));
  const worksheet = window.XLSX.utils.json_to_sheet(exportRows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "待维护明细");
  window.XLSX.writeFile(workbook, `待维护明细_${formatDateForFileName(new Date())}.xlsx`);
}

function updateSourceNote(purchaseRecord, kingdeeMaterialRecord) {
  const times = [purchaseRecord, kingdeeMaterialRecord]
    .map((record) => record?.appliedAt || record?.savedAt || "")
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  const latestTime = times.length ? new Date(Math.max(...times.map((date) => date.getTime()))).toISOString() : "";
  const factNames = [
    purchaseRecord?.file ? "采购未交付表" : "",
    kingdeeMaterialRecord?.file ? "金蝶物料列表" : "",
  ].filter(Boolean).join("、") || "--";
  missingEls.sourceNote.textContent = `${SOURCE_LABEL}｜事实表：${factNames}｜引用时间：${latestTime ? formatDateTime(latestTime) : "--"}`;
}

function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      [DIMENSION_STORE_NAME, FACT_STORE_NAME].forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "id" });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getRecord(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function getAppliedLibraryRecord(record) {
  return record?.applied && record?.file ? record : null;
}

function getBusinessUnitFromSheetName(sheetName) {
  const name = String(sheetName || "").trim();
  return name.replace(/[（(].*?[）)]/g, "").trim() || name || "未匹配";
}

function getRowValue(row, index) {
  return index === undefined ? "" : String(row[index] ?? "").trim();
}

function csvToRows(text) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => line.split(",").map((cell) => cell.trim()));
}

function normalizeHeader(value) {
  return String(value || "").trim().replace(/\s+/g, "").replace(/[()（）]/g, "").toLowerCase();
}

function normalizeMaterialCode(value) {
  return String(value || "").trim().replace(/\.0$/, "").toLowerCase();
}

function parseNumber(value) {
  const number = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(number) ? number : 0;
}

function sumBy(items, key) {
  return items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatDateForFileName(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

initMissingDashboard();
