// UUID v4 の生成（Web Crypto。MV3 / jsdom の双方で利用可能）
export function generateUuid(): string {
  return crypto.randomUUID();
}
