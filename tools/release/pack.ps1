<#
.SYNOPSIS
  Chrome ウェブストア提出用 zip を dist/ から作成する（.claude/skills/release-build 手順 1〜4 の自動化）。

.DESCRIPTION
  `npm run build` 済みの dist/ を入力として、以下を一括で行う:
    1. 事前検証（本番ビルドか・version・oauth2 セクション不在・client_id 注入済み）
    2. release/ 内の過去 zip をすべて削除（提出用・dev zip とも。手元に残す意味がないため）
    3. dist/ をステージングし、manifest から `key` フィールドを除去
       （Store は key を持つ manifest を拒否する。2026-07-10 の初回提出で実証）
    4. release/sr-data-extraction-plugin-<version>.zip を作成
    5. 作成した zip を展開し直して検証（NG なら非 0 終了。壊れた提出物を作らせない）

  `src/manifest.json` の `key` は dev（未パック読込）で拡張 ID を固定するために必須なので削除しない。
  除去はこのステージングの中だけで行う。

.PARAMETER IncludeKeyPem
  zip ルートへ key.pem を同梱する。**初回アップロードのときだけ** 指定する。
  初回提出は 2026-07-10 に完了済みなので、通常の更新では指定しない。

.PARAMETER KeyPemPath
  IncludeKeyPem 指定時に同梱する秘密鍵のパス（リポジトリ外）。

.EXAMPLE
  npm run build
  npm run pack:release
#>
[CmdletBinding()]
param(
  [switch]$IncludeKeyPem,
  [string]$KeyPemPath = 'C:\Users\youki\codes\keys\sr-data-extraction-plugin-ext-key.pem'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# 検証 NG は「壊れた提出物を作らない」ための停止なので、必ず非 0 で終える
function Stop-WithError([string]$message) {
  Write-Host "NG  $message" -ForegroundColor Red
  exit 1
}
function Write-Ok([string]$message) {
  Write-Host "OK  $message" -ForegroundColor Green
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$distDir = Join-Path $repoRoot 'dist'
$releaseDir = Join-Path $repoRoot 'release'
$stageDir = Join-Path $releaseDir 'stage'
$verifyDir = Join-Path $releaseDir '_verify'
$distManifestPath = Join-Path $distDir 'manifest.json'
$serviceWorkerRelPath = 'background/service-worker.js'

# zip に必ず入っていること（cmaps は和文 PDF 用 CMap。issue #95 で同梱）
$requiredEntries = @(
  '_locales', 'app', 'background', 'cmaps', 'icons', 'options', 'popup', 'styles', 'pdf.worker.min.mjs'
)

# ---------------------------------------------------------------------------
# 1. 事前検証（dist/）
# ---------------------------------------------------------------------------
Write-Host '=== 1. dist/ の事前検証 ===' -ForegroundColor Cyan

if (-not (Test-Path $distManifestPath)) {
  Stop-WithError "dist/manifest.json がありません。先に ``npm run build`` を実行してください"
}

$distManifestRaw = Get-Content $distManifestPath -Raw
$distManifest = $distManifestRaw | ConvertFrom-Json

if ($distManifest.name -match '\(dev\)') {
  Stop-WithError "dist が dev ビルドです（name = '$($distManifest.name)'）。``npm run build``（production）で作り直してください"
}
Write-Ok "本番ビルド（name = '$($distManifest.name)'）"

$version = $distManifest.version
if ([string]::IsNullOrWhiteSpace($version)) {
  Stop-WithError 'manifest に version がありません'
}

# version は manifest / package.json / package-lock.json の 3 箇所を揃える運用。
# manifest だけバンプして他を忘れる事故があったため機械チェックする
foreach ($file in @('package.json', 'package-lock.json')) {
  # package-lock.json は packages に "" キーを持つので -AsHashtable でないと解釈できない
  $otherVersion = (Get-Content (Join-Path $repoRoot $file) -Raw | ConvertFrom-Json -AsHashtable).version
  if ($otherVersion -ne $version) {
    Stop-WithError "$file の version ($otherVersion) が manifest ($version) と一致しません。3 箇所を揃えてください（package-lock は ``npm install --package-lock-only``）"
  }
}
Write-Ok "version = $version（manifest / package.json / package-lock.json が一致）"

# launchWebAuthFlow 移行後は oauth2 セクションが無いのが正常形（issue #129）
if ($distManifest.PSObject.Properties.Name -contains 'oauth2') {
  Stop-WithError 'manifest に oauth2 セクションが残っています（launchWebAuthFlow 移行前の残骸）'
}
Write-Ok 'oauth2 セクションなし'

# client_id は manifest ではなく DefinePlugin でコードへ注入される。
# 走査はテキスト系だけに絞る（cmaps の bcmap 等のバイナリを Select-String に食わせない）
$textFilePatterns = @('*.js', '*.mjs', '*.html', '*.css', '*.json')
$placeholderHits = Get-ChildItem $distDir -Recurse -File -Include $textFilePatterns |
  Where-Object { Select-String -Path $_.FullName -Pattern '__WEBAUTH_CLIENT_ID__' -SimpleMatch -Quiet }
if ($placeholderHits) {
  Stop-WithError "__WEBAUTH_CLIENT_ID__ のプレースホルダが残っています: $($placeholderHits.Name -join ', ')"
}
$swPath = Join-Path $distDir $serviceWorkerRelPath
if (-not (Select-String -Path $swPath -Pattern 'apps.googleusercontent.com' -SimpleMatch -Quiet)) {
  Stop-WithError "$serviceWorkerRelPath に OAuth client_id が注入されていません（.env の WEBAUTH_CLIENT_ID を確認）"
}
Write-Ok 'client_id 注入済み（プレースホルダ残存なし）'

# ---------------------------------------------------------------------------
# 2. 過去ビルドの削除
# ---------------------------------------------------------------------------
Write-Host '=== 2. release/ の過去 zip を削除 ===' -ForegroundColor Cyan

New-Item -ItemType Directory -Force $releaseDir | Out-Null
foreach ($stale in @($stageDir, $verifyDir)) {
  if (Test-Path $stale) { Remove-Item $stale -Recurse -Force }
}
$oldZips = @(Get-ChildItem $releaseDir -Filter *.zip -File)
if ($oldZips.Count -gt 0) {
  foreach ($old in $oldZips) {
    Remove-Item $old.FullName -Force
    Write-Host "    削除: $($old.Name)"
  }
  Write-Ok "過去 zip $($oldZips.Count) 件を削除"
} else {
  Write-Ok '削除対象の過去 zip なし'
}

# ---------------------------------------------------------------------------
# 3. ステージング + key 除去
# ---------------------------------------------------------------------------
Write-Host '=== 3. ステージングと key 除去 ===' -ForegroundColor Cyan

Copy-Item $distDir $stageDir -Recurse

# ConvertTo-Json での再シリアライズは配列や順序を壊しうるので、
# manifest は生テキストから `key` 行だけを削る（他バイトは dist のまま保つ）。
# dist/manifest.json は webpack の JSON.stringify(manifest, null, 2) 生成なので
# トップレベルのインデントは常に半角 2 個。想定外の形なら止める。
$stageManifestPath = Join-Path $stageDir 'manifest.json'
$keyLinePattern = '(?m)^  "key": "[^"]*",\r?\n'
$keyLineMatches = [regex]::Matches($distManifestRaw, $keyLinePattern)
if ($keyLineMatches.Count -ne 1) {
  Stop-WithError "manifest の key 行を一意に特定できません（該当 $($keyLineMatches.Count) 件）。dist/manifest.json の形式を確認してください"
}
$strippedRaw = [regex]::Replace($distManifestRaw, $keyLinePattern, '')
Set-Content $stageManifestPath -Value $strippedRaw -Encoding utf8NoBOM -NoNewline
Write-Ok 'manifest から key を除去（他フィールドはバイト単位で dist のまま）'

if ($IncludeKeyPem) {
  # 初回アップロード専用。Store に同じ拡張 ID を導出させるため
  if (-not (Test-Path $KeyPemPath)) {
    Stop-WithError "key.pem が見つかりません: $KeyPemPath"
  }
  Copy-Item $KeyPemPath (Join-Path $stageDir 'key.pem')
  Write-Host 'WARN  key.pem を同梱しました（初回アップロード用。更新提出では不要）' -ForegroundColor Yellow
}

# ---------------------------------------------------------------------------
# 4. zip 化
# ---------------------------------------------------------------------------
Write-Host '=== 4. zip 化 ===' -ForegroundColor Cyan

$zipPath = Join-Path $releaseDir "sr-data-extraction-plugin-$version.zip"
Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath
Remove-Item $stageDir -Recurse -Force
Write-Ok "作成: $(Split-Path $zipPath -Leaf) ($([math]::Round((Get-Item $zipPath).Length / 1MB, 2)) MB)"

# ---------------------------------------------------------------------------
# 5. zip の検証（展開し直して確認する）
# ---------------------------------------------------------------------------
Write-Host '=== 5. zip の検証 ===' -ForegroundColor Cyan

Expand-Archive $zipPath -DestinationPath $verifyDir
try {
  $zipManifestPath = Join-Path $verifyDir 'manifest.json'
  if (-not (Test-Path $zipManifestPath)) {
    Stop-WithError 'manifest.json が zip のルートにありません（dist/ ごと入れ子になっている可能性）'
  }
  Write-Ok 'manifest.json が zip のルートにある'

  $zipManifest = Get-Content $zipManifestPath -Raw | ConvertFrom-Json
  if ($zipManifest.PSObject.Properties.Name -contains 'key') {
    Stop-WithError 'zip の manifest に key フィールドが残っています（Store が拒否します）'
  }
  Write-Ok 'manifest に key フィールドなし'

  # key 以外が dist と完全一致することを、正規化 JSON の比較で確認する（破損検知）
  $expected = $distManifest | Select-Object -Property * -ExcludeProperty key |
    ConvertTo-Json -Depth 20 -Compress
  $actual = $zipManifest | ConvertTo-Json -Depth 20 -Compress
  if ($expected -ne $actual) {
    Stop-WithError 'zip の manifest が dist と一致しません（key 除去で他フィールドが破損した可能性）'
  }
  Write-Ok 'manifest の key 以外は dist と完全一致（permissions / host_permissions / externally_connectable 等）'

  $keyPemInZip = Test-Path (Join-Path $verifyDir 'key.pem')
  if ($IncludeKeyPem -and -not $keyPemInZip) {
    Stop-WithError 'IncludeKeyPem 指定なのに zip へ key.pem が入っていません'
  }
  if (-not $IncludeKeyPem -and $keyPemInZip) {
    Stop-WithError 'key.pem が zip に混入しています（更新提出では同梱しない）'
  }
  Write-Ok ($IncludeKeyPem ? 'key.pem 同梱を確認（初回アップロード用）' : 'key.pem 未同梱（更新提出の正常形）')

  $missing = $requiredEntries | Where-Object { -not (Test-Path (Join-Path $verifyDir $_)) }
  if ($missing) {
    Stop-WithError "zip に同梱漏れがあります: $($missing -join ', ')"
  }
  $cmapCount = (Get-ChildItem (Join-Path $verifyDir 'cmaps') -File).Count
  Write-Ok "同梱物を確認（$($requiredEntries -join ' / ')、cmaps $cmapCount ファイル）"

  $zipPlaceholderHits = Get-ChildItem $verifyDir -Recurse -File -Include $textFilePatterns |
    Where-Object { Select-String -Path $_.FullName -Pattern '__WEBAUTH_CLIENT_ID__' -SimpleMatch -Quiet }
  if ($zipPlaceholderHits) {
    Stop-WithError "zip 内に __WEBAUTH_CLIENT_ID__ が残っています: $($zipPlaceholderHits.Name -join ', ')"
  }
  $zipSwPath = Join-Path $verifyDir $serviceWorkerRelPath
  if (-not (Select-String -Path $zipSwPath -Pattern 'apps.googleusercontent.com' -SimpleMatch -Quiet)) {
    Stop-WithError "zip の $serviceWorkerRelPath に OAuth client_id が入っていません"
  }
  Write-Ok 'zip 内も client_id 注入済み（プレースホルダ残存なし）'
} finally {
  if (Test-Path $verifyDir) { Remove-Item $verifyDir -Recurse -Force }
}

Write-Host ''
Write-Host "提出用 zip: $zipPath" -ForegroundColor Cyan
Write-Host '次: Chrome ウェブストア デベロッパー ダッシュボードへアップロード（.claude/skills/release-build 手順 5）'
