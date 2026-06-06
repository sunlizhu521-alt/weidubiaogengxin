const DB_NAME = "supply-chain-library";
const DB_VERSION = 3;
const LOCAL_LIBRARY_SOURCE = "local-upload";
const LIBRARY_UNLOCK_KEYS = ["dimension-library-key-unlocked-v2", "fact-library-key-unlocked-v2"];

const librarySlots = [
  {
    store: "fact-files",
    id: "fact-1",
    library: "\u4e8b\u5b9e\u8868",
    label: "物料收发汇总表",
  },
  {
    store: "fact-files",
    id: "fact-2",
    library: "\u4e8b\u5b9e\u8868",
    label: "销售出库汇总报表",
  },
  {
    store: "fact-files",
    id: "fact-3",
    library: "\u4e8b\u5b9e\u8868",
    label: "金蝶物料列表",
  },
  {
    store: "fact-files",
    id: "fact-4",
    library: "\u4e8b\u5b9e\u8868",
    label: "金蝶客户列表",
  },
  {
    store: "fact-files",
    id: "fact-5",
    library: "\u4e8b\u5b9e\u8868",
    label: "采购分工表",
  },
  {
    store: "fact-files",
    id: "fact-6",
    library: "\u4e8b\u5b9e\u8868",
    label: "采购未交付表",
  },
];

const adminEls = {
  slots: document.querySelector("#adminLibrarySlots"),
  oneClickApplyButton: document.querySelector("#oneClickApplyButton"),
  clearCacheButton: document.querySelector("#clearLibraryCacheButton"),
  referenceState: document.querySelector("#adminReferenceState"),
  referenceRows: document.querySelector("#adminReferenceRows"),
};

const adminState = {
  records: new Map(),
};

function bindAdminEvents() {
  adminEls.slots.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-admin-upload]");
    if (!input) return;
    await saveFile(input.dataset.adminUpload, input.files[0]);
    input.value = "";
  });

  adminEls.slots.addEventListener("click", async (event) => {
    const applyButton = event.target.closest("[data-admin-apply]");
    if (applyButton) {
      await applySlot(applyButton.dataset.adminApply);
      return;
    }

    const deleteButton = event.target.closest("[data-admin-delete]");
    if (deleteButton) {
      await deleteSlot(deleteButton.dataset.adminDelete);
    }
  });

  adminEls.slots.addEventListener("dragover", (event) => {
    const card = event.target.closest("[data-admin-drop]");
    if (!card) return;
    event.preventDefault();
    card.classList.add("drag-over");
  });

  adminEls.slots.addEventListener("dragleave", (event) => {
    const card = event.target.closest("[data-admin-drop]");
    if (!card || card.contains(event.relatedTarget)) return;
    card.classList.remove("drag-over");
  });

  adminEls.slots.addEventListener("drop", async (event) => {
    const card = event.target.closest("[data-admin-drop]");
    if (!card) return;
    event.preventDefault();
    card.classList.remove("drag-over");
    const file = event.dataTransfer?.files?.[0];
    await saveFile(card.dataset.adminDrop, file);
  });

  adminEls.oneClickApplyButton.addEventListener("click", applyAllSlots);
  adminEls.clearCacheButton.addEventListener("click", clearLibraryCache);
}

async function refreshAdmin() {
  const db = await openAppDb();
  const entries = await Promise.all(
    librarySlots.map(async (slot) => [slot.id, await getRecord(db, slot.store, slot.id)])
  );
  db.close();
  adminState.records = new Map(entries);
  renderLibrarySlots();
  renderReferenceRows();
}

async function saveFile(slotId, file) {
  if (!file) return;
  const slot = getSlot(slotId);
  const savedAt = new Date().toISOString();
  const existing = adminState.records.get(slotId) || { id: slotId };
  const record = {
    ...existing,
    id: slotId,
    pendingFile: file,
    pendingName: file.name,
    pendingSize: file.size,
    pendingTypeLabel: getFileTypeLabel(file),
    pendingRefreshMonth: getMonthFromDate(savedAt),
    pendingSavedAt: savedAt,
    pendingLibrarySource: LOCAL_LIBRARY_SOURCE,
  };
  const db = await openAppDb();
  await putRecord(db, slot.store, record);
  db.close();
  await refreshAdmin();
}

async function applySlot(slotId) {
  const slot = getSlot(slotId);
  const record = adminState.records.get(slotId);
  if (!record) return;
  const appliedAt = new Date().toISOString();
  const updatedRecord = createAppliedRecord(record, appliedAt);
  const db = await openAppDb();
  await putRecord(db, slot.store, updatedRecord);
  db.close();
  await refreshAdmin();
}

async function applyAllSlots() {
  const slotsToApply = librarySlots.filter((slot) => {
    const record = adminState.records.get(slot.id);
    return record?.pendingFile || (record && !record.applied);
  });
  if (!slotsToApply.length) return;

  adminEls.oneClickApplyButton.disabled = true;
  adminEls.referenceState.textContent = "应用中";
  let db;
  try {
    db = await openAppDb();
    const appliedAt = new Date().toISOString();
    await Promise.all(
      slotsToApply.map((slot) => putRecord(db, slot.store, createAppliedRecord(adminState.records.get(slot.id), appliedAt)))
    );
    await refreshAdmin();
  } catch (error) {
    console.warn("apply all library slots failed", error);
    adminEls.referenceState.textContent = "应用失败";
  } finally {
    if (db) db.close();
    adminEls.oneClickApplyButton.disabled = false;
  }
}

async function deleteSlot(slotId) {
  const slot = getSlot(slotId);
  const db = await openAppDb();
  await deleteRecord(db, slot.store, slotId);
  db.close();
  await refreshAdmin();
}

async function clearLibraryCache() {
  const confirmed = window.confirm("\u786e\u8ba4\u6e05\u9664\u5f53\u524d\u6d4f\u89c8\u5668\u91cc\u7684\u6240\u6709\u6587\u4ef6\u5e93\u7f13\u5b58\u5417\uff1f\u6e05\u9664\u540e\u9700\u8981\u91cd\u65b0\u4e0a\u4f20\u5e76\u786e\u8ba4\u5e94\u7528\u5237\u65b0\u3002");
  if (!confirmed) return;

  adminEls.clearCacheButton.disabled = true;
  adminEls.referenceState.textContent = "\u6e05\u9664\u4e2d";
  try {
    await deleteLibraryDatabase();
    LIBRARY_UNLOCK_KEYS.forEach((key) => localStorage.removeItem(key));
    adminState.records = new Map();
    renderLibrarySlots();
    renderReferenceRows();
    adminEls.referenceState.textContent = "\u5df2\u6e05\u9664\u7f13\u5b58";
  } catch (error) {
    console.warn("clear library cache failed", error);
    adminEls.referenceState.textContent = "\u6e05\u9664\u5931\u8d25";
  } finally {
    adminEls.clearCacheButton.disabled = false;
  }
}

function renderLibrarySlots() {
  adminEls.slots.innerHTML = librarySlots.map(renderLibrarySlot).join("");
}

function renderLibrarySlot(slot) {
  const record = adminState.records.get(slot.id);
  const display = getDisplayRecord(record);
  const isApplied = Boolean(record?.applied && !record.pendingFile);
  const hasPending = Boolean(record?.pendingFile);
  return `
    <article class="admin-file-card ${isApplied ? "applied" : ""}" data-admin-drop="${slot.id}">
      <div class="admin-file-card-head">
        <div>
          <p class="eyebrow">${escapeHtml(slot.library)}</p>
          <h2>${escapeHtml(slot.label)}</h2>
        </div>
        <span class="slot-status ${isApplied ? "applied" : "pending"}">${isApplied ? "\u5df2\u5f15\u7528" : hasPending ? "\u5f85\u5e94\u7528" : "\u672a\u4e0a\u4f20"}</span>
      </div>
      <div class="admin-file-meta">
        <span>${escapeHtml(display?.name || "\u672a\u4e0a\u4f20\u6587\u4ef6")}</span>
        <strong>${display ? `${escapeHtml(display.typeLabel || "\u6587\u4ef6")} / ${formatFileSize(display.size)}` : "--"}</strong>
        <small>\u66f4\u65b0\uff1a${display ? formatDateTime(display.savedAt) : "--"}</small>
        <small>\u53ef\u70b9\u51fb\u4e0a\u4f20\uff0c\u4e5f\u53ef\u62d6\u62fd\u6587\u4ef6\u5230\u6b64\u5904</small>
      </div>
      <div class="admin-file-actions">
        <label class="admin-upload-button">
          <input type="file" accept=".xlsx,.xls,.csv" data-admin-upload="${slot.id}" />
          \u4e0a\u4f20/\u66ff\u6362
        </label>
        <button type="button" data-admin-apply="${slot.id}" ${hasPending || (record && !record.applied) ? "" : "disabled"}>\u786e\u8ba4\u5e94\u7528</button>
        <button class="danger-button" type="button" data-admin-delete="${slot.id}" ${record ? "" : "disabled"}>\u5220\u9664</button>
      </div>
    </article>
  `;
}

function renderReferenceRows() {
  const rows = librarySlots.map((slot) => renderReferenceRow(slot, adminState.records.get(slot.id)));
  adminEls.referenceRows.innerHTML = rows.join("");
  adminEls.referenceState.textContent = "\u672c\u5730\u6587\u4ef6\u5e93";
}

function renderReferenceRow(slot, record) {
  const applied = Boolean(record?.applied);
  return `
    <tr>
      <td>${escapeHtml(slot.library)}</td>
      <td>${escapeHtml(slot.label)}</td>
      <td>${escapeHtml(record?.name || "--")}</td>
      <td>${escapeHtml(record?.refreshMonth || "--")}</td>
      <td>${formatDateTime(record?.savedAt)}</td>
      <td>${formatDateTime(record?.appliedAt || "")}</td>
      <td><span class="slot-status ${applied ? "applied" : "pending"}">${applied ? "\u5df2\u5f15\u7528" : "\u672a\u5f15\u7528"}</span></td>
    </tr>
  `;
}

function getSlot(slotId) {
  return librarySlots.find((slot) => slot.id === slotId);
}

function getDisplayRecord(record) {
  if (!record) return null;
  if (record.pendingFile) {
    return {
      name: record.pendingName,
      size: record.pendingSize,
      typeLabel: record.pendingTypeLabel,
      savedAt: record.pendingSavedAt,
    };
  }
  return record;
}

function clearPendingFields(record) {
  const nextRecord = { ...record };
  delete nextRecord.pendingFile;
  delete nextRecord.pendingName;
  delete nextRecord.pendingSize;
  delete nextRecord.pendingTypeLabel;
  delete nextRecord.pendingRefreshMonth;
  delete nextRecord.pendingSavedAt;
  delete nextRecord.pendingLibrarySource;
  return nextRecord;
}

function createAppliedRecord(record, appliedAt) {
  return record.pendingFile
    ? clearPendingFields({
        ...record,
        file: record.pendingFile,
        name: record.pendingName,
        size: record.pendingSize,
        typeLabel: record.pendingTypeLabel,
        refreshMonth: record.pendingRefreshMonth,
        savedAt: record.pendingSavedAt,
        librarySource: LOCAL_LIBRARY_SOURCE,
        applied: true,
        appliedAt,
      })
    : {
        ...record,
        librarySource: record.librarySource || LOCAL_LIBRARY_SOURCE,
        applied: true,
        appliedAt,
      };
}

function openAppDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      ["uploaded-files", "dimension-files", "fact-files"].forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id" });
        }
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getRecord(db, storeName, key) {
  return runStoreRequest(db, storeName, "readonly", (store) => store.get(key));
}

function putRecord(db, storeName, record) {
  return runStoreRequest(db, storeName, "readwrite", (store) => store.put(record));
}

function deleteRecord(db, storeName, key) {
  return runStoreRequest(db, storeName, "readwrite", (store) => store.delete(key));
}

function runStoreRequest(db, storeName, mode, createRequest) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = createRequest(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteLibraryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("\u6587\u4ef6\u5e93\u6b63\u5728\u88ab\u5176\u4ed6\u9875\u9762\u5360\u7528\uff0c\u8bf7\u5173\u95ed\u5176\u4ed6\u770b\u677f\u9875\u9762\u540e\u91cd\u8bd5"));
  });
}

function getMonthFromDate(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatDateTime(value) {
  if (!value) return "--";
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

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "--";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getFileTypeLabel(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx" || extension === "xls") return "Excel \u5de5\u4f5c\u7c3f";
  if (extension === "csv") return "CSV \u6587\u4ef6";
  return file.type || "\u672a\u77e5\u7c7b\u578b";
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

bindAdminEvents();
refreshAdmin().catch((error) => {
  console.error(error);
  adminEls.referenceState.textContent = "\u8bfb\u53d6\u5931\u8d25";
});
