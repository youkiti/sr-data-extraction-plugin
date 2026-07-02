// タイムスタンプは全タブ共通で ISO 8601（UTC）に統一する（requirements.md §3.2）
export function nowIso8601(): string {
  return new Date().toISOString();
}
