import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { runOrExit } from "./lib/process.mjs";

// 在 Docker 内复现 CI 的 Linux 流程：源码作为构建上下文复制进容器，
// 不挂载宿主目录，避免 Windows 文件共享的性能与行为差异。
const STEPS = ["verify", "package-x64", "package-arm64", "smoke"];
const IMAGE = "cc-switch-web:docker-verify";
const CONTAINER = "cc-switch-web-docker-verify";
const OUTPUT_ROOT = path.join("release", "docker-artifacts");

function printUsage() {
  console.log("Usage: pnpm verify:docker -- [all|verify|package|smoke] ...");
  console.log(
    "  all      依次执行 verify、Linux x64/arm64 打包与镜像冒烟（默认）",
  );
  console.log(
    "  verify   严格模式（警告即错误）：pnpm check、vite build、vitest、cargo check（Linux + Windows 交叉）、cargo test",
  );
  console.log(
    "  package  导出 linux-x64 与 linux-arm64 发布包到 release/docker-artifacts",
  );
  console.log("  smoke    构建最终镜像并检查 /api/health");
  console.log("环境变量：CC_SWITCH_WEB_SMOKE_PORT（默认 8890）");
}

function resolveSteps(args) {
  if (args.length === 0 || args.includes("all")) {
    return STEPS;
  }
  const steps = new Set();
  for (const arg of args) {
    if (arg === "verify" || arg === "smoke") steps.add(arg);
    else if (arg === "package") {
      steps.add("package-x64");
      steps.add("package-arm64");
    } else if (STEPS.includes(arg)) steps.add(arg);
    else {
      console.error(`[docker-verify] unsupported argument: ${arg}`);
      printUsage();
      process.exit(1);
    }
  }
  return STEPS.filter((step) => steps.has(step));
}

function docker(args, options) {
  runOrExit("docker", args, {
    env: { DOCKER_BUILDKIT: "1" },
    // docker 是可执行文件，不需要 shell；避免 Node 的 DEP0190（参数未转义）警告
    shell: false,
    ...options,
  });
}

// 清理与日志类命令允许失败（例如容器不存在），不能走 runOrExit。
function dockerTry(args, stdio = "ignore") {
  spawnSync("docker", args, { stdio });
}

function runVerify() {
  docker([
    "buildx",
    "build",
    "--progress=plain",
    "--file",
    "scripts/docker/verify.Dockerfile",
    "--target",
    "verify",
    "--output",
    "type=cacheonly",
    ".",
  ]);
}

// 不用 `--output type=local`：它会把整个 debian 阶段（含 bin -> usr/bin 等符号链接）
// 写回宿主目录，Windows 无符号链接权限时导出失败。这里构建成临时镜像，只拷出 /out。
function runPackage(label, dockerfile) {
  const dest = path.join(OUTPUT_ROOT, label);
  const image = `cc-switch-web:package-${label}`;
  const container = `cc-switch-web-package-${label}`;
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  docker([
    "buildx",
    "build",
    "--progress=plain",
    "--file",
    dockerfile,
    "--target",
    "package-linux-tar",
    // 严格模式：release 构建同样警告即错误
    "--build-arg",
    "RUSTFLAGS=-D warnings",
    "--load",
    "--tag",
    image,
    ".",
  ]);
  dockerTry(["rm", "-f", container]);
  try {
    // 该阶段没有 CMD，create 时给一个占位命令，容器不会启动
    docker(["create", "--name", container, image, "true"]);
    docker(["cp", `${container}:/out/.`, dest]);
  } finally {
    dockerTry(["rm", "-f", container]);
    dockerTry(["image", "rm", image]);
  }
  const archives = fs
    .readdirSync(dest, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".tar.gz"));
  if (archives.length === 0) {
    console.error(`[docker-verify] no archive exported under ${dest}`);
    process.exit(1);
  }
  for (const archive of archives) {
    console.log(`[docker-verify] ${label}: ${path.join(dest, archive)}`);
  }
}

async function runSmoke() {
  const port = Number(process.env.CC_SWITCH_WEB_SMOKE_PORT) || 8890;
  docker([
    "build",
    "--progress=plain",
    "--build-arg",
    "RUSTFLAGS=-D warnings",
    "-t",
    IMAGE,
    ".",
  ]);
  dockerTry(["rm", "-f", CONTAINER]);
  const cleanup = () => dockerTry(["rm", "-f", CONTAINER]);
  docker(["run", "-d", "--name", CONTAINER, "-p", `${port}:8890`, IMAGE]);
  const url = `http://127.0.0.1:${port}/api/health`;
  try {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          console.log(`[docker-verify] smoke passed: ${url}`);
          return;
        }
      } catch {
        // 等待服务启动与数据库迁移
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.error("[docker-verify] health check timeout");
    dockerTry(["logs", CONTAINER], "inherit");
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (args.includes("-h") || args.includes("--help")) {
  printUsage();
  process.exit(0);
}

const steps = resolveSteps(args);
for (const step of steps) {
  console.log(`\n[docker-verify] ===== ${step} =====`);
  if (step === "verify") runVerify();
  else if (step === "package-x64") runPackage("linux-x64", "Dockerfile");
  else if (step === "package-arm64")
    runPackage("linux-arm64", "Dockerfile.arm64");
  else if (step === "smoke") await runSmoke();
  if (process.exitCode) process.exit(process.exitCode);
}
console.log(`\n[docker-verify] all passed: ${steps.join(", ")}`);
