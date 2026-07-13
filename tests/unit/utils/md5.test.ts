// md5Hex（RFC 1321 の純 TS 実装）のテスト。期待値は RFC 1321 付録 A.5 のテストスイート
import { md5Hex } from '../../../src/utils/md5';

/** ASCII 文字列を ArrayBuffer にする（テストベクタは全て ASCII） */
function ascii(text: string): ArrayBuffer {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i);
  }
  return bytes.buffer;
}

describe('md5Hex', () => {
  test('空入力（パディングのみの 1 ブロック）', () => {
    expect(md5Hex(ascii(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  test('RFC 1321 テストベクタ（1 ブロック内）', () => {
    expect(md5Hex(ascii('a'))).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5Hex(ascii('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(ascii('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Hex(ascii('abcdefghijklmnopqrstuvwxyz'))).toBe(
      'c3fcd3d76192e4007dfb496cca67e13b',
    );
  });

  test('パディングで 2 ブロック目へあふれる入力（62 バイト）', () => {
    expect(
      md5Hex(ascii('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')),
    ).toBe('d174ab98d277d9f5a5611c2c9f419d9f');
  });

  test('複数ブロックの入力（80 バイト）', () => {
    expect(
      md5Hex(
        ascii('12345678901234567890123456789012345678901234567890123456789012345678901234567890'),
      ),
    ).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  test('バイナリ入力（0x00 と 0xff を含む）でも Drive の md5Checksum 形式（小文字 hex 32 桁）を返す', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f]);
    const digest = md5Hex(bytes.buffer);
    expect(digest).toMatch(/^[0-9a-f]{32}$/);
    // 同一内容は同一ダイジェスト（重複判定の前提）
    expect(md5Hex(new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x7f]).buffer)).toBe(digest);
  });
});
