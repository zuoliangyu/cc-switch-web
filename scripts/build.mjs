import process from "node:process";
import { cargoCmd, runOrExit } from "./lib/process.mjs";

const mode = (process.argv[2] || "w").toLowerCase();

function printUsage() {
  console.log("Usage: pnpm build <w|d>");
  console.log("  w: local release build (frontend bundle + embedded Rust binary)");
  console.log("  d: Docker image build");
}

switch (mode) {
  case "w":
    console.log("[build] mode=w -> local release build");
    runOrExit("pnpm", ["exec", "vite", "build"]);
    runOrExit(cargoCmd, [
      "build",
      "--release",
      "--manifest-path",
      "backend/Cargo.toml",
      "--bin",
      "cc-switch-web",
    ]);
    break;
  case "d":
    console.log("[build] mode=d -> Docker image build");
    runOrExit("docker", ["compose", "build"]);
    break;
  default:
    console.error(`[build] unsupported argument: ${mode}`);
    printUsage();
    process.exit(1);
}
