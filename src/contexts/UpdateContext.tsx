import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LatestReleaseInfo } from "@/lib/api/settings";
import { settingsApi } from "@/lib/api";
import { getVersion } from "@/lib/runtime/client/app";

interface UpdateContextValue {
  hasUpdate: boolean;
  latestRelease: LatestReleaseInfo | null;
  updateInfo: LatestReleaseInfo | null;
  isChecking: boolean;
  error: string | null;
  checkUpdate: () => Promise<boolean>;
}

const UpdateContext = createContext<UpdateContextValue | undefined>(undefined);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const [latestRelease, setLatestRelease] = useState<LatestReleaseInfo | null>(
    null,
  );
  const [updateInfo, setUpdateInfo] = useState<LatestReleaseInfo | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCheckingRef = useRef(false);

  const checkUpdate = useCallback(async () => {
    if (isCheckingRef.current) return false;

    isCheckingRef.current = true;
    setIsChecking(true);
    setError(null);

    try {
      const currentVersion = await getVersion();
      const release = await settingsApi.getLatestReleaseInfo(currentVersion);
      setLatestRelease(release);
      setHasUpdate(release.hasUpdate);
      setUpdateInfo(release.hasUpdate ? release : null);
      return release.hasUpdate;
    } catch (err) {
      setError(err instanceof Error ? err.message : "检查更新失败");
      setHasUpdate(false);
      setUpdateInfo(null);
      throw err;
    } finally {
      setIsChecking(false);
      isCheckingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // 打开页面时的自动检查：离线、被 GitHub 限流都很常见，只记一条警告，不算页面出错
      checkUpdate().catch((err) => {
        console.warn("[UpdateContext] Initial update check failed", err);
      });
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [checkUpdate]);

  return (
    <UpdateContext.Provider
      value={{
        hasUpdate,
        latestRelease,
        updateInfo,
        isChecking,
        error,
        checkUpdate,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}

export function useUpdate() {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error("useUpdate must be used within UpdateProvider");
  }
  return context;
}
