# CC Switch Web

[中文](README.md) | [English](README_EN.md) | 日本語

## 概要

CC Switch Web は [cc-switch](https://github.com/farion1231/cc-switch) の Web ブランチ用リポジトリで、CC Switch の Web 向け実装とブランチ固有のカスタマイズを管理します。

アーキテクチャと位置付け:

- フロントエンド: Web
- バックエンド: ローカル Rust サービス
- アクセス方法: ブラウザで `http://localhost:xxxx` を開く
- 対象: Windows、macOS、Linux、およびデスクトップのない Linux サーバー

## 使い方

CC Switch Web はローカルで Rust サービスを起動し、Claude、Codex、Gemini、OpenClaw など複数の AI コーディングツールのプロバイダー設定をブラウザから管理・ワンクリック切替できます。

Web ブランチで既に利用できる機能:

- Claude、Codex、Gemini、OpenClaw のプロバイダーモデル取得
- Claude、Codex、Gemini の公式サブスクリプションクォータ表示
- ChatGPT（Codex OAuth）の管理アカウントセンター、Claude プリセット、クォータ表示
- 環境変数競合の検出と整理入口
- `?deeplink=...` または手動入力した `ccswitch://...` による Deep Link 取り込み
- About ページから GitHub の最新リリースページを開く入口
- Provider、Settings、Skills、Sessions の各ページをワークスペース型 UI へ統一

### クイックスタート

1. フロントエンドを埋め込んだ release バイナリをビルドします。

   ```bash
   pnpm install --frozen-lockfile
   pnpm build
   ```

   （Rust `1.88+` が必要です。詳細なビルド / 開発オプションは下記「開発」セクションを参照してください。）

2. バイナリを実行し、ターミナルに表示された最終アドレスを開きます。

   ```bash
   # Linux/macOS
   ./backend/target/release/cc-switch-web --backend-port 8890
   ```

   ```powershell
   # Windows
   .\backend\target\release\cc-switch-web.exe -b 8890
   ```

   リリース版ではフロントエンド静的配信と Web API が同じポートを共有し、デフォルトの優先ポートは `8890` です。ポートが使用中・権限拒否の場合は、自動的に後続ポートを試し、実際にバインドしたポートを出力します。

3. ターミナルに表示されたアドレスをブラウザで開けば利用開始です。

4. データ保存先: ローカル Web サービスモードでは、データは CC Switch のローカル設定ルートに保存されます。

   ```text
   ~/.cc-switch
   ```

   ここには `settings.json`、`cc-switch.db`、バックアップ、統一 Skills ストレージなどが含まれます。旧 `config.json` は現在の Web ランタイムの主データ経路には含まれません。

> Docker で実行する、またはデスクトップのないサーバーで常駐させる場合は、下記「開発」内の「Docker 実行」「Linux systemd サンプル」を参照してください。

## 現在のバージョン

現在のリポジトリバージョンは `0.5.1` です。バージョンごとの変更詳細、各修正と対応するアップストリーム commit、独立タスクへ繰り延べた項目は `CHANGELOG.md` および `docs-dev/web-parity-post-3.14-2026-05.md` を参照してください。

このリポジトリでは `0.1.0` を Web ブランチの初回リリース基準として扱います。以前に引き継がれていた過去のリリース履歴は削除しており、より古い履歴はアップストリーム側を参照してください。

## アップストリームとの関係

- アップストリームプロジェクト: [cc-switch](https://github.com/farion1231/cc-switch)
- 現在の Web リポジトリ: [zuoliangyu/zuoliangyu-cc-switch-web](https://github.com/zuoliangyu/zuoliangyu-cc-switch-web)
- 作者: 左岚（[Bilibili](https://space.bilibili.com/27619688)）
- このリポジトリは CC Switch の Web ブランチ方向に焦点を当てています
- 元の CC Switch プロジェクトやアップストリームのリリース情報を確認したい場合は、上流リポジトリを直接参照してください
- プロジェクトの位置付けや外部向け説明が変わった場合は、このリポジトリ内の各言語版 README を同期して更新してください

## 開発

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
