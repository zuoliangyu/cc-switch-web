# CC Switch Web

[中文](README.md) | [English](README_EN.md) | 日本語

## 概要

CC Switch Web は [cc-switch](https://github.com/farion1231/cc-switch) の Web ブランチ用リポジトリです。

このリポジトリは、CC Switch に関する Web 向け実装、関連する実験、そしてブランチ固有の調整を管理するために使用されます。

現在の想定アーキテクチャは次の通りです。

- フロントエンド: Web
- バックエンド: ローカル Rust サービス
- アクセス方法: ブラウザで `http://localhost:xxxx` を開く

この方向は、Windows、macOS、Linux、およびデスクトップのない Linux サーバーを対象にしています。

## 現在のバージョン

現在のリポジトリバージョンは `0.5.0` です。

`0.5.0` は定例の依存関係アップデート + テスト fixture 修正リリースです。

- `OpenClaw delete_session_updates_index_and_removes_jsonl` のテスト fixture を修正：Windows の一時パスに含まれるバックスラッシュが `serde_json::from_str` で `\T` / `\U` 等の不正 escape として拒否されていた問題を解消（fixture を `serde_json::json!` で構築し、serde 自身に escape を任せる形に変更）。バックエンド `cargo test` は 775/775 全パス、pre-existing 失敗ゼロになりました。
- フロントエンド依存関係を minor / patch 範囲内で一括更新（`@tanstack/react-query`、`@codemirror/*`、`framer-motion`、`i18next` / `react-i18next`、`prettier`、`vite 7.3.x`、`tailwindcss 3.4.x` ほか 24 パッケージ）。`react` 18→19、`tailwindcss` 3→4、`vite` 7→8、`typescript` 5→6、`vitest` 2→4 のような既知の breaking changes を含む major アップグレードは意図的にスキップし、後続の独立した反復に委ねます。

`0.4.0` では 0.3.x 系で最も繰り延べが続いていた項目 B1（クロスソース usage 重複排除）を着地させました。

**背景**：プロキシのライブ書き込みと session-log 同期は異なる `request_id` 生成ルールを使っていました。Claude をネイティブ Anthropic バックエンドで使う場合のみ `session:{message_id}` キーを共有し、Codex / Gemini / Claude-through-OpenAI 互換経路は常に異なる id を生成するため、主キー重複排除が機能せず、実際のリクエストが 2 回記録されてダッシュボードの合計が倍増していました。

**対応**：

- `TokenUsage` に `message_id` フィールドと `dedup_request_id()` メソッドを追加（Claude の `body.id` / `message_start.message.id` から抽出）。プロキシ書き込みと session-log 同期は同じ `session:{msg_xxx}` 主キーを共有するようになり、主キー重複排除が実際に機能します。
- プロキシ logger は `INSERT OR REPLACE` に変更。両経路が同じキーで衝突した場合、より完全なデータが残ります。
- SQL レイヤの 7 次元指紋重複排除フィルター：`(app_type, 4 つの token 計数, 2xx ステータス, 大文字小文字非依存の model, created_at ± 10 分間ウィンドウ)`。request_id を共有できない Codex / Gemini / Claude-through-OpenAI 経路を網羅します。
- フィルターを 3 層すべてに適用：読み取り（summary / provider / model / logs / limits）、書き込み（3 つの `session_usage_*.rs` で INSERT 前に `should_skip_session_insert` を呼ぶ）、ロールアップ（`usage_daily_rollups` が session_log の重複を吸収しない）。
- minor バージョン 0.4.0 へ。`TokenUsage` は `pub` 型で `message_id` 追加は ABI 変更にあたるため。

これで 0.3.x 系で繰り延べていた B1 / C7 / F1 項目はすべて完了です。各修正と対応するアップストリーム commit は `CHANGELOG.md` と `docs-dev/web-parity-post-3.14-2026-05.md` を参照してください。

`0.3.2` では `0.3.1` で繰り延べた 2 項目を引き続き対応しました。

- Codex プロバイダー切替時の履歴安定化（アップストリーム `a1e6c3b6`）：CC Switch で Codex プロバイダーを切り替えると `codex resume` の履歴が「入れ替わって見える」問題は、Codex が `model_provider` フィールドで履歴をフィルタしているのに対し、旧挙動では `rightcode` / `aihubmix` のようなカスタム id がそのまま漂流していたことが原因。本リリースではプロバイダー主導の書き込み境界に "stable provider-id 正規化" を導入し（既存のカスタム id を再利用、なければ `ccswitch` にフォールバック）、対応する `[profiles.*]` の参照も同時に書き換えます。backfill 経路では正規化を逆向きに戻し、保存済みテンプレートの元 id を汚染しません。正規化と backfill 復元の双方を網羅する 8 件の新規ユニットテストを追加。
- Usage 性能（アップストリーム `f061b777` のうち `518d945e` で取り消されなかった部分）：dashboard の範囲クエリ向けに `(app_type, created_at DESC)` のカバリングインデックスを追加。GPT-5.4（3 件）と GPT-5.5（6 件）の既定価格 seed を補完し、0.3.1 で取り込んだ `find_model_pricing_row` の大文字小文字非依存修正と組み合わせ、dashboard の ghost-zero-cost 行をさらに削減。

`0.3.1` は `0.3.0` リリース以降にアップストリーム `cc-switch` で蓄積された修正のうち、「Web バックエンドにとって直接価値のあるもの」だけを選んで取り込んだリリースです。

- プロキシ／ストリーミング：重複する `finish_reason` チャンクを除去し、`message_delta` を `[DONE]` まで遅延送出（OpenRouter / Kimi-K2.6 で複数回 finish が来て Anthropic クライアントが abort する問題を修正）。Cloudflare AI Gateway 経由の Vertex AI フル URL を保持。Kimi/Moonshot のツールコール経路で `reasoning_content` を維持。DashScope / Codex OAuth の `usage` 欠損・部分・null に対する堅牢化。
- 認証セマンティクス：`ANTHROPIC_AUTH_TOKEN` → `Authorization: Bearer`、`ANTHROPIC_API_KEY` → `x-api-key`（Anthropic SDK のネイティブ挙動に合わせる）。stream check も同じヘッダーロジックを再利用し、二重送出によるヘルスチェックの偽陰性を解消。
- プロバイダー：DeepSeek / Kimi / Zhipu GLM / MiniMax のように Anthropic 互換 API がサブパスに、`/models` がルートにある供給元でも `/anthropic/v1/models` → `/v1/models` → `/models` の候補順でモデル一覧を取得可能に。GitHub Copilot のダッシュ形式 Claude id（`claude-sonnet-4-6[1m]` 等）はドット形式へ正規化し、live `/models` で確認、見つからなければ family + 最高バージョンへフォールバック。SiliconFlow 国際サイトの通貨表記を USD に修正。Zhipu の週次枠ラベルを修正。
- セッション：Codex の explorer / サブエージェントセッションをメイン一覧から非表示に。要約抽出時に `<environment_context>` 注入をスキップ。
- 設定書き出し：`settings.json` のキーをアルファベット順に並べ替え、構成切替時のノイズ diff を排除。MCP のインポート操作で各アプリ live 設定への逆方向書き戻しを廃止。
- Windows 適配：JSON 設定中にホワイトリストの `%USERPROFILE%` 等のプレースホルダーが含まれる場合、エディタに「絶対パスへ展開」ボタンを表示（Claude Code は Windows 環境変数を自動展開しない）。非 Windows プラットフォームの `try_get_version` は `$SHELL` を優先し、ユーザーの PATH / alias を読み込めるよう変更。
- Claude effort トグル：`effortHigh` は `env.CLAUDE_CODE_EFFORT_LEVEL` への書き込みに変更（旧トップレベル `effortLevel` は Claude Code に効かない）。読み取り時は旧フィールドも認識して移行を担保。
- Usage の堅牢化：`find_model_pricing_row` を大文字小文字非依存にし、`OpenAI/GPT-5.5@HIGH` のような不一致 model id でも seed の価格情報にヒット。これにより dashboard に出ていた「ゴースト・ゼロコスト」行を解消。後続の本格的な重複排除に向けた 7 列カバリングインデックス `idx_request_logs_dedup_lookup` を追加。

各修正と対応するアップストリーム commit、独立タスクへ繰り延べた項目（B1 7 次元指紋による重複排除 / C7 Codex プロバイダー切替時の履歴安定化 / F1 起動時コスト backfill）の完全な一覧は `CHANGELOG.md` および `docs-dev/web-parity-post-3.14-2026-05.md` を参照してください。

このリポジトリでは、`0.1.0` を Web ブランチの初回リリース基準として扱います。以前に引き継がれていた過去のリリース履歴はこのリポジトリから削除しており、より古い履歴はアップストリーム側を参照してください。

## アップストリームとの関係

- アップストリームプロジェクト: [cc-switch](https://github.com/farion1231/cc-switch)
- 現在の Web リポジトリ: [zuoliangyu/zuoliangyu-cc-switch-web](https://github.com/zuoliangyu/zuoliangyu-cc-switch-web)
- 作者: 左岚（[Bilibili](https://space.bilibili.com/27619688)）
- このリポジトリは CC Switch の Web ブランチ方向に焦点を当てています
- プロジェクトの位置付けや外部向け説明が変わった場合は、このリポジトリ内の各言語版 README を同期して更新してください

## 補足

元の CC Switch プロジェクト、またはアップストリームのリリース情報を確認したい場合は、上流リポジトリを直接参照してください。

## 最近そろえた Web 機能と UI 更新

現在の Web ブランチでは、次のデスクトップ機能をそろえ、あわせて Web UI の階層も刷新しています。

- Claude、Codex、Gemini、OpenClaw のプロバイダーモデル取得
- Claude、Codex、Gemini の公式サブスクリプションクォータ表示
- ChatGPT（Codex OAuth）の管理アカウントセンター、Claude プリセット、クォータ表示
- 環境変数競合の検出と整理入口
- `?deeplink=...` または手動入力した `ccswitch://...` による Deep Link 取り込み
- About ページから GitHub の最新リリースページを開く入口
- Provider、Settings、Skills、Sessions ページを新しいワークスペース型 UI 階層へ統一
- 関連するフルスクリーンパネル、リポジトリ管理パネル、会話 TOC パネルも同じ Web ビジュアル言語へ更新

## 実行方法

### コマンド早見表

| 用途 | コマンド |
| --- | --- |
| ローカル開発（`w`） | `pnpm dev` |
| Docker フォアグラウンド開発（`d`） | `pnpm dev -- d` |
| ローカル release ビルド（`w`） | `pnpm build` |
| Docker イメージビルド（`d`） | `pnpm build -- d` |
| プロジェクトチェック | `.\scripts\check.ps1` |
| ローカル CI チェック | `.\scripts\ci-check.ps1` |
| Windows 上で成果物を出力 | `.\scripts\package-artifacts.ps1` |

スクリプト入口の方針:

- `scripts/*.mjs` は `pnpm` と CI から直接使うクロスプラットフォームの主ロジック
- `scripts/*.ps1` は PowerShell 向けの Windows ローカル入口ラッパー
- `scripts/lib/process.mjs` と `scripts/lib/entry.ps1` は Node / PowerShell 側の共通実行処理をまとめ、重複実装を避けるための共有レイヤー

### ローカル開発

1. 依存関係をインストールします。

   ```bash
   pnpm install --frozen-lockfile
   ```

   バックエンドのビルドとチェックには Rust `1.88+` が必要です。

2. 開発モードを起動します。

   ```bash
   pnpm dev
   ```

   明示的な書き方:

   ```bash
   pnpm dev -- w
   ```

   Windows では次も使えます。

   ```powershell
   .\scripts\dev.ps1 w
   ```

   ポートを明示したい場合は次のように実行できます。

   ```bash
   pnpm dev -- --frontend-port 3300 --backend-port 8890
   pnpm dev -- w -f 3300 -b 8890 --host 127.0.0.1
   ```

   Windows:

   ```powershell
   .\scripts\dev.ps1 w -f 3300 -b 8890
   ```

3. [http://localhost:3000](http://localhost:3000) を開きます。フロントエンドはローカル Rust サービス `http://127.0.0.1:8890` に接続します。
   ローカル開発ではバックエンドポートではなくフロントエンド開発 URL を開いてください。`pnpm dev` はバックエンドの静的フロントエンド配信をデフォルトで無効化し、希望ポートが使えない場合は利用可能なポートへ自動的に繰り上げ、その結果を Vite 側にも反映します。

4. `pnpm dev` ではローカルのリクエストデバッグログがデフォルトで有効になります。
   - ブラウザの DevTools にフロントエンドのリクエスト/レスポンスログが出ます
   - Rust サービスのターミナルに Web API の method/path/status/所要時間が出ます
   - 必要に応じて `VITE_RUNTIME_DEBUG_REQUESTS=0|1` と `CC_SWITCH_WEB_DEBUG_API=0|1` で上書きできます

### ローカル Release バイナリ

1. フロントエンドを埋め込んだ release バイナリをビルドします。

   ```bash
   pnpm build
   ```

   明示的な書き方:

   ```bash
   pnpm build -- w
   ```

   Windows では次も使えます。

   ```powershell
   .\scripts\build.ps1 w
   ```

2. 出力先:

   - Windows: `backend\target\release\cc-switch-web.exe`
   - Linux/macOS: `backend/target/release/cc-switch-web`

3. 対応するバイナリを直接実行し、ターミナルに表示された最終アドレスを開きます。リリース版ではフロントエンド静的配信と Web API が同じサービスポートを共有します。デフォルトの優先ポートは `8890` です。

   ```bash
   ./backend/target/release/cc-switch-web --backend-port 8890
   ```

   Windows:

   ```powershell
   .\backend\target\release\cc-switch-web.exe -b 8890
   ```

   希望ポートが使用中・OS により除外・権限拒否されている場合は、自動的に後続ポートを試し、実際にバインドしたポートを出力します。

4. ローカル Web サービスモードでも、CC Switch Web 自身のデータ保存先は CC Switch が使うローカル設定ルートです。

   ```text
   ~/.cc-switch
   ```

   ここには `settings.json`、`cc-switch.db`、バックアップ、統一 Skills ストレージなどが保存されます。旧 `config.json` は現在の Web ランタイムの主データ経路には含まれません。

### Docker 実行

1. Docker イメージをビルドします。

   ```bash
   pnpm build -- d
   ```

   Windows では次も使えます。

   ```powershell
   .\scripts\build.ps1 d
   ```

2. Docker 構成をフォアグラウンドで起動します。

   ```bash
   pnpm dev -- d
   ```

   Windows では次も使えます。

   ```powershell
   .\scripts\dev.ps1 d
   ```

   公開ポートを変更したい場合:

   ```bash
   CC_SWITCH_WEB_PORT=8895 pnpm dev -- d
   ```

   PowerShell:

   ```powershell
   $env:CC_SWITCH_WEB_PORT=8895; .\scripts\dev.ps1 d
   ```

3. イメージビルド後にバックグラウンド実行へ切り替えたい場合は、Docker を直接使います。

   ```bash
   docker compose up -d
   docker compose logs -f
   docker compose down
   ```

4. [http://localhost:8890](http://localhost:8890) または指定したポートを開きます。コンテナ内でもフロントエンドと API は同じポートを共有します。Docker モードでは、公開ポートの対応を固定するために `CC_SWITCH_WEB_PORT_SCAN_COUNT=1` をデフォルトにしています。永続データは `cc-switch-web-data` volume に保存されます。

5. コンテナ内のサービスからホスト側の CLI 設定ディレクトリを直接管理したい場合は、まずサンプルファイルをコピーします。

   ```bash
   cp docker-compose.host.example.yml docker-compose.host.yml
   ```

   その後、実際の環境に合わせてパスを調整し、次を実行します。

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.host.yml up -d
   ```

   このサンプルは主に Linux サーバー向けで、`$HOME` 配下の `.claude`、`.codex`、`.gemini`、`.config/opencode`、`.config/openclaw` を前提にしています。

### Docker 内で Linux 配布パッケージを出力

ホスト環境を汚さずに Linux 向け配布パッケージを作りたい場合は、Docker Buildx を直接使います。

```bash
docker buildx build --target package-linux-tar --output type=local,dest=release/docker-linux .
```

出力される圧縮ファイル:

```text
release/docker-linux/cc-switch-web-linux-x64.tar.gz
```

未圧縮ディレクトリを直接出力したい場合:

```bash
docker buildx build --target package-linux-dir --output type=local,dest=release/docker-linux .
```

出力先:

```text
release/docker-linux/cc-switch-web-linux-x64/
```

内容は単一実行ファイル `cc-switch-web` のみです。展開後はそのバイナリを直接実行してください。

現在の Linux 配布バイナリは `x86_64-unknown-linux-musl` の静的リンク版で、ホスト側ランタイム差異の影響を受けにくくしています。

### Windows で成果物をまとめて出力

Windows 上で Rust と Docker / Buildx が利用できる場合は、次を実行してください。

```powershell
.\scripts\package-artifacts.ps1
```

Windows 上で静的なプロジェクトチェックだけを行いたい場合は、次を使ってください。

```powershell
.\scripts\check.ps1
```

これは既存の Node スクリプト検証、TypeScript チェック、Rust チェックだけを実行し、Docker build は行いません。

Windows 上で CI 相当の完全なチェックフローを再現したい場合は、次を使ってください。

```powershell
.\scripts\ci-check.ps1
```

静的チェックの後に、CI と同じ Docker smoke check、つまり `docker build` + コンテナ起動 + `GET /api/health` 確認まで実行します。`8890` が使用中なら次のように変更できます。

```powershell
.\scripts\ci-check.ps1 -DockerSmokePort 8895
```

npm script で静的チェックだけを行いたい場合は、引き続き次を使えます。

```powershell
pnpm check
```

Windows の成果物出力スクリプトは、release 相当のローカル成果物を一括で生成するようになりました。

- Windows 実行ファイル: `release\local-artifacts\windows\cc-switch-web.exe`
- Linux 配布パッケージ: `release\local-artifacts\linux\cc-switch-web-linux-x64.tar.gz`
- Docker イメージアーカイブ: `release\local-artifacts\docker\cc-switch-web-docker-image.tar.gz`

内容:

- Windows 成果物はローカルの `cargo build --locked --release` から生成
- Linux 成果物は Docker Buildx の `package-linux-tar` stage から生成
- Docker イメージアーカイブは次で取り込めます。

```powershell
docker load -i .\release\local-artifacts\docker\cc-switch-web-docker-image.tar.gz
```

### Linux systemd サンプル

デスクトップのない Linux サーバーで常駐させたい場合は、リポジトリ内の次のサンプルを使ってください。

`deploy/systemd/cc-switch-web.service.example`

推奨手順:

1. Linux 上で `pnpm build` を実行してバイナリを作成するか、パッケージ済みの Linux バイナリを `/opt/cc-switch-web` に配置します。

2. サービスファイルをシステムディレクトリへコピーします。

   ```bash
   sudo cp deploy/systemd/cc-switch-web.service.example /etc/systemd/system/cc-switch-web.service
   ```

3. 実際の環境に合わせて次の項目を修正します。
   - `User`
   - `Group`
   - `WorkingDirectory`
   - `HOME`
   - `ExecStart`

4. 再読み込みして起動します。

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now cc-switch-web
   ```

5. 状態とログを確認します。

   ```bash
   sudo systemctl status cc-switch-web
   sudo journalctl -u cc-switch-web -f
   ```
