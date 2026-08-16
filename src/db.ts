import { defaultBudgetItems, defaultSettings } from "./seed";
import type { AppSettings, AppState, BudgetItem, BudgetPlanVersion, ImportMetadata, Transaction } from "./types";

const dbName = "zaim-budget-pwa";
const dbVersion = 2;

type StoreName = "transactions" | "metadata" | "budgetItems" | "budgetPlanVersions" | "settings";

export async function loadState(): Promise<AppState> {
  const db = await openDb();
  const [rawTransactions, rawMetadata, budgetItems, budgetPlanVersions, settings] = await Promise.all([
    getAll<Transaction>(db, "transactions"),
    getOne<ImportMetadata>(db, "metadata", "current"),
    getAll<BudgetItem>(db, "budgetItems"),
    getAll<BudgetPlanVersion>(db, "budgetPlanVersions"),
    getOne(db, "settings", "current")
  ]);

  const transactions = rawTransactions.map(normalizeTransaction);
  const metadata = rawMetadata ? normalizeMetadata(rawMetadata, transactions) : null;
  const storedBudgets = budgetItems.length > 0 ? budgetItems.sort((a, b) => a.displayOrder - b.displayOrder) : defaultBudgetItems;
  const needsBudgetMigration = shouldMigrateBudgetItems(storedBudgets);
  const sortedBudgets = needsBudgetMigration ? defaultBudgetItems : storedBudgets;
  let sortedVersions = budgetPlanVersions.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));

  if (rawTransactions.some((transaction) => !transaction.fingerprint)) {
    await replaceAll(db, "transactions", transactions);
  }
  if (rawMetadata && (!rawMetadata.monthCount || !rawMetadata.yearCount)) {
    await put(db, "metadata", { ...metadata, id: "current" });
  }
  if (budgetItems.length === 0 || needsBudgetMigration) {
    await replaceAll(db, "budgetItems", sortedBudgets);
  }
  if (needsBudgetMigration) {
    const effectiveMonth = monthKey(new Date().toISOString());
    const migratedVersion = {
      id: effectiveMonth,
      effectiveMonth,
      items: sortedBudgets,
      createdAt: new Date().toISOString()
    };
    await put(db, "budgetPlanVersions", migratedVersion);
    sortedVersions = [...sortedVersions.filter((version) => version.id !== effectiveMonth), migratedVersion]
      .sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  }
  if (sortedVersions.length === 0) {
    await replaceAll(db, "budgetPlanVersions", [initialBudgetPlanVersion(sortedBudgets, transactions)]);
  }
  if (!settings) {
    await put(db, "settings", { ...defaultSettings, id: "current" });
  }

  return {
    transactions,
    metadata: metadata ?? null,
    budgetItems: sortedBudgets,
    budgetPlanVersions: sortedVersions.length > 0 ? sortedVersions : [initialBudgetPlanVersion(sortedBudgets, transactions)],
    settings: settings ? stripId(settings as typeof defaultSettings & { id: string }) : defaultSettings
  };
}

export async function saveImport(transactions: Transaction[], metadata: ImportMetadata): Promise<AppState> {
  const db = await openDb();
  await replaceAll(db, "transactions", transactions);
  await put(db, "metadata", { ...metadata, id: "current" });
  const state = await loadState();
  return state;
}

export async function saveBudgetItems(budgetItems: BudgetItem[]): Promise<void> {
  const db = await openDb();
  await replaceAll(db, "budgetItems", budgetItems);
}

export async function saveBudgetPlanVersion(version: BudgetPlanVersion, latestBudgetItems: BudgetItem[]): Promise<AppState> {
  const db = await openDb();
  await replaceAll(db, "budgetItems", latestBudgetItems);
  await put(db, "budgetPlanVersions", version);
  return loadState();
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await openDb();
  await put(db, "settings", { ...settings, id: "current" });
}

export async function clearData(): Promise<AppState> {
  const db = await openDb();
  await clearStore(db, "transactions");
  await clearStore(db, "metadata");
  return loadState();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("transactions")) {
        db.createObjectStore("transactions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("metadata")) {
        db.createObjectStore("metadata", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("budgetItems")) {
        db.createObjectStore("budgetItems", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("budgetPlanVersions")) {
        db.createObjectStore("budgetPlanVersions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAll<T>(db: IDBDatabase, storeName: StoreName): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function getOne<T>(db: IDBDatabase, storeName: StoreName, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function replaceAll<T extends { id: string }>(db: IDBDatabase, storeName: StoreName, values: T[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    store.clear();
    values.forEach((value) => store.put(value));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function put<T extends { id: string }>(db: IDBDatabase, storeName: StoreName, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(db: IDBDatabase, storeName: StoreName): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readwrite").objectStore(storeName).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function stripId<T>(value: T & { id: string }): T {
  const { id: _id, ...rest } = value;
  return rest as T;
}

function shouldMigrateBudgetItems(items: BudgetItem[]): boolean {
  const defaultIds = new Set(defaultBudgetItems.map((item) => item.id));
  return items.length !== defaultBudgetItems.length || items.some((item) => !defaultIds.has(item.id));
}

function normalizeTransaction(transaction: Transaction): Transaction {
  if (transaction.fingerprint) return transaction;
  return {
    ...transaction,
    fingerprint: stableFingerprint([
      transaction.date,
      transaction.method,
      transaction.category ?? "",
      transaction.subcategory ?? "",
      transaction.fromAccount ?? "",
      transaction.toAccount ?? "",
      transaction.item ?? "",
      transaction.memo ?? "",
      transaction.shop ?? "",
      transaction.currency,
      String(transaction.incomeAmount),
      String(transaction.expenseAmount),
      String(transaction.transferAmount),
      String(transaction.balanceAdjustmentAmount),
      String(transaction.originalAmount),
      transaction.aggregationSetting
    ])
  };
}

function normalizeMetadata(metadata: ImportMetadata, transactions: Transaction[]): ImportMetadata {
  if (metadata.monthCount && metadata.yearCount) return metadata;
  const months = new Set(transactions.map((transaction) => monthKey(transaction.date)));
  const years = new Set(Array.from(months).map((month) => month.slice(0, 4)));
  return {
    ...metadata,
    monthCount: months.size,
    yearCount: years.size
  };
}

function initialBudgetPlanVersion(items: BudgetItem[], transactions: Transaction[]): BudgetPlanVersion {
  const months = transactions.map((transaction) => monthKey(transaction.date)).sort();
  const effectiveMonth = months[0] ?? monthKey(new Date().toISOString());
  return {
    id: effectiveMonth,
    effectiveMonth,
    items,
    createdAt: new Date().toISOString()
  };
}

function monthKey(dateValue: string): string {
  const date = new Date(dateValue);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function stableFingerprint(parts: string[]): string {
  let hash = 2166136261;
  const text = parts.join("\u001f");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `z${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
