# Retro Game Press Clip

レトロゲームのプレイ動画を中心に、関連記事を少量だけ添えて一覧表示する、GitHub向けの静的リンク集サイトです。  
HTML / CSS / JavaScript と Node.js だけで構成しており、DBサーバーや管理画面は使いません。

## 特徴

- GitHub Pages で公開できる静的サイト
- 収集データは `data/articles.json` に保存
- 収集先は `data/sources.json` で管理
- GitHub Actions で毎日09:00 JSTに自動更新
- 一覧は `動画90件 + 記事10件` の構成
- 一覧順は `動画9件 → 記事1件` を繰り返す形で生成
- YouTubeのレトロゲーム動画を記事カードと同じ見た目で埋め込み表示
- `workflow_dispatch` で手動実行も可能
- 差分がある場合のみ `Update articles` でcommit
- 記事本文は保存せず、見出しやURLなどのメタ情報のみ保持
- 動画候補は国内・海外を問わず、レトロゲームのプレイ動画を対象に日替わり抽出

## 収集対象データ

保存する情報は次の項目です。

- タイトル
- URL
- サイト名
- 公開日
- 概要
- サムネイルURL
- タグ
- 取得日時

## ファイル構成

```text
/
├─ index.html
├─ style.css
├─ script.js
├─ package.json
├─ README.md
├─ .gitignore
├─ data/
│  ├─ sources.json
│  └─ articles.json
├─ scripts/
│  └─ fetch-rss.js
└─ .github/
   └─ workflows/
      └─ update-articles.yml
```

## GitHub Pagesで公開する方法

1. この一式をGitHubリポジトリにpushします。
2. GitHubの `Settings` → `Pages` を開きます。
3. `Build and deployment` の `Source` で `Deploy from a branch` を選びます。
4. 公開ブランチに `main`、フォルダに `/ (root)` を指定して保存します。
5. 数分後にGitHub Pagesの公開URLが発行されます。

補足:

- この構成では、GitHub Actions が `data/articles.json` を更新し、その更新内容をGitHub Pagesがそのまま配信します。
- `GITHUB_TOKEN` の書き込みが制限されている場合は、リポジトリの Actions 権限で書き込みを許可してください。

## RSS収集先の追加方法

`data/sources.json` にオブジェクトを追加します。

```json
[
  {
    "name": "Example Retro Game News",
    "rssUrl": "https://example.com/rss",
    "tags": ["レトロゲーム", "ニュース"],
    "language": "ja",
    "enabled": true
  },
  {
    "name": "Example Large Game Media",
    "type": "newsSitemap",
    "indexUrl": "https://example.com/news-sitemap.xml",
    "tags": ["レトロゲーム", "大手メディア"],
    "language": "ja",
    "requireRetroKeywords": true,
    "maxItems": 20,
    "enabled": true
  },
  {
    "name": "Example Retro Longplay Channel",
    "type": "youtubeChannel",
    "indexUrl": "https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx/videos",
    "tags": ["レトロゲーム", "動画", "YouTube"],
    "contentKind": "video",
    "maxItems": 36,
    "maxDailyItems": 12,
    "enabled": true
  }
]
```

項目の意味:

- `name`: サイト名
- `rssUrl`: RSSまたはAtomのURL
- `type`: 省略時は `rss`。`newsSitemap` を指定するとニュースサイトマップを利用
- `indexUrl`: `type: "newsSitemap"` や `type: "youtubeChannel"` のときに使うURL
- `tags`: そのサイトに付与する基本タグ
- `language`: 記事の主言語。`ja` または `en`
- `contentKind`: 省略時は `article`。`video` を指定するとYouTube動画候補として扱います
- `requireRetroKeywords`: `true` のとき、タイトルや概要がレトロゲーム系キーワードに一致した記事だけ保存
- `maxItems`: そのソースから1回で扱う最大件数
- `maxSavedItems`: 最終的な `articles.json` に残す上限件数。偏りを抑えるために使います
- `maxDailyItems`: `contentKind: "video"` のとき、1日分のランダム動画枠に入る上限件数
- `enabled`: `true` の時だけ収集

現在の一覧構成:

- 最終一覧は合計100件です
- そのうち動画90件、記事10件になるよう生成します
- 画面上の並びも `動画9件 → 記事1件` を基本に保ちます
- YouTube動画枠は毎日09:00 JSTに組み直されるため、1日内では同じ日替わり一覧が維持されます
- 記事側は総合ゲームメディアに `requireRetroKeywords: true` を付けて、レトロゲーム系の記事だけ残す運用を推奨します
- 同じ引用元に偏りすぎないよう、`maxSavedItems` と `maxDailyItems` で調整できます

追加後は次のどちらかで反映できます。

- GitHub Actions を手動実行する
- ローカルで `npm run fetch` を実行して `data/articles.json` を更新する

## 手動更新方法

### GitHub上で実行する

1. GitHubの `Actions` タブを開きます。
2. `Update Articles` ワークフローを選びます。
3. `Run workflow` を押して実行します。

### ローカルで実行する

```bash
npm install
npm run fetch
```

更新後に `data/articles.json` の差分をcommitしてpushしてください。

## ローカル / IAB検証方法

ビルド不要で、そのままローカル確認できます。

```bash
node scripts/dev-server.js
```

または:

```bash
npm start
```

起動後に次のURLをIABまたはブラウザで開いてください。

```text
http://127.0.0.1:4173
```

補足:

- `PORT=8080 node scripts/dev-server.js` のようにポート変更も可能です
- `data/articles.json` を `fetch` で読むため、`file://` 直開きではなくHTTPサーバー経由で確認してください

## 自動更新の仕組み

- `.github/workflows/update-articles.yml` が毎日09:00 JST に実行されます
- `workflow_dispatch` により手動実行もできます
- ワークフローでは `npm install` → `npm run fetch` を実行します
- `data/articles.json` に差分が出たときだけ `Update articles` でcommit & pushします
- YouTube動画枠も同じワークフロー内で更新され、日次で新しい90本へ切り替わります

## 表示画面

- 記事カード一覧
- YouTube動画の埋め込みカード
- 動画9件 + 記事1件の比率で並ぶリスト
- キーワード検索
- タグ絞り込み
- サイト名、公開日、概要、タグ表示
- 外部記事へのリンクボタン
- スマホ表示対応

## 注意事項

- 違法・過剰なスクレイピングは行わず、RSS/Atomを優先して利用してください
- YouTube動画は公開チャンネルの `videos` ページからメタ情報だけを低頻度取得し、埋め込みプレイヤーで表示します
- RSSがない場合のみ、公開ニュースサイトマップや記事のOGメタデータなど公開メタ情報を低頻度で参照します
- robots.txt、利用規約、著作権に配慮してください
- 記事本文の転載は禁止です
- このプロジェクトでは本文そのものを保存せず、短い概要だけを保存します
- 取得スクリプトはアクセス頻度を抑えるため、収集先を順番に処理し、待機時間を入れています
- 取得件数は最大300件に制限しています
- 最終一覧は動画中心のため、日によって記事より動画の更新が大きく目立つ構成です

## 記事本文を転載しない方針

このサイトはリンク集です。  
記事本文や全文キャッシュを保持するものではありません。

- 一覧にはタイトル、概要、公開日などのメタ情報だけを表示します
- 詳細はリンク先のオリジナル記事を読んでもらう前提です
- サムネイルもURLのみ保持します

## 補足

- ローカルプレビューはシンプルなHTTPサーバーで確認してください
- 依存パッケージを極力使っていないため、初心者でも追いやすい構成です
