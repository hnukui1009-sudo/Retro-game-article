# Retro Game Press Clip

レトロゲーム関連記事をRSS/Atomから自動収集して一覧表示する、GitHub向けの静的リンク集サイトです。  
HTML / CSS / JavaScript と Node.js だけで構成しており、DBサーバーや管理画面は使いません。

## 特徴

- GitHub Pages で公開できる静的サイト
- 収集データは `data/articles.json` に保存
- 収集先は `data/sources.json` で管理
- GitHub Actions で1時間ごとに自動更新
- `workflow_dispatch` で手動実行も可能
- 差分がある場合のみ `Update articles` でcommit
- 記事本文は保存せず、見出しやURLなどのメタ情報のみ保持
- 保存時に日本語記事を約8割、英語記事を約2割に調整

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
  }
]
```

項目の意味:

- `name`: サイト名
- `rssUrl`: RSSまたはAtomのURL
- `type`: 省略時は `rss`。`newsSitemap` を指定するとニュースサイトマップを利用
- `indexUrl`: `type: "newsSitemap"` のときに使うURL
- `tags`: そのサイトに付与する基本タグ
- `language`: 記事の主言語。`ja` または `en`
- `requireRetroKeywords`: `true` のとき、タイトルや概要がレトロゲーム系キーワードに一致した記事だけ保存
- `maxItems`: そのソースから1回で扱う最大件数
- `maxSavedItems`: 最終的な `articles.json` に残す上限件数。偏りを抑えるために使います
- `enabled`: `true` の時だけ収集

言語配分について:

- 収集結果は保存時に日本語約80%、英語約20%になるよう調整します
- 指定言語の記事が不足する場合は、件数を少し減らしてでも8:2の比率を優先します
- `language` を省略した場合は、タイトルや概要の文字種から簡易判定します
- 総合ゲームメディアは `requireRetroKeywords: true` を付けて、レトロゲーム系の記事だけ残す運用を推奨します
- 同じ引用元に偏りすぎないよう、`maxSavedItems` でソースごとの残存件数を調整できます

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

- `.github/workflows/update-articles.yml` が毎時0分に実行されます
- `workflow_dispatch` により手動実行もできます
- ワークフローでは `npm install` → `npm run fetch` を実行します
- `data/articles.json` に差分が出たときだけ `Update articles` でcommit & pushします

## 表示画面

- 記事カード一覧
- キーワード検索
- タグ絞り込み
- サイト名、公開日、概要、タグ表示
- 外部記事へのリンクボタン
- スマホ表示対応

## 注意事項

- 違法・過剰なスクレイピングは行わず、RSS/Atomを優先して利用してください
- RSSがない場合のみ、公開ニュースサイトマップや記事のOGメタデータなど公開メタ情報を低頻度で参照します
- robots.txt、利用規約、著作権に配慮してください
- 記事本文の転載は禁止です
- このプロジェクトでは本文そのものを保存せず、短い概要だけを保存します
- 取得スクリプトはアクセス頻度を抑えるため、収集先を順番に処理し、待機時間を入れています
- 取得件数は最大300件に制限しています
- 収集結果の最終一覧は、日本語記事を優先して約8:2の比率に整えます

## 記事本文を転載しない方針

このサイトはリンク集です。  
記事本文や全文キャッシュを保持するものではありません。

- 一覧にはタイトル、概要、公開日などのメタ情報だけを表示します
- 詳細はリンク先のオリジナル記事を読んでもらう前提です
- サムネイルもURLのみ保持します

## 補足

- ローカルプレビューはシンプルなHTTPサーバーで確認してください
- 依存パッケージを極力使っていないため、初心者でも追いやすい構成です
