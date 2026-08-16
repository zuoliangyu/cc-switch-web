import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImportExportSection } from "@/components/settings/ImportExportSection";

const tMock = vi.fn((key: string) => key);
const migrateFromCcSwitchMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tMock }),
}));

vi.mock("@/lib/api", () => ({
  settingsApi: {
    migrateFromCcSwitch: (...args: unknown[]) =>
      migrateFromCcSwitchMock(...args),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ImportExportSection Component", () => {
  const baseProps = {
    status: "idle" as const,
    selectedFile: "",
    errorMessage: null,
    backupId: null,
    isImporting: false,
    onSelectFile: vi.fn(),
    onImport: vi.fn(),
    onExport: vi.fn(),
    onClear: vi.fn(),
  };

  beforeEach(() => {
    tMock.mockImplementation((key: string) => key);
    baseProps.onSelectFile.mockReset();
    baseProps.onImport.mockReset();
    baseProps.onExport.mockReset();
    baseProps.onClear.mockReset();
    migrateFromCcSwitchMock.mockReset();
  });

  it("should disable import button and show placeholder when no file selected", () => {
    render(<ImportExportSection {...baseProps} />);

    // When no file selected, button shows "selectConfigFile" and clicking it opens file dialog
    expect(
      screen.getByRole("button", { name: /settings\.selectConfigFile/ }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "settings.exportConfig" }),
    );
    expect(baseProps.onExport).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: /settings\.selectConfigFile/ }),
    );
    expect(baseProps.onSelectFile).toHaveBeenCalledTimes(1);
  });

  it("should show filename and enable import/clear when file is selected", () => {
    render(
      <ImportExportSection
        {...baseProps}
        selectedFile={"/tmp/test/config.json"}
      />,
    );

    expect(screen.getByText(/config\.json/)).toBeInTheDocument();
    const importButton = screen.getByRole("button", {
      name: /settings\.import/,
    });
    expect(importButton).toBeEnabled();
    fireEvent.click(importButton);
    expect(baseProps.onImport).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "common.clear" }));
    expect(baseProps.onClear).toHaveBeenCalledTimes(1);
  });

  it("should show loading text and disable import button during import", () => {
    render(
      <ImportExportSection
        {...baseProps}
        selectedFile={"/tmp/test/config.json"}
        isImporting
        status="importing"
      />,
    );

    const importingLabels = screen.getAllByText("settings.importing");
    expect(importingLabels.length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByRole("button", { name: "settings.importing" }),
    ).toBeDisabled();
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("should display backup information on successful import", () => {
    render(
      <ImportExportSection
        {...baseProps}
        selectedFile={"/tmp/test/config.json"}
        status="success"
        backupId="backup-001"
      />,
    );

    expect(screen.getByText("settings.importSuccess")).toBeInTheDocument();
    expect(screen.getByText(/backup-001/)).toBeInTheDocument();
    expect(screen.getByText("settings.autoReload")).toBeInTheDocument();
  });

  it("should display error message when import fails", () => {
    render(
      <ImportExportSection
        {...baseProps}
        status="error"
        errorMessage="Parse failed"
      />,
    );

    expect(screen.getByText("settings.importFailed")).toBeInTheDocument();
    expect(screen.getByText("Parse failed")).toBeInTheDocument();
  });

  it("requires confirmation before migrating desktop data in web mode", async () => {
    const onMigrationSuccess = vi.fn();
    migrateFromCcSwitchMock.mockResolvedValue({
      migrated: true,
      backupId: "db_backup_001",
      sourceVersion: 16,
      copiedFiles: ["settings.json"],
    });
    render(
      <ImportExportSection
        {...baseProps}
        isWebMode
        onMigrationSuccess={onMigrationSuccess}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.ccSwitchMigration.action",
      }),
    );
    expect(migrateFromCcSwitchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("settings.ccSwitchMigration.confirmTitle"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.ccSwitchMigration.confirmAction",
      }),
    );

    await waitFor(() =>
      expect(migrateFromCcSwitchMock).toHaveBeenCalledTimes(1),
    );
    expect(onMigrationSuccess).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("settings.ccSwitchMigration.backupCreated"),
    ).toBeInTheDocument();
  });
});
