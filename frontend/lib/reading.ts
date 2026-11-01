export interface ReadingPreferences {
  font: "sans" | "serif";
  size: 16 | 18 | 20;
  spacing: "standard" | "relaxed";
}
export const READING_DEFAULTS: ReadingPreferences = {font:"sans",size:18,spacing:"standard"};
const KEY = "dragon-legend-rag.reading.v1";
export function normalizeReading(value: unknown): ReadingPreferences {
  const p = value && typeof value === "object" ? value as Partial<ReadingPreferences> : {};
  return {font:p.font === "serif" ? "serif" : "sans",size:p.size === 16 || p.size === 20 ? p.size : 18,spacing:p.spacing === "relaxed" ? "relaxed" : "standard"};
}
export function loadReading(): ReadingPreferences {
  try { return normalizeReading(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return {...READING_DEFAULTS}; }
}
export function saveReading(preferences: ReadingPreferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(normalizeReading(preferences))); } catch { /* preferences still apply to this page */ }
}
