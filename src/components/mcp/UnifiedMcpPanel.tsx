import { WindowedRows } from "@/components/common/WindowedRows";
import { ResyncButton } from "@/components/common/ResyncButton";
import { mcpApi } from "@/lib/api/mcp";
import React, { useMemo, useState } from "react";
import { useMcpConnectivity } from "@/hooks/useMcpConnectivity";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { Activity, Search, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  useAllMcpServers,
  useBulkToggleMcpApp,
  useToggleMcpApp,
  useDeleteMcpServer,
  useImportMcpFromApps,
} from "@/hooks/useMcp";
import type { McpServer, VisibleApps } from "@/types";
import type { AppId } from "@/lib/api/types";
import McpFormModal from "./McpFormModal";
import { ConfirmDialog } from "../ConfirmDialog";
import { Edit3, Trash2, ExternalLink } from "lucide-react";
import { settingsApi } from "@/lib/api";
import { mcpPresets } from "@/config/mcpPresets";
import { toast } from "sonner";
import { MCP_APP_IDS, type McpAppId } from "@/config/appConfig";
import { AppCountBar } from "@/components/common/AppCountBar";
import { AppToggleGroup } from "@/components/common/AppToggleGroup";
import { ListItemRow } from "@/components/common/ListItemRow";
import { ManagementListSearch } from "@/components/common/ManagementListSearch";
import {
  extractErrorMessage,
  translateMcpBackendError,
} from "@/utils/errorUtils";

interface UnifiedMcpPanelProps {
  visibleApps?: VisibleApps;
  onOpenChange: (open: boolean) => void;
}

export interface UnifiedMcpPanelHandle {
  openAdd: () => void;
  openImport: () => void;
}

const UnifiedMcpPanel = React.forwardRef<
  UnifiedMcpPanelHandle,
  UnifiedMcpPanelProps
>(({ onOpenChange: _onOpenChange, visibleApps }, ref) => {
  const visibleAppIds = MCP_APP_IDS.filter(
    (app) => visibleApps?.[app] !== false,
  );
  const { t } = useTranslation();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const { data: serversMap, isLoading } = useAllMcpServers();
  // 只在用户点击时检查：检查会运行配置的命令（npx 下载、OAuth 弹窗、容器），打开页面不能触发
  const connectivity = useMcpConnectivity(serversMap);
  const toggleAppMutation = useToggleMcpApp();
  const bulkToggleAppMutation = useBulkToggleMcpApp();
  const deleteServerMutation = useDeleteMcpServer();
  const importMutation = useImportMcpFromApps();

  const serverEntries = useMemo((): Array<[string, McpServer]> => {
    if (!serversMap) return [];
    return Object.entries(serversMap);
  }, [serversMap]);

  const filteredServerEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return serverEntries;
    return serverEntries.filter(([id, server]) => {
      const spec = server.server ?? {};
      const searchable = [
        id,
        server.name,
        server.description,
        ...(server.tags ?? []),
        spec.type,
        spec.command,
        ...(spec.args ?? []),
        spec.cwd,
        spec.url,
        server.homepage,
        server.docs,
      ];
      return searchable.some(
        (value) =>
          typeof value === "string" && value.toLowerCase().includes(query),
      );
    });
  }, [searchQuery, serverEntries]);

  const writePending =
    toggleAppMutation.isPending || bulkToggleAppMutation.isPending;

  const enabledCounts = useMemo(() => {
    const counts = {
      claude: 0,
      "claude-desktop": 0,
      codex: 0,
      gemini: 0,
      grokbuild: 0,
      opencode: 0,
      openclaw: 0,
      hermes: 0,
      pi: 0,
      mcode: 0,
    };
    filteredServerEntries.forEach(([_, server]) => {
      for (const app of MCP_APP_IDS) {
        if (server.apps[app]) counts[app]++;
      }
    });
    return counts;
  }, [filteredServerEntries]);

  const handleToggleApp = async (
    serverId: string,
    app: AppId,
    enabled: boolean,
  ) => {
    if (writePending) return;
    try {
      await toggleAppMutation.mutateAsync({ serverId, app, enabled });
    } catch (error) {
      // Pi 拒绝的写入（SSE、名称规则）给出本地化原因
      const detail = extractErrorMessage(error);
      toast.error(t("common.error"), {
        description: translateMcpBackendError(detail, t) || detail,
      });
    }
  };

  const handleToggleAll = async (app: AppId, enabled: boolean) => {
    if (writePending) return;
    const serverIds = filteredServerEntries
      .filter(
        ([_, server]) =>
          Boolean(server.apps[app as keyof typeof server.apps]) !== enabled,
      )
      .map(([id]) => id);
    if (serverIds.length === 0) return;

    const result = await bulkToggleAppMutation.mutateAsync({
      serverIds,
      app,
      enabled,
    });
    if (result.failed.length > 0) {
      toast.error(
        t("common.bulkToggleFailed", { count: result.failed.length }),
      );
    }
    if (result.succeeded.length > 0) {
      toast.success(t("common.saved"), {
        action: {
          label: t("common.undo"),
          onClick: () => {
            void bulkToggleAppMutation
              .mutateAsync({
                serverIds: result.succeeded,
                app,
                enabled: !enabled,
              })
              .then((undone) => {
                if (undone.failed.length)
                  toast.error(
                    t("common.bulkToggleFailed", {
                      count: undone.failed.length,
                    }),
                  );
              })
              .catch((error) =>
                toast.error(t("common.error"), { description: String(error) }),
              );
          },
        },
      });
    }
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setIsFormOpen(true);
  };

  const handleAdd = () => {
    setEditingId(null);
    setIsFormOpen(true);
  };

  const handleImport = async () => {
    try {
      const count = await importMutation.mutateAsync();
      if (count === 0) {
        toast.success(t("mcp.unifiedPanel.noImportFound"), {
          closeButton: true,
        });
      } else {
        toast.success(t("mcp.unifiedPanel.importSuccess", { count }), {
          closeButton: true,
        });
      }
    } catch (error) {
      toast.error(t("common.error"), { description: String(error) });
    }
  };

  React.useImperativeHandle(ref, () => ({
    openAdd: handleAdd,
    openImport: handleImport,
  }));

  const handleDelete = (id: string) => {
    setConfirmDialog({
      isOpen: true,
      title: t("mcp.unifiedPanel.deleteServer"),
      message: t("mcp.unifiedPanel.deleteConfirm", { id }),
      onConfirm: async () => {
        try {
          await deleteServerMutation.mutateAsync(id);
          setConfirmDialog(null);
          toast.success(t("common.success"), { closeButton: true });
        } catch (error) {
          toast.error(t("common.error"), { description: String(error) });
        }
      },
    });
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
  };

  return (
    <div className="px-6 flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!connectivity.canCheck || connectivity.checking}
          onClick={connectivity.checkAll}
        >
          <Activity className="h-4 w-4" />
          {t("mcp.connectivity.checkAll")}
        </Button>
        <ResyncButton
          run={() => mcpApi.resyncToApps()}
          queryKey={["mcp", "all"]}
          disabled={writePending}
        />
      </div>
      <AppCountBar
        totalLabel={t("mcp.serverCount", { count: serverEntries.length })}
        counts={enabledCounts}
        appIds={visibleAppIds}
        totalCount={filteredServerEntries.length}
        onToggleAll={handleToggleAll}
        pendingApp={bulkToggleAppMutation.variables?.app ?? null}
        disabled={writePending}
      />

      <ManagementListSearch
        value={searchQuery}
        onValueChange={setSearchQuery}
        placeholder={t("mcp.unifiedPanel.searchPlaceholder")}
        ariaLabel={t("mcp.unifiedPanel.searchAriaLabel")}
        clearLabel={t("common.clear")}
      />

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-24">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            {t("mcp.loading")}
          </div>
        ) : serverEntries.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
              <Server size={24} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">
              {t("mcp.unifiedPanel.noServers")}
            </h3>
            <p className="text-muted-foreground text-sm">
              {t("mcp.emptyDescription")}
            </p>
          </div>
        ) : filteredServerEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Search className="mb-4 h-10 w-10 opacity-40" />
            <p className="text-sm">{t("mcp.unifiedPanel.noSearchResults")}</p>
          </div>
        ) : (
          <TooltipProvider delayDuration={300}>
            <div className="rounded-xl border border-border-default overflow-hidden">
              <WindowedRows>
                {filteredServerEntries.map(([id, server], index) => (
                  <UnifiedMcpListItem
                    key={id}
                    id={id}
                    server={server}
                    visibleAppIds={visibleAppIds}
                    onToggleApp={handleToggleApp}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    connection={
                      MCP_APP_IDS.some((app) => server.apps[app])
                        ? (connectivity.states[id] ?? "unchecked")
                        : "disabled"
                    }
                    onTestConnection={() => connectivity.checkServer(id)}
                    disabled={writePending}
                    isLast={index === filteredServerEntries.length - 1}
                  />
                ))}
              </WindowedRows>
            </div>
          </TooltipProvider>
        )}
      </div>

      {isFormOpen && (
        <McpFormModal
          editingId={editingId || undefined}
          initialData={
            editingId && serversMap ? serversMap[editingId] : undefined
          }
          existingServers={serversMap ?? {}}
          visibleAppIds={visibleAppIds}
          onSave={async () => {
            setIsFormOpen(false);
            setEditingId(null);
          }}
          onClose={handleCloseForm}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          isOpen={confirmDialog.isOpen}
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
});

UnifiedMcpPanel.displayName = "UnifiedMcpPanel";

interface UnifiedMcpListItemProps {
  visibleAppIds: McpAppId[];
  id: string;
  server: McpServer;
  onToggleApp: (serverId: string, app: AppId, enabled: boolean) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
  isLast?: boolean;
  connection:
    | "unchecked"
    | "checking"
    | "connected"
    | "disconnected"
    | "disabled";
  onTestConnection: () => void;
}

const UnifiedMcpListItem: React.FC<UnifiedMcpListItemProps> = ({
  id,
  server,
  visibleAppIds,
  onToggleApp,
  onEdit,
  onDelete,
  disabled,
  isLast,
  connection,
  onTestConnection,
}) => {
  const { t } = useTranslation();
  const name = server.name || id;
  const description = server.description || "";

  const meta = mcpPresets.find((p) => p.id === id);
  const docsUrl = server.docs || meta?.docs;
  const homepageUrl = server.homepage || meta?.homepage;
  const tags = server.tags || meta?.tags;

  const openDocs = async () => {
    const url = docsUrl || homepageUrl;
    if (!url) return;
    try {
      await settingsApi.openExternal(url);
    } catch {
      // ignore
    }
  };

  return (
    <ListItemRow isLast={isLast}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            role="img"
            aria-label={t(`mcp.connectivity.state.${connection}`)}
            title={t(`mcp.connectivity.state.${connection}`)}
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              connection === "connected"
                ? "bg-emerald-500"
                : connection === "disconnected"
                  ? "bg-red-500"
                  : connection === "checking"
                    ? "animate-pulse bg-muted-foreground/50"
                    : "bg-muted-foreground/30",
            )}
          />
          <span className="font-medium text-sm text-foreground truncate">
            {name}
          </span>
          {docsUrl && (
            <button
              type="button"
              onClick={openDocs}
              className="text-muted-foreground/60 hover:text-foreground flex-shrink-0"
              title={t("mcp.presets.docs")}
            >
              <ExternalLink size={12} />
            </button>
          )}
        </div>
        {description && (
          <p
            className="text-xs text-muted-foreground truncate"
            title={description}
          >
            {description}
          </p>
        )}
        {!description && tags && tags.length > 0 && (
          <p className="text-xs text-muted-foreground/60 truncate">
            {tags.join(", ")}
          </p>
        )}
      </div>

      <AppToggleGroup
        apps={server.apps}
        onToggle={(app, enabled) => onToggleApp(id, app, enabled)}
        appIds={visibleAppIds}
        disabled={disabled}
      />

      <div className="flex items-center gap-0.5 flex-shrink-0 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {connection !== "disabled" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onTestConnection}
            disabled={connection === "checking"}
            title={t("mcp.connectivity.test")}
            aria-label={t("mcp.connectivity.test")}
          >
            <Activity size={14} />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => onEdit(id)}
          disabled={disabled}
          title={t("common.edit")}
        >
          <Edit3 size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:text-red-500 hover:bg-red-100 dark:hover:text-red-400 dark:hover:bg-red-500/10"
          onClick={() => onDelete(id)}
          disabled={disabled}
          title={t("common.delete")}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </ListItemRow>
  );
};

export default UnifiedMcpPanel;
