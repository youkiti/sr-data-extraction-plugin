# デモビルド用 PDF フィクスチャ（動画収録用）

デモビルド（`npm run build:demo` → `dist-demo/`）が「実データ・実 API・OAuth 画面なし」で
動作するために埋め込む実論文 PDF。**PDF 本体はリポジトリにコミットしない**
（`tests/fixtures/pdf/` と同じ運用。`.gitignore` 済み）。クローン後は以下で取得する。

```bash
bash video/fixtures/fetch-fixtures.sh
```

## 収録論文

| ファイル | ID | DOI | ジャーナル | ライセンス |
|---|---|---|---|---|
| `PMC10715657_plosone_udca_rct.pdf` | [PMC10715657](https://pmc.ncbi.nlm.nih.gov/articles/PMC10715657/) | [10.1371/journal.pone.0273516](https://doi.org/10.1371/journal.pone.0273516) | PLoS One 2023 / シングルカラム | CC BY 4.0 |

新生児高ビリルビン血症に対する UDCA（ウルソデオキシコール酸）補助療法の RCT
（Zarkesh et al.）。既存 fixture（`tests/fixtures/pdf/README.md`）で CC BY 4.0 と
確認済みの論文を、本デモのプロジェクトテーマ（新生児高ビリルビン血症に対する補助療法の
RCT レビュー）の主役としてそのまま流用している。

## 選定基準

1. PMC OA subset かつ **CC BY**（Europe PMC の `LICENSE:"cc by"` で確認、または記事ページの
   ライセンス表記で確認）
2. 新生児高ビリルビン血症に対する補助療法の RCT（brief のデモテーマに合致）
3. PDF を実際に取得できること（%PDF- ヘッダを確認）

## 追加候補が 1 本のみである理由（既知の制約・引き継ぎ事項）

brief は Europe PMC REST API（下記クエリ）で同テーマの CC BY RCT をあと 1〜2 本追加することを
求めていたが、**本 PR の実装セッションはサンドボックス化されたネットワークポリシーにより
研究・出版社系ドメインへ一切到達できなかった**（`journals.plos.org` / `pmc.ncbi.nlm.nih.gov` /
`www.ebi.ac.uk`（Europe PMC）/ `doi.org` / `api.crossref.org` / `arxiv.org` など 10 以上の
ホストで、プロキシの CONNECT が組織ポリシーにより 403 で拒否されることを確認済み）。
そのため Europe PMC API 自体を呼べず、ライセンスを実際に確認できた論文は
「既に本リポジトリで CC BY 確認済みの PMC10715657」の 1 本のみに留めた
（brief の「2 本見つからない場合は 1 本でもよい」の規定どおり）。

ネットワーク制限のない環境（CI・開発者のローカル環境）で以下のクエリを実行し、
ライセンスを確認できた論文が見つかれば、`PDFS` 配列（`fetch-fixtures.sh`）へ
`name|url` の組を追記し、`src/demo/paperContent.ts` の `FIELD_INSTANCES` /
`src/demo/seed.ts` の study 定義を該当論文ぶん複製・調整することで拡張できる
（`src/demo/constants.ts` の `DEMO_STUDY_ID` 等は単一 study 前提の定数のため、
複数 study 対応時は配列化が必要）。

```
https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22neonatal%20hyperbilirubinemia%22%20AND%20randomized%20AND%20LICENSE%3A%22cc%20by%22%20AND%20OPEN_ACCESS%3AY&format=json&pageSize=50
```

WebSearch（Claude 内蔵の検索ツール。上記プロキシとは別経路）では以下のような
候補が見つかったが、本セッションでは PDF 取得・ライセンス確認のいずれもできなかったため
**採用していない**（brief の「PDF が取得できない・ライセンスが確認できない論文は
使わないこと」に従う）。追加時の候補調査の出発点として記録するのみ:

- Oral fenofibrate for hyperbilirubinemia in term neonates（PMC10130838）

## quote の再検証について（重要な申し送り）

`src/demo/paperContent.ts` の `FIELD_INSTANCES` / `PAGE_TEXTS` は、上記のネットワーク制限により
実 PDF の本文を一度も参照できないまま作成した（同ファイル冒頭コメント参照）。
実ネットワーク環境で本スクリプトが実 PDF を取得した後は、**quote が実際の本文と一致するかを
必ず再確認すること**（一致しない場合、該当 Evidence の `anchor_status` は `exact` ではなく
`fuzzy` / `failed` へ実質的に後退する。用途上ただちに壊れるわけではないが、
「大半 exact」というデモの狙いを満たせなくなる）。
