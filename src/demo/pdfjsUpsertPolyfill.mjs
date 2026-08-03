// pdfjs-dist 6.1.200 は TC39 の「Map/Set upsert」提案（Map.prototype.getOrInsertComputed /
// WeakMap.prototype.getOrInsertComputed）に依存しており、メインスレッド側バンドルで 15 箇所、
// worker 側バンドル（pdf.worker.min.mjs）で 12 箇所これを呼び出している。この提案はまだ
// TC39 Stage 2 相当で、動画収録に使う環境の Chromium 141 には実装されていないため、
// 未対応のまま PDF を開こうとすると `TypeError: map.getOrInsertComputed is not a function` で
// 描画が失敗する（#/verify のハイライト実演＝本 PR の最重要成果が成立しなくなる）。
//
// 【これはデモビルド限定の回避策であり、本番の別課題を消してはいない】
// 本番ビルド（`npm run build` / `npm run dev`）はこのファイルを一切参照しない
// （webpack.config.js の isDemo 分岐参照）。そのため「利用者の Chrome が古く
// getOrInsertComputed 未実装」という状況で本番ビルドの PDF 描画が同様に失敗する問題は、
// このポリフィルでは解決していない別課題として残る（対応するなら pdfjs-dist の
// バージョン選定 or 本番ビルドにも同様のポリフィルを常設する、のいずれかを別 issue で検討する）。
//
// 仕様: キーが存在すればその値を返す。無ければ callbackFn(key) の結果を set して返す
// （TC39 提案の仕様どおり。参照: https://github.com/tc39/proposal-upsert）。
//
// 注入箇所は 2 つ（Map / WeakMap のどちらも対象）:
//   1. メインスレッド: src/demo/bootShared.ts の先頭（実物のエントリを import するより前）
//   2. worker: webpack.config.js が pdf.worker.min.mjs を dist-demo/ へコピーするときの
//      CopyWebpackPlugin transform で、このファイルのソースをそのまま worker バンドルの先頭へ
//      文字列として連結する（worker はモジュールとして直接 import できないため）

/** ctor.prototype に getOrInsertComputed が無いときだけ実装を足す（既にあれば何もしない） */
function installGetOrInsertComputed(ctor) {
  if (typeof ctor === 'undefined' || typeof ctor.prototype.getOrInsertComputed === 'function') {
    return;
  }
  ctor.prototype.getOrInsertComputed = function getOrInsertComputed(key, callbackFn) {
    if (this.has(key)) {
      return this.get(key);
    }
    const value = callbackFn(key);
    this.set(key, value);
    return value;
  };
}

/** メインスレッド用: Map / WeakMap の両方へポリフィルを当てる */
export function installPdfjsUpsertPolyfill() {
  installGetOrInsertComputed(typeof Map !== 'undefined' ? Map : undefined);
  installGetOrInsertComputed(typeof WeakMap !== 'undefined' ? WeakMap : undefined);
}
