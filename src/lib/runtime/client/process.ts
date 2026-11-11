export async function exit(code = 0): Promise<void> {
  console.warn(`[runtime:web] exit(${code}) ignored in browser mode`);
}

export async function relaunch(): Promise<void> {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
