# 在容器内完整复现 Web CI 的检查，并以严格模式运行（警告即错误）：
# - pnpm check（Node 脚本语法 + tsc + cargo check）
# - vite build：输出任何 `(!)` 或 warning 行即失败
# - vitest 全量
# - cargo check --all-targets：Linux 原生 + Windows（x86_64-pc-windows-gnu）交叉检查，
#   覆盖 cfg(windows) 与 cfg(unix) 两侧代码
# - cargo test 全量
# Rust 统一使用 RUSTFLAGS="-D warnings"。
#
# 源码作为构建上下文复制进镜像，不挂载宿主目录；cargo / pnpm 使用 BuildKit 缓存卷，
# 重复运行只做增量编译。由 scripts/docker-verify.mjs 调用：
#   docker buildx build -f scripts/docker/verify.Dockerfile --output type=cacheonly .

FROM node:20-bookworm AS node

FROM rust:1.88-bookworm AS verify

# 与 CI（actions/setup-node@v4 node 20 + corepack）保持一致
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && corepack enable

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc-mingw-w64-x86-64 \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add x86_64-pc-windows-gnu

ENV CI=true \
    RUSTFLAGS="-D warnings" \
    CARGO_TARGET_DIR=/cache/target \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=ccsw-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

COPY . .

RUN --mount=type=cache,id=ccsw-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=ccsw-cargo-target-strict,target=/cache/target \
    echo "[verify] pnpm check" && pnpm check

RUN echo "[verify] vite build (strict)" \
    && pnpm exec vite build 2>&1 | tee /tmp/vite.log \
    && if grep -Ei '^\(!\)|warning' /tmp/vite.log; then \
         echo "[verify] vite build emitted warnings" >&2; exit 1; \
       fi

RUN echo "[verify] vitest" && pnpm exec vitest run --exclude '.claude/**'

RUN --mount=type=cache,id=ccsw-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=ccsw-cargo-target-strict,target=/cache/target \
    echo "[verify] cargo check --all-targets (linux)" \
    && cargo check --locked --all-targets --manifest-path backend/Cargo.toml

RUN --mount=type=cache,id=ccsw-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=ccsw-cargo-target-strict-win,target=/cache/target \
    echo "[verify] cargo check --all-targets (windows-gnu)" \
    && cargo check --locked --all-targets --target x86_64-pc-windows-gnu \
         --manifest-path backend/Cargo.toml

RUN --mount=type=cache,id=ccsw-cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=ccsw-cargo-target-strict,target=/cache/target \
    echo "[verify] cargo test" \
    && cargo test --locked --manifest-path backend/Cargo.toml
