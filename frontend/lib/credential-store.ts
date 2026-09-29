/**
 * 本机登录态（可选记忆）。
 *
 * 只在用户选择记住时，将单个 API Key 写入本机 localStorage。
 * 读取旧版双凭据格式时自动提取模型 API Key 并迁移。
 */

const STORAGE_KEY = "dragon-legend-rag.login.v1";

export interface StoredCredentials {
  accessKey: string;
  llmApiKey: string;
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null; // 隐私模式等场景下不可用
  }
}

export function loadStoredCredentials(): StoredCredentials | null {
  const store = safeStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { apiKey?: string; accessKey?: string; llmApiKey?: string };
    const apiKey = parsed.apiKey || parsed.llmApiKey;
    if (!apiKey) return null;
    if (parsed.apiKey !== apiKey) {
      store.setItem(STORAGE_KEY, JSON.stringify({ apiKey }));
    }
    return { accessKey: apiKey, llmApiKey: apiKey };
  } catch {
    return null;
  }
}

export function saveStoredCredentials(creds: StoredCredentials): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ apiKey: creds.llmApiKey }));
  } catch {
    /* 静默：写入失败不影响本次会话 */
  }
}

export function clearStoredCredentials(): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* 静默 */
  }
}

export function hasStoredCredentials(): boolean {
  return loadStoredCredentials() !== null;
}
