const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_DIM_MS = 300;

let initialized = false;
let heartbeatInterval: number | undefined;
let heartbeatReset: number | undefined;

function stopHeartbeat() {
  if (heartbeatInterval !== undefined) window.clearInterval(heartbeatInterval);
  if (heartbeatReset !== undefined) window.clearTimeout(heartbeatReset);
  heartbeatInterval = undefined;
  heartbeatReset = undefined;
  delete document.documentElement.dataset.statusHeartbeat;
}

function setWindowActive(active: boolean) {
  document.documentElement.dataset.windowActive = String(active);
  stopHeartbeat();
  if (!active) return;

  heartbeatInterval = window.setInterval(() => {
    document.documentElement.dataset.statusHeartbeat = "true";
    heartbeatReset = window.setTimeout(() => {
      delete document.documentElement.dataset.statusHeartbeat;
      heartbeatReset = undefined;
    }, HEARTBEAT_DIM_MS);
  }, HEARTBEAT_INTERVAL_MS);
}

export function initializeWindowActivity() {
  if (initialized) return;
  initialized = true;

  const update = () =>
    setWindowActive(
      document.visibilityState === "visible" && document.hasFocus(),
    );
  update();
  window.addEventListener("focus", update);
  window.addEventListener("blur", update);
  document.addEventListener("visibilitychange", update);
}
