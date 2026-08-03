#!/usr/bin/env bash
# デモビルド（dist-demo/）用の実論文 PDF（CC BY）を取得する。
# 一覧・選定基準・ライセンスは同ディレクトリの README.md を参照。
# PDF は .gitignore 済みのため、クローン後は本スクリプトで取得する。
# 冪等: 取得済み（%PDF- ヘッダ確認済み）ならスキップする。
#
# 使い方:
#   bash video/fixtures/fetch-fixtures.sh
#   （video/scripts/setup.sh の最終ステップからも実行される）
#
# 実装は tests/fixtures/pdf/fetch-pdfs.ps1（同じ思想の PowerShell 版）の bash 移植。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# name:url の組。name は webpack.config.js の DEMO_FIXTURE_PDF_FILENAME /
# src/demo/constants.ts の DEMO_FIXTURE_PDF_FILENAME と一致させること（値を変える場合は
# 3 箇所とも直す）。
PDFS=(
    "PMC10715657_plosone_udca_rct.pdf|https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0273516&type=printable"
)

for entry in "${PDFS[@]}"; do
    name="${entry%%|*}"
    url="${entry#*|}"
    dest="$SCRIPT_DIR/$name"

    if [ -f "$dest" ]; then
        echo "スキップ（取得済み）: $name"
        continue
    fi

    echo "取得中: $name"
    # -A: 一部出版社は UA 無しのリクエストを拒否するため付与する
    curl -sSL -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' "$url" -o "$dest"

    head="$(head -c 5 "$dest" 2>/dev/null || true)"
    if [ "$head" != "%PDF-" ]; then
        rm -f "$dest"
        echo "PDF として取得できませんでした: $url" >&2
        exit 1
    fi

    size_kb=$(( $(wc -c < "$dest") / 1024 ))
    echo "完了: $name (${size_kb} KB)"
done
