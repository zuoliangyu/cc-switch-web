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

const makeFile = (name = "config.sql") =>
  new File(["dummy"], name, { type: "application/sql" });

describe("useImportExport Hook (edge cases)", () => {
  beforeEach(() => {
    importConfigFromUploadMock.mockReset();
    downloadConfigExportMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
    toastInfoMock.mockReset();
    toastWarningMock.mockReset();
  });

  it("selectImportUpload(null) 把 selectedFile 清空，状态保持 idle", () => {
    const { result } = renderHook(() => useImportExport());

    act(() => {
      result.current.selectImportUpload(makeFile("a.sql"));
    });
    expect(result.current.selectedFile).toBe("a.sql");

    act(() => {
      result.current.selectImportUpload(null);
    });
    expect(result.current.selectedFile).toBe("");
    expect(result.current.status).toBe("idle");
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("resetStatus 在导入失败后能清掉错误状态、保留已选文件", async () => {
    const file = makeFile("broken.sql");
    importConfigFromUploadMock.mockResolvedValue({
      success: false,
      message: "broken",
    });

    const { result } = renderHook(() => useImportExport());

    act(() => {
      result.current.selectImportUpload(file);
    });
    await act(async () => {
      await result.current.importConfig();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("broken");

    act(() => {
      result.current.resetStatus();
    });

    expect(result.current.selectedFile).toBe("broken.sql");
    expect(result.current.status).toBe("idle");
    expect(result.current.errorMessage).toBeNull();
    expect(result.current.backupId).toBeNull();
  });

  it("导入失败时 onImportSuccess 不应被调用", async () => {
    const file = makeFile();
    importConfigFromUploadMock.mockResolvedValue({
      success: false,
      message: "invalid",
    });
    const onImportSuccess = vi.fn();
    const { result } = renderHook(() => useImportExport({ onImportSuccess }));

    act(() => {
      result.current.selectImportUpload(file);
    });
    await act(async () => {
      await result.current.importConfig();
    });

    expect(onImportSuccess).not.toHaveBeenCalled();
    expect(result.current.status).toBe("error");
  });

  it("exportConfig 触发后 success toast 含上游返回的 fileName", async () => {
    const blob = new Blob(["x"], { type: "application/sql" });
    downloadConfigExportMock.mockResolvedValue({
      blob,
      fileName: "saved-as.sql",
    });

    const createObjectURL = vi.fn().mockReturnValue("blob:http://t/1");
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

    expect(toastSuccessMock).toHaveBeenCalledWith(
      expect.stringContaining("saved-as.sql"),
      expect.objectContaining({ closeButton: true }),
    );

    anchorClickSpy.mockRestore();
  });
});
