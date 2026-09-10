/**
 * 本机登录态（可选记忆）。
 *
 * 说明：默认登录页勾选「在这台电脑上记住登录」后，才把凭据写入本机 localStorage，
 * 以便同一台电脑再次打开网站时免去重复填写；取消勾选或点击「退出当前连接」会立即清除。
 * 不勾选时凭据只存在于 React 内存。
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
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (!parsed.accessKey || !parsed.llmApiKey) return null;
    return { accessKey: parsed.accessKey, llmApiKey: parsed.llmApiKey };
  } catch {
    return null;
  }
}

export function saveStoredCredentials(creds: StoredCredentials): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(creds));
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
