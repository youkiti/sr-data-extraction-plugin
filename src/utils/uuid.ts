// UUID v4 の生成（Web Crypto。MV3 / jsdom の双方で利用可能）
export function generateUuid(): string {
  return crypto.randomUUID();
}

/** UUID の先頭 8 文字を返す（Drive フォルダ名などの短縮表示用） */
export function shortUuid(uuid: string): string {
  return uuid.slice(0, 8);
}
