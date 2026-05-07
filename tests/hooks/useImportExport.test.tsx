import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useImportExport } from "@/hooks/useImportExport";

const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const toastInfoMock = vi.fn();
const toastWarningMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
    info: (...args: unknown[]) => toastInfoMock(...args),
    warning: (...args: unknown[]) => toastWarningMock(...args),
  },
}));

const importConfigFromUploadMock = vi.fn();
const downloadConfigExportMock = vi.fn();

vi.mock("@/lib/api", () => ({
  settingsApi: {
    importConfigFromUpload: (...args: unknown[]) =>
      importConfigFromUploadMock(...args),
    downloadConfigExport: (...args: unknown[]) =>
      downloadConfigExportMock(...args),
  },
}));

beforeEach(() => {
  importConfigFromUploadMock.mockReset();
  downloadConfigExportMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  toastInfoMock.mockReset();
  toastWarningMock.mockReset();
});

const makeFile = (name = "config.sql") =>
  new File(["dummy-sql-content"], name, { type: "application/sql" });

describe("useImportExport Hook", () => {
  it("selectImportUpload 设置文件后 selectedFile 为文件名、status 重置为 idle", () => {
    const { result } = renderHook(() => useImportExport());

    act(() => {
      result.current.selectImportUpload(makeFile("backup-1.sql"));
    });

    expect(result.current.selectedFile).toBe("backup-1.sql");
    expect(result.current.status).toBe("idle");
    expect(result.current.errorMessage).toBeNull();
  });

  it("selectImportFile 在 Web 端只提示用户用文件选择器，不调任何 dialog API", async () => {
    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.selectImportFile();
    });

    expect(toastInfoMock).toHaveBeenCalledTimes(1);
    expect(result.current.selectedFile).toBe("");
  });

  it("没选择文件直接 importConfig 时报错，不调上传接口", async () => {
    const { result } = renderHook(() =>
      useImportExport({ onImportSuccess: vi.fn() }),
    );

    await act(async () => {
      await result.current.importConfig();
    });

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
    expect(importConfigFromUploadMock).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("成功导入后 status=success、记录 backupId、调 onImportSuccess、success toast", async () => {
    const file = makeFile();
    importConfigFromUploadMock.mockResolvedValue({
      success: true,
      backupId: "backup-123",
    });
    const onImportSuccess = vi.fn();

    const { result } = renderHook(() => useImportExport({ onImportSuccess }));

    act(() => {
      result.current.selectImportUpload(file);
    });
    await act(async () => {
      await result.current.importConfig();
    });

    expect(importConfigFromUploadMock).toHaveBeenCalledWith(file);
    expect(result.current.status).toBe("success");
    expect(result.current.backupId).toBe("backup-123");
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);
    expect(onImportSuccess).toHaveBeenCalledTimes(1);
  });

  it("导入返回 {success:false,message} 时进入 error 态、保留已选文件、错误 toast", async () => {
    const file = makeFile("bad.sql");
    importConfigFromUploadMock.mockResolvedValue({
      success: false,
      message: "Config corrupted",
    });

    const { result } = renderHook(() => useImportExport());

    act(() => {
      result.current.selectImportUpload(file);
    });
    await act(async () => {
      await result.current.importConfig();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Config corrupted");
    expect(result.current.selectedFile).toBe("bad.sql");
    expect(toastErrorMock).toHaveBeenCalledWith("Config corrupted");
  });

  it("导入返回 warning 时进入 partial-success 态并显示 warning toast", async () => {
    const file = makeFile();
    importConfigFromUploadMock.mockResolvedValue({
      success: true,
      backupId: "b-1",
      warning: "live config sync skipped",
    });

    const { result } = renderHook(() => useImportExport());

    act(() => {
      result.current.selectImportUpload(file);
    });
    await act(async () => {
      await result.current.importConfig();
    });

    expect(result.current.status).toBe("partial-success");
    expect(toastWarningMock).toHaveBeenCalledTimes(1);
  });

  it("导入抛异常时捕获并设置 errorMessage、错误 toast 含异常信息", async () => {
    const file = makeFile();
    importConfigFromUploadMock.mockRejectedValue(new Error("Import failed"));

    const { result } = renderHook(() => useImportExport());

    act(() => {
      result.current.selectImportUpload(file);
    });
    await act(async () => {
      await result.current.importConfig();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("Import failed");
    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("导入配置失败:"),
    );
  });

  it("exportConfig 成功：触发下载、调 createObjectURL/anchor.click、success toast", async () => {
    const blob = new Blob(["x"], { type: "application/sql" });
    downloadConfigExportMock.mockResolvedValue({
      blob,
      fileName: "cc-switch-export.sql",
    });

    // jsdom 25 不带 URL.createObjectURL / revokeObjectURL，直接挂 stub。
    const createObjectURL = vi.fn().mockReturnValue("blob:http://test/123");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });
    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.exportConfig();
    });

    expect(downloadConfigExportMock).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchorClickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://test/123");
    expect(toastSuccessMock).toHaveBeenCalledTimes(1);

    anchorClickSpy.mockRestore();
  });

  it("exportConfig 失败时显示错误 toast，包含异常信息", async () => {
    downloadConfigExportMock.mockRejectedValue(new Error("Disk read-only"));

    const { result } = renderHook(() => useImportExport());

    await act(async () => {
      await result.current.exportConfig();
    });

    expect(toastErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Disk read-only"),
    );
  });

  it("clearSelection 重置 selectedFile/status/errorMessage/backupId", () => {
    const { result } = renderHook(() => useImportExport());

    act(() => {
      result.current.selectImportUpload(makeFile());
    });
    act(() => {
      result.current.clearSelection();
    });

    expect(result.current.selectedFile).toBe("");
    expect(result.current.status).toBe("idle");
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.backupId).toBeNull();
  });

  it("resetStatus 仅清错误信息和 backupId，不影响 selectedFile", () => {
    const { result } = renderHook(() => useImportExport());

    act(() => {
      result.current.selectImportUpload(makeFile("keep.sql"));
    });
    act(() => {
      result.current.resetStatus();
    });

    expect(result.current.selectedFile).toBe("keep.sql");
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.backupId).toBeNull();
  });
});
