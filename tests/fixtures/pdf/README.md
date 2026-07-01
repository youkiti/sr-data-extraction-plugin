# PDF fixture（E2E / anchoring テスト用の実論文）

PMC Open Access（CC BY）の RCT 論文 2 本を fixture として使う。**PDF 本体は
リポジトリにコミットしない**（`.gitignore` 済み）。クローン後は `fetch-pdfs.ps1`
で再取得する。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/fixtures/pdf/fetch-pdfs.ps1
```

## 収録論文

| ファイル | PMCID | DOI | ジャーナル / レイアウト | ライセンス |
|---|---|---|---|---|
| `PMC10715657_plosone_udca_rct.pdf` | [PMC10715657](https://pmc.ncbi.nlm.nih.gov/articles/PMC10715657/) | [10.1371/journal.pone.0273516](https://doi.org/10.1371/journal.pone.0273516) | PLoS One 2023 / **シングルカラム** | CC BY 4.0 |
| `PMC10766786_frontmed_thermocov_rct.pdf` | [PMC10766786](https://pmc.ncbi.nlm.nih.gov/articles/PMC10766786/) | [10.3389/fmed.2023.1256197](https://doi.org/10.3389/fmed.2023.1256197) | Front Med (Lausanne) 2023 / **2 段組** | CC BY 4.0 |

- 1 本目: 新生児高ビリルビン血症に対する UDCA の RCT（Zarkesh et al.）。
  典型的な臨床 RCT でアウトカム表を持つ
- 2 本目: 軽症〜中等症 COVID-19 への局所温熱療法の RCT（TherMoCoV,
  Mancilla-Galindo et al.）。2 段組レイアウトで、anchoring の
  「2 段組の読み順ずれ」ケース（architecture.md §4.3）の実弾になる

## 選定基準（差し替え・追加時も同じ基準で）

1. PMC OA subset かつ **CC BY**（Europe PMC の `LICENSE:"cc by"` で確認）
2. RCT（抽出スキーマ・アウトカム表の現実的なテストになる）
3. シングルカラムと 2 段組の両方をカバーする
4. anchoring 単体テスト用のテキスト層 fixture（`*.json`。実装フェーズで
   `tools/generate-pdf-fixture.ts` により生成）はこの PDF から作り、
   生成物の JSON は**コミットする**（PDF 非依存でテストを回すため）
