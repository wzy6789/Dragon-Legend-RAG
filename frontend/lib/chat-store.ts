import type { Conversation } from "./types";

/**
 * 会话本地持久层（IndexedDB）。
 *
 * 安全边界：这里只存会话内容（标题、消息、来源、档位、时间戳）。
 * 访问密码与 API Key 永远不会写入此处，也不会进入任何浏览器存储。
 */

const DB_NAME = "dragon-legend-rag";
const DB_VERSION = 1;
const STORE = "conversations";

function hasIDB(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
        t.oncomplete = () => db.close();
      }),
  );
}

/** 全部会话，按更新时间倒序 */
export async function listConversations(): Promise<Conversation[]> {
  if (!hasIDB()) return [];
  try {
    const all = await tx<Conversation[]>("readonly", (store) => store.getAll() as IDBRequest<Conversation[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  if (!hasIDB()) return undefined;
  try {
    return await tx<Conversation | undefined>("readonly", (store) => store.get(id) as IDBRequest<Conversation | undefined>);
  } catch {
    return undefined;
  }
}

export async function putConversation(conv: Conversation): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx("readwrite", (store) => store.put(conv) as IDBRequest<IDBValidKey>);
  } catch {
    /* 静默：持久化失败不影响对话 */
  }
}

export async function deleteConversation(id: string): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx("readwrite", (store) => store.delete(id) as IDBRequest<undefined>);
  } catch {
    /* 静默 */
  }
}

export async function clearConversations(): Promise<void> {
  if (!hasIDB()) return;
  try {
    await tx("readwrite", (store) => store.clear() as IDBRequest<undefined>);
  } catch {
    /* 静默 */
  }
}
