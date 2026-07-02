// シークレット（API キー・OAuth トークン等）をログへ出すときの省略表記。
// 生の値をログ / アーティファクト / UI に出すことは禁止（CLAUDE.md 作業原則 5）
export function sanitizeSecret(secret: string): string {
  if (secret.length <= 8) {
    return '***';
  }
  return `${secret.substring(0, 8)}...`;
}
