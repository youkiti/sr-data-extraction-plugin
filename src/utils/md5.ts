// MD5 ハッシュ（RFC 1321）の純 TypeScript 実装。
// WebCrypto（crypto.subtle.digest）は MD5 を提供しないため自前で実装する。
// 用途はローカル取り込み PDF の重複判定（Drive API の md5Checksum との突き合わせ。issue #102）
// のみで、セキュリティ用途（署名・パスワード等）には使わない。

/** ラウンドごとの左回転量（RFC 1321 の s テーブル） */
const SHIFTS: readonly number[] = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
  14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
  21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/** 加算定数 K[i] = floor(|sin(i + 1)| * 2^32)（RFC 1321 の T テーブル） */
const CONSTANTS: Uint32Array = (() => {
  const table = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    table[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);
  }
  return table;
})();

/** 32bit 左回転 */
function rotateLeft(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

/** 32bit 値をリトルエンディアンのバイト順で 16 進文字列にする（MD5 のダイジェスト表記） */
function toLeHex(value: number): string {
  let hex = '';
  for (let i = 0; i < 4; i++) {
    hex += ((value >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * ArrayBuffer の MD5 を小文字 16 進 32 文字で返す。
 * Drive API `files.get?fields=md5Checksum` の返す値と同形式（突き合わせにそのまま使える）
 */
export function md5Hex(data: ArrayBuffer): string {
  const message = new Uint8Array(data);
  // パディング: 0x80 + 0x00 詰め + 末尾 64bit リトルエンディアンのビット長（512bit 境界へ揃える）
  const paddedLength = ((((message.length + 8) >> 6) + 1) << 6) >>> 0;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(message);
  buffer[message.length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bitLength = message.length * 8;
  view.setUint32(paddedLength - 8, bitLength >>> 0, true);
  view.setUint32(paddedLength - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const words = new Uint32Array(16);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let j = 0; j < 16; j++) {
      words[j] = view.getUint32(offset + j * 4, true);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const rotated = rotateLeft(
        (a + f + (CONSTANTS[i] as number) + (words[g] as number)) >>> 0,
        SHIFTS[i] as number,
      );
      const next = (b + rotated) >>> 0;
      a = d;
      d = c;
      c = b;
      b = next;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return toLeHex(a0) + toLeHex(b0) + toLeHex(c0) + toLeHex(d0);
}
