# E2E / anchoring テスト用の PMC OA 論文 PDF を取得する。
# 一覧とライセンスは同ディレクトリの README.md を参照。
# PDF は .gitignore 済みのため、クローン後に本スクリプトで再取得する。

$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot

$pdfs = @(
    @{
        Name = 'PMC10715657_plosone_udca_rct.pdf'
        Url  = 'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0273516&type=printable'
    },
    @{
        Name = 'PMC10766786_frontmed_thermocov_rct.pdf'
        Url  = 'https://www.frontiersin.org/articles/10.3389/fmed.2023.1256197/pdf'
    }
)

foreach ($pdf in $pdfs) {
    $dest = Join-Path $dir $pdf.Name
    if (Test-Path $dest) {
        Write-Host "スキップ（取得済み）: $($pdf.Name)"
        continue
    }
    Write-Host "取得中: $($pdf.Name)"
    # Windows 同梱の curl.exe を使用（-A: 一部出版社は UA 無しを拒否する）
    & curl.exe -sL -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' $pdf.Url -o $dest
    $head = [System.Text.Encoding]::ASCII.GetString((Get-Content $dest -AsByteStream -TotalCount 5))
    if ($head -ne '%PDF-') {
        Remove-Item $dest -Confirm:$false
        throw "PDF として取得できませんでした: $($pdf.Url)"
    }
    Write-Host "完了: $($pdf.Name) ($([math]::Round((Get-Item $dest).Length / 1KB)) KB)"
}
