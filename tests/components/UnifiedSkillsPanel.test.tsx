import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRef } from "react";
import {
  render as rtlRender,
  screen,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import UnifiedSkillsPanel, {
  type UnifiedSkillsPanelHandle,
} from "@/components/skills/UnifiedSkillsPanel";

const scanUnmanagedMock = vi.fn();
const toggleSkillAppMock = vi.fn();
const uninstallSkillMock = vi.fn();
const importSkillsMock = vi.fn();
const installFromZipMock = vi.fn();
const deleteSkillBackupMock = vi.fn();
const restoreSkillBackupMock = vi.fn();
const bulkToggleSkillAppMock = vi.fn();
const checkUpdatesMock = vi.fn();
const updateSkillMock = vi.fn();
let installedSkills: any[] = [];
let skillUpdates: any[] | undefined;

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/hooks/useSkills", () => ({
  useSkillRepoFailures: () => ({ data: [] }),
  useInstalledSkills: () => ({
    data: installedSkills,
    isLoading: false,
  }),
  useSkillBackups: () => ({
    data: [],
    refetch: vi.fn(),
    isFetching: false,
  }),
  useDeleteSkillBackup: () => ({
    mutateAsync: deleteSkillBackupMock,
    isPending: false,
  }),
  useToggleSkillApp: () => ({
    mutateAsync: toggleSkillAppMock,
    isPending: false,
  }),
  useBulkToggleSkillApp: () => ({
    mutateAsync: bulkToggleSkillAppMock,
    isPending: false,
    variables: undefined,
  }),
  useRestoreSkillBackup: () => ({
    mutateAsync: restoreSkillBackupMock,
    isPending: false,
  }),
  useUninstallSkill: () => ({
    mutateAsync: uninstallSkillMock,
  }),
  useScanUnmanagedSkills: () => ({
    data: [
      {
        directory: "shared-skill",
        name: "Shared Skill",
        description: "Imported from Claude",
        foundIn: ["claude"],
        path: "/tmp/shared-skill",
      },
    ],
    refetch: scanUnmanagedMock,
  }),
  useImportSkillsFromApps: () => ({
    mutateAsync: importSkillsMock,
  }),
  useInstallSkillArchives: () => ({
    mutateAsync: installFromZipMock,
  }),
  useCheckSkillUpdates: () => ({
    data: skillUpdates,
    refetch: checkUpdatesMock,
    isFetching: false,
    isLoading: false,
  }),
  useUpdateSkill: () => ({
    mutateAsync: updateSkillMock,
    isPending: false,
  }),
}));

describe("UnifiedSkillsPanel", () => {
  beforeEach(() => {
    scanUnmanagedMock.mockResolvedValue({
      data: [
        {
          directory: "shared-skill",
          name: "Shared Skill",
          description: "Imported from Claude",
          foundIn: ["claude"],
          path: "/tmp/shared-skill",
        },
      ],
    });
    toggleSkillAppMock.mockReset();
    uninstallSkillMock.mockReset();
    importSkillsMock.mockReset();
    installFromZipMock.mockReset();
    deleteSkillBackupMock.mockReset();
    restoreSkillBackupMock.mockReset();
    bulkToggleSkillAppMock.mockReset();
    bulkToggleSkillAppMock.mockResolvedValue({ succeeded: [], failed: [] });
    installedSkills = [];
    skillUpdates = undefined;
    checkUpdatesMock.mockReset();
    updateSkillMock.mockReset().mockResolvedValue(undefined);
  });

  it("opens the import dialog without crashing when app toggles render", async () => {
    const ref = createRef<UnifiedSkillsPanelHandle>();

    render(
      <UnifiedSkillsPanel
        ref={ref}
        onOpenDiscovery={() => {}}
        currentApp="claude"
      />,
    );

    await act(async () => {
      await ref.current?.openImport();
    });

    await waitFor(() => {
      expect(screen.getByText("skills.import")).toBeInTheDocument();
      expect(screen.getByText("Shared Skill")).toBeInTheDocument();
      expect(screen.getByText("/tmp/shared-skill")).toBeInTheDocument();
    });
  });

  it("搜索过滤时批量开关只作用于匹配 Skill", async () => {
    installedSkills = [
      {
        id: "alpha",
        name: "Alpha",
        directory: "alpha",
        apps: {},
        installedAt: 1,
        updatedAt: 1,
      },
      {
        id: "beta",
        name: "Beta",
        directory: "beta",
        apps: {},
        installedAt: 1,
        updatedAt: 1,
      },
    ];

    render(
      <UnifiedSkillsPanel onOpenDiscovery={() => {}} currentApp="claude" />,
    );
    await userEvent.type(screen.getByRole("textbox"), "Alpha");
    await userEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(bulkToggleSkillAppMock).toHaveBeenCalledWith({
      ids: ["alpha"],
      app: "claude",
      enabled: true,
    });
  });

  it("检查到更新后列出将要更新的 Skill，确认后逐个更新", async () => {
    installedSkills = [
      {
        id: "alpha",
        name: "Alpha",
        directory: "alpha",
        repoOwner: "owner",
        repoName: "repo",
        apps: {},
        installedAt: 1,
        updatedAt: 1,
      },
    ];
    // 检查完之后卸掉的 Skill 不该再出现在「全部更新」里
    skillUpdates = [
      { id: "alpha", name: "Alpha" },
      { id: "gone", name: "Gone" },
    ];
    checkUpdatesMock.mockResolvedValue({ data: skillUpdates });

    render(
      <UnifiedSkillsPanel onOpenDiscovery={() => {}} currentApp="claude" />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /skills\.checkUpdates/ }),
    );

    const list = await screen.findByRole("list", {
      name: "skills.confirmUpdateAll.listAria",
    });
    expect(list).toHaveTextContent("Alpha");
    expect(list).toHaveTextContent("owner/repo");
    expect(list).not.toHaveTextContent("Gone");

    await userEvent.click(
      screen.getByRole("button", { name: "skills.confirmUpdateAll.button" }),
    );
    await waitFor(() => expect(updateSkillMock).toHaveBeenCalledWith("alpha"));
    expect(updateSkillMock).toHaveBeenCalledTimes(1);
  });
});

function render(ui: React.ReactElement) {
  return rtlRender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
