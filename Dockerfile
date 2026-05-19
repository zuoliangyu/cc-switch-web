FROM node:20-bookworm AS frontend-builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec vite build


FROM rust:1.88-alpine3.20 AS service-builder

# Populated automatically by Docker BuildKit/buildx from --platform.
# Empty when an old builder is used -> default to amd64 (x86_64).
ARG TARGETARCH
ARG TARGETVARIANT

WORKDIR /app

RUN apk add --no-cache \
    build-base \
    cmake \
    musl-dev \
    perl \
    pkgconf \
    python3

COPY . .
COPY --from=frontend-builder /app/dist ./dist

RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) RUST_TARGET=x86_64-unknown-linux-musl ;; \
      arm64) RUST_TARGET=aarch64-unknown-linux-musl ;; \
      arm) \
        case "${TARGETVARIANT:-v7}" in \
          v7|"") RUST_TARGET=armv7-unknown-linux-musleabihf ;; \
          *) echo "unsupported arm variant: ${TARGETVARIANT}" >&2; exit 1 ;; \
        esac ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    rustup target add "$RUST_TARGET"; \
    cargo build --locked --release --target "$RUST_TARGET" --manifest-path backend/Cargo.toml --bin cc-switch-web; \
    mkdir -p /app/out; \
    cp "backend/target/$RUST_TARGET/release/cc-switch-web" /app/out/cc-switch-web


FROM debian:bookworm-slim AS package-linux-dir

ARG TARGETARCH
ARG TARGETVARIANT

COPY --from=service-builder /app/out/cc-switch-web /tmp/cc-switch-web

RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) LABEL=x64 ;; \
      arm64) LABEL=arm64 ;; \
      arm) \
        case "${TARGETVARIANT:-v7}" in \
          v7|"") LABEL=armv7 ;; \
          *) echo "unsupported arm variant: ${TARGETVARIANT}" >&2; exit 1 ;; \
        esac ;; \
      *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    pkg="/out/cc-switch-web-linux-$LABEL"; \
    mkdir -p "$pkg"; \
    cp /tmp/cc-switch-web "$pkg/cc-switch-web"; \
    chmod +x "$pkg/cc-switch-web"


FROM debian:bookworm-slim AS package-linux-tar

WORKDIR /work

COPY --from=package-linux-dir /out ./

RUN set -eux; \
    pkg="$(ls -d cc-switch-web-linux-*)"; \
    mkdir -p /out; \
    tar -czf "/out/$pkg.tar.gz" "$pkg"


FROM alpine:3.20

WORKDIR /app

ENV HOME=/data \
    CC_SWITCH_WEB_HOST=0.0.0.0 \
    CC_SWITCH_WEB_PORT=8890 \
    CC_SWITCH_WEB_PORT_SCAN_COUNT=1

RUN apk add --no-cache ca-certificates

COPY --from=service-builder /app/out/cc-switch-web /usr/local/bin/cc-switch-web

VOLUME ["/data"]

EXPOSE 8890

CMD ["cc-switch-web"]
