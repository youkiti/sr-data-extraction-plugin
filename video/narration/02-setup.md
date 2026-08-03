---
scene: "02"
slug: setup
title: 準備（インストール・BYOK・ログイン）
target_seconds: 80
---

## cue 01
<!-- action: popup.html を表示（ブランド行あたりをホバー） -->
まず準備です。Chrome ウェブストアの掲載ページから「Chrome に追加」でインストールします。

## cue 02
<!-- action: options.html の Gemini API キーカードへ遷移してホバー -->
拡張アイコンを右クリックして「オプション」を開き、ご自身の LLM API キーを保存します。
これが BYOK、Bring Your Own Key です。キーはこの端末の chrome.storage にのみ保存され、
開発者へ送信されることはありません。

## cue 03
<!-- action: 引き続き Gemini API キーカードをホバー -->
既定の接続先は Gemini API で、キーは Google AI Studio から取得できます。

## cue 04
<!-- action: popup.html へ戻り、ログイン中の表示をホバー -->
拡張アイコンをクリックすると、このプロジェクト選択画面が新しいタブで開きます。初回は
ここで「Google でログイン」を押し、メールアドレスと Drive、選択したファイルのみへの
アクセスを許可します。

## cue 05
<!-- action: options.html の LLM 接続先カードへ遷移し、接続方式セレクトをホバー -->
接続先は Gemini のほか、OpenRouter、OpenAI 互換 API、Anthropic、Azure OpenAI から選べます。
localhost 上のローカル LLM も指定でき、その場合は API キーを省略できます。

## cue 06
<!-- action: 既定モデルカード・レート制限カードをホバー -->
既定モデルは新しい抽出の初期値になり、レート制限では契約プランに合った tier を選ぶと、
一括抽出時のスロットル間隔や再試行が自動で調整されます。

## cue 07
<!-- action: Gemini API キーカードへ戻る、または注意書きをホバー -->
論文本文が外部へ送信されるのは、こうして設定した LLM API への抽出リクエストのときだけです。
開発者が運用するサーバーは存在しません。
