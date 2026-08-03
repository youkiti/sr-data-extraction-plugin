# デモビルド用 PDF フィクスチャ（動画収録用）

デモビルド（`npm run build:demo` → `dist-demo/`）が「実データ・実 API・OAuth 画面なし」で
動作するために埋め込む論文 PDF。**完全に架空のサンプル論文**であり、実在の研究ではない。

## なぜ架空論文なのか

以前の実装は実在論文（PLoS ONE 2023 の Zarkesh et al.）の書誌情報を Documents タブに表示しつつ、
本文・quote・抽出値は独自の作文だった。この設計は 2 つの理由で不採用にした。

1. 一般公開する操作解説動画で、実在の著者の論文に架空の本文・架空の抽出値が紐づいた画面が映る
   （実在の著者へ架空の内容を帰属させる見た目になる）。
2. ネットワークが通る環境で実 PDF を取得すると、あらかじめ用意していた quote が実際の本文と
   一致せず、**検証画面のハイライトが壊れる**。ハイライトが実際に光ることは動画の最重要成果
   なので、ネットワーク環境によって壊れうる作りは受け入れられない。

姉妹リポジトリ tiab-review-plugin の `video/fixtures/demo-paper.html`（→ `demo-paper.pdf`）に
倣い、**HTML から生成した完全に架空の論文**を使う方式に切り替えた。ネットワーク非依存で、
quote は定義上必ず本文と一致する（下記「単一の正典」参照）。

## 収録論文（いずれも架空）

3 本とも「周術期の介入」という同じ SR プロジェクトに属する体裁にしつつ、それぞれ別の画面を
実演する役割を持つ（詳しくは [`src/demo/seed.ts`](../../src/demo/seed.ts) 冒頭コメント参照）。

| ファイル | テーマ | 群構成 | 役割 |
|---|---|---|---|
| `demo-paper-01.pdf` | 腹部手術後の早期離床プログラム（2 群比較） | 2 群 | 独立二重レビュー完了 + 裁定済み → 裁定画面・κ 一致度レポートの実演用 |
| `demo-paper-02.pdf` | 術後悪心・嘔吐(PONV)予防薬 NX-214 の用量比較試験 | 3 群 | 未抽出・群構成未確定 → `#/extract` のライブ抽出・群構成確定ゲート UI の実演用 |
| `demo-paper-03.pdf` | 心臓手術前の呼吸筋トレーニングによる術後在院日数への効果 | 2 群 | owner 単独で途中まで検証済み → `#/dashboard` の進捗マトリクス・AI 採用率・AI 精度内訳、`#/export` の未検証セル警告の実演用 |

ジャーナル名・著者名・DOI（`10.9999/...`）はすべて架空。各 PDF の本文冒頭には
「本稿は SR Data Extraction Plugin のデモ用に作成した架空のサンプル論文であり、実在の研究では
ない」旨の注記を入れている。

## 単一の正典（本文の文章を 2 箇所でタイプしない）

論文の書誌情報・本文の文章・抽出される値はすべて [`src/demo/paperData.mjs`](../../src/demo/paperData.mjs)
に定義されている。

- `video/fixtures/build-fixtures.mjs` がこのファイルから HTML（`demo-paper-0N.html`。
  本ディレクトリにコミットする）を生成する。
- `src/demo/paperContent.ts` が同じファイルから Evidence の `quote` を組み立てる
  （AI 抽出結果として `#/verify` に表示される根拠箇所）。

同じ文章を HTML と quote の 2 箇所で別々にタイプしないため、「両者がずれる」設計上の欠陥が
そもそも存在しない。唯一の例外は `anchor_status` を意図的に `fuzzy` / `failed` にする 2 件
（`paperContent.ts` に個別コメントあり）で、そこだけ本文の正しい文章とは異なる quote を
意図的に保存している（アンカリングの段階的マッチング・quote 再配置の実演用）。

## 生成方法

```bash
node video/fixtures/build-fixtures.mjs        # 生成済みの PDF はスキップ（冪等）
node video/fixtures/build-fixtures.mjs --force # PDF を強制再生成
# または
npm run video:fixtures
npm run video:fixtures -- --force
```

Playwright の `page.pdf()` で HTML → PDF に変換する（`video/scripts/config.mjs` の
`resolveChromiumExecutable()` で Chromium を解決するため、`video/scripts/setup.sh` で
取得した Playwright Chromium をそのまま使える）。**ネットワークアクセスは一切発生しない。**

- `demo-paper-0N.html` は生成物だがコミット対象（`paperData.mjs` を変更したら
  再実行して差分をコミットすること）。
- `demo-paper-0N.pdf` は `.gitignore` 済み（`video/fixtures/*.pdf`）。クローン後・
  `paperData.mjs` 変更後は上記コマンドで生成し直すこと。

## ページ割りについて（重要）

`src/demo/paperContent.ts` の `FIELD_INSTANCES` が持つ `page`（Evidence.page）は、
`build-fixtures.mjs` が HTML に挿入する明示的な改ページ（`page-break-after: always`）の
位置と 1 対 1 で対応するよう手動で合わせてある。`paperData.mjs` の内容を追加・変更して
1 ページに収まらなくなると、実際の PDF ページ番号と `FIELD_INSTANCES` の `page` がずれる
可能性があるため、内容を大きく変える場合は生成後に PDF のページ数・レイアウトを目視確認
すること。
