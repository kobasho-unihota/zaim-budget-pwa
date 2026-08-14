import { defaultBudgetItems, defaultSettings } from "./seed";
import type { AppSettings, AppState, BudgetItem, ImportMetadata, Transaction } from "./types";

const dbName = "zaim-budget-pwa";
const dbVersion = 1;

type StoreName = "transactions" | "metadata" | "budgetItems" | "settings";

export async function loadState(): Promise<AppState> {
  const db = await openDb();
  const [transactions, metadata, budgetItems, settings] = await Promise.all([
    getAll<Transaction>(db, "transactions"),
    getOne<ImportMetadata>(db, "metadata", "current"),
    getAll<BudgetItem>(db, "budgetItems"),
    getOne(db, "settings", "current")
  ]);

  if (budgetItems.length === 0) {
    await replaceAll(db, "budgetItems", defaultBudgetItems);
  }
  if (!settings) {
    await put(db, "settings", { ...defaultSettings, id: "current" });
  }

  return {
    transactions,
    metadata: metadata ?? null,
    budgetItems: budgetItems.length > 0 ? budgetItems.sort((a, b) => a.displayOrder - b.displayOrder) : defaultBudgetItems,
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
