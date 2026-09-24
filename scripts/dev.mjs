import net from "node:net";
import process from "node:process";
import { cargoCmd, spawnInherited } from "./lib/process.mjs";

const defaultFrontendHost = "127.0.0.1";
const children = [];
let shuttingDown = false;

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const defaultFrontendPort = readEnvNumber("CC_SWITCH_WEB_DEV_PORT", 3000);
const defaultBackendHost = process.env.CC_SWITCH_WEB_HOST || "127.0.0.1";
const defaultBackendPort = readEnvNumber("CC_SWITCH_WEB_PORT", 8890);
const defaultBackendScanCount = readEnvNumber("CC_SWITCH_WEB_PORT_SCAN_COUNT", 32);

function printUsage() {
  console.log(
    "Usage: pnpm dev -- [w|d] [-f <frontend-port>] [-b <backend-port>] [--host <host>] [--backend-scan-count <count>]",
  );
  console.log("  w: local development mode (default)");
  console.log("  d: Docker foreground development mode");
  console.log("  -f, --frontend-port       Preferred Vite frontend port");
  console.log("  -b, --backend-port        Preferred Rust backend/web port");
  console.log("      --host                Backend bind host");
  console.log("      --backend-scan-count  Number of backend ports to try");
}

function spawnCommand(command, args, extraEnv = {}) {
  const child = spawnInherited(command, args, {
    env: extraEnv,
  });

  child.on("error", (error) => {
    console.error(`[${command}] failed to start`, error);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    if (signal) {
      console.log(`[${command}] exited with signal ${signal}`);
      return;
    }

    if ((code ?? 0) !== 0) {
      console.error(`[${command}] exited with code ${code}`);
      shutdown(code ?? 1);
    }
  });

  children.push(child);
  return child;
}

function canListen(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    try {
      server.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

async function findAvailablePort(host, preferredPort, maxAttempts = 20) {
  const maxPort = 65535;
  const maxPortAttempts = maxPort - preferredPort + 1;
  const attemptCount = Math.min(Math.max(maxAttempts, 1), maxPortAttempts);

  for (let offset = 0; offset < attemptCount; offset += 1) {
    const port = preferredPort + offset;
    // eslint-disable-next-line no-await-in-loop
    const available = await canListen(host, port);
    if (available) {
      return port;
    }
  }

  throw new Error(
    `[dev] no available port found on ${host} from ${preferredPort} to ${preferredPort + attemptCount - 1}`,
  );
}

function parseNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`[dev] invalid value for ${flag}: ${value}`);
  }
  return parsed;
}

function parseScanCount(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`[dev] invalid value for --backend-scan-count: ${value}`);
  }
  return parsed;
}

function getClientHost(bindHost) {
  return bindHost === "0.0.0.0" ? "127.0.0.1" : bindHost;
}

function parseCliArgs(argv) {
  const options = {
    mode: "w",
    frontendPort: defaultFrontendPort,
    backendPort: defaultBackendPort,
    backendHost: defaultBackendHost,
    backendScanCount: defaultBackendScanCount,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "w" || arg === "d") {
      options.mode = arg;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    }

    if (arg === "-f" || arg === "--frontend-port") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`[dev] ${arg} requires a value`);
      }
      options.frontendPort = parseNumber(value, arg);
      index += 1;
      continue;
    }

    if (arg === "-b" || arg === "--backend-port" || arg === "--port") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`[dev] ${arg} requires a value`);
      }
      options.backendPort = parseNumber(value, arg);
      index += 1;
      continue;
    }

    if (arg === "--host") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("[dev] --host requires a value");
      }
      options.backendHost = value;
      index += 1;
      continue;
    }

    if (arg === "--backend-scan-count") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("[dev] --backend-scan-count requires a value");
      }
      options.backendScanCount = parseScanCount(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--frontend-port=")) {
      options.frontendPort = parseNumber(
        arg.slice("--frontend-port=".length),
        "--frontend-port",
      );
      continue;
    }

    if (arg.startsWith("--backend-port=") || arg.startsWith("--port=")) {
      const value = arg.includes("--backend-port=")
        ? arg.slice("--backend-port=".length)
        : arg.slice("--port=".length);
      options.backendPort = parseNumber(value, "--backend-port");
      continue;
    }

    if (arg.startsWith("--host=")) {
      options.backendHost = arg.slice("--host=".length);
      continue;
    }

    if (arg.startsWith("--backend-scan-count=")) {
      options.backendScanCount = parseScanCount(
        arg.slice("--backend-scan-count=".length),
      );
      continue;
    }

    throw new Error(`[dev] unsupported argument: ${arg}`);
  }

  return options;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(exitCode);
  }, 1500).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function runLocalDevelopment(options) {
  const frontendPort = await findAvailablePort(
    defaultFrontendHost,
    options.frontendPort,
  );
  const backendPort = await findAvailablePort(
    options.backendHost,
    options.backendPort,
    options.backendScanCount,
  );
  const backendClientHost = getClientHost(options.backendHost);
  const apiBase =
    process.env.VITE_LOCAL_API_BASE ||
    `http://${backendClientHost}:${backendPort}`;

  console.log("[dev] mode=w -> local development mode");
  console.log(
    `[dev] backend: ${apiBase} (bind ${options.backendHost}:${backendPort})`,
  );
  console.log(`[dev] frontend: http://${defaultFrontendHost}:${frontendPort}`);
  console.log("[dev] request debug logs: enabled");
  console.log("[dev] backend static frontend: disabled");
  console.log(
    `[dev] open the app in browser at http://${defaultFrontendHost}:${frontendPort}, not ${apiBase}`,
  );

  if (frontendPort !== options.frontendPort) {
    console.log(
      `[dev] frontend port ${options.frontendPort} is in use, switched to ${frontendPort}`,
    );
  }

  if (backendPort !== options.backendPort) {
    console.log(
      `[dev] backend port ${options.backendPort} is unavailable, switched to ${backendPort}`,
    );
  }

  spawnCommand(cargoCmd, [
    "run",
    "--manifest-path",
    "backend/Cargo.toml",
    "--bin",
    "cc-switch-web",
    "--",
    "--host",
    options.backendHost,
    "--backend-port",
    String(backendPort),
    "--port-scan-count",
    "1",
  ], {
    CC_SWITCH_WEB_DEBUG_API:
      process.env.CC_SWITCH_WEB_DEBUG_API || "1",
    CC_SWITCH_WEB_DISABLE_STATIC:
      process.env.CC_SWITCH_WEB_DISABLE_STATIC || "1",
    RUST_LOG: process.env.RUST_LOG || "info",
  });

  spawnCommand(
    "pnpm",
    [
      "exec",
      "vite",
      "--host",
      defaultFrontendHost,
      "--port",
      String(frontendPort),
    ],
    {
      VITE_LOCAL_API_BASE: apiBase,
      VITE_RUNTIME_DEBUG_REQUESTS:
        process.env.VITE_RUNTIME_DEBUG_REQUESTS || "1",
    },
  );
}

async function runDockerDevelopment(options) {
  console.log("[dev] mode=d -> Docker foreground development mode");
  console.log(
    `[dev] docker backend: http://localhost:${options.backendPort} (container bind ${options.backendHost}:${options.backendPort})`,
  );
  if (options.frontendPort !== defaultFrontendPort) {
    console.log(
      `[dev] ignoring frontend port ${options.frontendPort} in Docker mode because Docker serves the embedded frontend on the backend port`,
    );
  }

  spawnCommand("docker", ["compose", "up", "--build"], {
    CC_SWITCH_WEB_HOST: options.backendHost,
    CC_SWITCH_WEB_PORT: String(options.backendPort),
    CC_SWITCH_WEB_PORT_SCAN_COUNT: "1",
  });
}

async function main() {
  // pnpm 10 会把 `pnpm dev -- w` 中的 `--` 原样传入，这里跳过。
  const options = parseCliArgs(
    process.argv.slice(2).filter((arg) => arg !== "--"),
  );

  switch (options.mode) {
    case "w":
      await runLocalDevelopment(options);
      break;
    case "d":
      await runDockerDevelopment(options);
      break;
    default:
      console.error(`[dev] unsupported argument: ${options.mode}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("[dev] failed to start", error);
  process.exit(1);
});
