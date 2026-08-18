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

CC Switch Web はローカルで Rust サービスを起動し、Claude、Claude Desktop、Codex、Gemini、Grok Build、OpenCode、OpenClaw、Hermes、Pi などの AI コーディングツールのプロバイダー設定をブラウザから管理・ワンクリック切替できます。

Web ブランチで既に利用できる機能:

- Claude、Claude Desktop、Codex、Gemini、Grok Build、OpenCode、OpenClaw、Hermes、Pi の Provider 管理
- Pi の Provider、Prompts、Skills、Sessions、Usage。Pi の `/login`、`auth.json`、デフォルト Provider/Model、プロキシ、フェイルオーバー、OAuth 管理は Pi 本体が所有
- Claude、Codex、Gemini の公式サブスクリプションクォータ表示
- ChatGPT（Codex OAuth）の管理アカウントセンター、Claude プリセット、クォータ表示
- Claude → Codex ルーティングの組み込み WebSearch と Codex ルートの Alpha Search パススルー
- 環境変数競合の検出と整理入口
- `?deeplink=...` または手動入力した `ccswitch://...` による Deep Link 取り込み
- About ページから GitHub の最新リリースページを開く入口
- Provider、Settings、Skills、Sessions の各ページをワークスペース型 UI へ統一

Pi の設定所有権、同期ルール、モデル能力、UI 制約は [Pi ネイティブ契約と実装境界](docs/pi-native-contract-zh.md) および同じディレクトリの Pi 関連文書を参照してください。

### クイックスタート

#### 方法 1：ビルド済み Release

1. [GitHub Releases](https://github.com/zuoliangyu/cc-switch-web/releases/latest) を開き、お使いのシステム向けの最新ビルド済みパッケージをダウンロードします。

   | システム | ダウンロードファイル |
   | --- | --- |
   | Windows x64 | `cc-switch-web-windows-x64.zip` |
   | macOS（Intel / Apple Silicon） | `cc-switch-web-macos-universal.zip` |
   | Linux x64 | `cc-switch-web-linux-x64.tar.gz` |
   | Linux ARM64 | `cc-switch-web-linux-arm64.tar.gz` |

2. アーカイブを展開し、バイナリを含むディレクトリへ移動して、そのまま実行します。

   ```powershell
   # Windows
   .\cc-switch-web.exe
   ```

   ```bash
   # Linux/macOS
   chmod +x ./cc-switch-web
   ./cc-switch-web
   ```

   リリース版ではフロントエンド静的配信と Web API が同じポートを共有し、デフォルトの優先ポートは `8890` です。ポートが使用中・権限拒否の場合は、自動的に後続ポートを試し、実際にバインドしたポートを出力します。

3. ターミナルに表示されたアドレスをブラウザで開けば利用開始です。Docker、systemd、またはソースからのビルドについては、下記「開発」を参照してください。

4. データ保存先: ローカル Web サービスモードでは、Web データは独立したディレクトリに保存されます。

   ```text
   ~/.cc-switch-web
   ```

   ここには `settings.json`、`cc-switch.db`、バックアップ、統一 Skills ストレージなどが含まれます。初回起動時にこのディレクトリが存在せず、`~/.cc-switch/cc-switch.db` が見つかった場合は、読み取り専用で移行します。Web が移行元データベースを変更することはありません。CC Switch データベースが見つからない場合は移行をスキップし、新しい Web データを初期化します。旧 `config.json` は現在の Web ランタイムの主データ経路には含まれません。

#### 方法 2：Docker

```bash
docker pull ghcr.io/zuoliangyu/cc-switch-web:latest
docker run -d --name cc-switch-web \
  -p 127.0.0.1:8890:8890 \
  -v cc-switch-web-data:/data \
  --restart unless-stopped \
  ghcr.io/zuoliangyu/cc-switch-web:latest
```

[http://localhost:8890](http://localhost:8890) を開くと利用できます。Web データは `cc-switch-web-data` volume に永続化され、新しい volume では新規 Web データが初期化されます。現在の GHCR ランタイムイメージは `linux/amd64` のみ対応しているため、ARM64 では Release パッケージを使用してください。デフォルトでは、コンテナは volume 内のデータのみを管理します。CC Switch データの移行、ホスト側の CLI 設定管理、または LAN / 公開ネットワークへのデプロイについては、下記「Docker 実行」「アクセスキー」「Linux systemd サンプル」を参照してください。

## 現在のバージョン

現在のリポジトリバージョンは `2.1.0` です。本バージョンでは、最新のアップストリーム Provider と reasoning 機能、Codex OAuth ライフサイクル、Hosted WebSearch、安全な Windows ネイティブ CLI 検出を追加し、サードパーティ Provider の履歴セッション移行と全テストの安定性を修正しました。リリース詳細とアップストリーム移行台帳は `CHANGELOG.md` および `docs-dev/web-parity-post-40cac1a6-2026-08.md` を参照してください。

このリポジトリでは `0.1.0` を Web ブランチの初回リリース基準として扱います。以前に引き継がれていた過去のリリース履歴は削除しており、より古い履歴はアップストリーム側を参照してください。

## アップストリームとの関係

- アップストリームプロジェクト: [cc-switch](https://github.com/farion1231/cc-switch)
- 現在の Web リポジトリ: [zuoliangyu/cc-switch-web](https://github.com/zuoliangyu/cc-switch-web)
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

### ソースから Release バイナリをビルド

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

4. ローカル Web サービスモードでは、CC Switch Web 自身のデータは独立したディレクトリに保存されます。

   ```text
   ~/.cc-switch-web
   ```

   ここには `settings.json`、`cc-switch.db`、バックアップ、統一 Skills ストレージなどが保存されます。初回起動時にこのディレクトリが存在しない場合、`~/.cc-switch` から読み取り専用で移行します。設定画面から手動で再移行する場合も、先に Web データをバックアップします。Web が CC Switch の移行元データベースを変更することはありません。旧 `config.json` は現在の Web ランタイムの主データ経路には含まれません。

### アクセスキー（任意）

`CC_SWITCH_WEB_ACCESS_KEY` を設定すると Web API を保護できます。キーは 16 文字以上が必要です。未設定または空の場合は、従来どおり認証なしで動作します。

```bash
CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' ./backend/target/release/cc-switch-web
```

PowerShell:

```powershell
$env:CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key'; .\backend\target\release\cc-switch-web.exe
```

認証後、ブラウザは現在のタブの `sessionStorage` にのみキーを保存します。LAN またはインターネットへ公開する場合も HTTPS リバースプロキシを使用してください。アクセスキーは認証を提供しますが、通信自体は暗号化しません。

### Docker 実行

リリースワークフローは `linux/amd64` ランタイムイメージを GitHub Container Registry へ公開します。

```bash
docker pull ghcr.io/zuoliangyu/cc-switch-web:latest
docker run -d --name cc-switch-web \
  -p 8890:8890 \
  -e CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' \
  -v cc-switch-web-data:/data \
  ghcr.io/zuoliangyu/cc-switch-web:latest
```

バージョン tag では対応する `vX.Y.Z`、`X.Y.Z`、`X.Y` のイメージタグも公開します。Registry のランタイムイメージは現在 `linux/amd64` のみです。arm64 は後述の単体静的バイナリパッケージを利用してください。

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

   Compose でアクセスキーを有効にする場合:

   ```bash
   CC_SWITCH_WEB_ACCESS_KEY='replace-with-a-long-random-key' docker compose up -d
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

   このサンプルは主に Linux サーバー向けで、`$HOME` 配下の `.claude`、`.codex`、`.gemini`、`.config/opencode`、`.config/openclaw` を前提にしています。CC Switch データの自動移行または手動移行を有効にするには、`${HOME}/.cc-switch:/data/.cc-switch:ro` のコメントを解除してください。移行元はコンテナ内でも読み取り専用です。

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
