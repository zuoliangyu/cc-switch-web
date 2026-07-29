import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSessionSearch } from "@/hooks/useSessionSearch";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  RefreshCw,
  Search,
  Play,
  Trash2,
  MessageSquare,
  Clock,
  FolderOpen,
  X,
  CheckSquare,
} from "lucide-react";
import {
  useDeleteSessionMutation,
  useSessionMessagesQuery,
  useSessionsQuery,
} from "@/lib/query";
import { sessionsApi } from "@/lib/api";
import type { SessionMeta } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { extractErrorMessage } from "@/utils/errorUtils";
import { isWebRuntime } from "@/lib/runtime/client/env";
import { ProviderIcon } from "@/components/ProviderIcon";
import { SessionItem } from "./SessionItem";
import { SessionMessageItem } from "./SessionMessageItem";
import { SessionTocDialog, SessionTocSidebar } from "./SessionToc";
import {
  formatSessionTitle,
  formatTimestamp,
  getBaseName,
  getProviderIconName,
  getProviderLabel,
  getSessionKey,
} from "./utils";

type ProviderFilter =
  | "all"
  | "codex"
  | "grokbuild"
  | "claude"
  | "opencode"
  | "openclaw"
  | "gemini";

export function SessionManagerPage({ appId }: { appId: string }) {
  const { t } = useTranslation();
  const isWebMode = isWebRuntime();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useSessionsQuery();
  const sessions = data ?? [];
  const detailRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [activeMessageIndex, setActiveMessageIndex] = useState<number | null>(
    null,
  );
  const [tocDialogOpen, setTocDialogOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<SessionMeta[] | null>(
    null,
  );
  const [selectedSessionKeys, setSelectedSessionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>(
    appId as ProviderFilter,
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // 使用 FlexSearch 全文搜索
  const { search: searchSessions } = useSessionSearch({
    sessions,
    providerFilter,
  });

  const filteredSessions = useMemo(() => {
    return searchSessions(search);
  }, [searchSessions, search]);

  useEffect(() => {
    if (filteredSessions.length === 0) {
      setSelectedKey(null);
      return;
    }
    const exists = selectedKey
      ? filteredSessions.some(
          (session) => getSessionKey(session) === selectedKey,
        )
      : false;
    if (!exists) {
      setSelectedKey(getSessionKey(filteredSessions[0]));
    }
  }, [filteredSessions, selectedKey]);

  const selectedSession = useMemo(() => {
    if (!selectedKey) return null;
    return (
      filteredSessions.find(
        (session) => getSessionKey(session) === selectedKey,
      ) || null
    );
  }, [filteredSessions, selectedKey]);

  const { data: messages = [], isLoading: isLoadingMessages } =
    useSessionMessagesQuery(
      selectedSession?.providerId,
      selectedSession?.sourcePath,
    );
  const deleteSessionMutation = useDeleteSessionMutation();
  const isDeleting = deleteSessionMutation.isPending || isBatchDeleting;

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 180,
    overscan: 6,
    gap: 14,
  });

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [selectedKey]);

  useEffect(() => {
    const validKeys = new Set(
      sessions.map((session) => getSessionKey(session)),
    );
    setSelectedSessionKeys((current) => {
      let changed = false;
      const next = new Set<string>();
      current.forEach((key) => {
        if (validKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [sessions]);

  // 提取用户消息用于目录
  const userMessagesToc = useMemo(() => {
    return messages
      .map((msg, index) => ({ msg, index }))
      .filter(({ msg }) => msg.role.toLowerCase() === "user")
      .map(({ msg, index }) => ({
        index,
        preview:
          msg.content.slice(0, 50) + (msg.content.length > 50 ? "..." : ""),
        ts: msg.ts,
      }));
  }, [messages]);

  const scrollToMessage = (index: number) => {
    virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    setActiveMessageIndex(index);
    setTocDialogOpen(false);
    setTimeout(() => setActiveMessageIndex(null), 2000);
  };

  const handleCopy = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.success(successMessage);
      } catch (error) {
        toast.error(
          extractErrorMessage(error) ||
            t("common.error", { defaultValue: "Copy failed" }),
        );
      }
    },
    [t],
  );

  const handleMessageCopy = useCallback(
    (content: string) => {
      void handleCopy(
        content,
        t("sessionManager.messageCopied", {
          defaultValue: "已复制消息内容",
        }),
      );
    },
    [handleCopy, t],
  );

  const handleResume = async () => {
    if (!selectedSession?.resumeCommand) return;

    try {
      await sessionsApi.launchTerminal({
        command: selectedSession.resumeCommand,
        cwd: selectedSession.projectDir ?? undefined,
      });
      toast.success(t("sessionManager.terminalLaunched"));
    } catch (error) {
      await handleCopy(
        selectedSession.resumeCommand,
        t("sessionManager.resumeFallbackCopied"),
      );
      toast.error(extractErrorMessage(error) || t("sessionManager.openFailed"));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTargets || deleteTargets.length === 0 || isDeleting) {
      return;
    }

    const targets = deleteTargets.filter((session) => session.sourcePath);
    setDeleteTargets(null);

    if (targets.length === 0) {
      return;
    }

    if (targets.length === 1) {
      const [target] = targets;
      await deleteSessionMutation.mutateAsync({
        providerId: target.providerId,
        sessionId: target.sessionId,
        sourcePath: target.sourcePath!,
      });
      setSelectedSessionKeys((current) => {
        const next = new Set(current);
        next.delete(getSessionKey(target));
        return next;
      });
      return;
    }

    setIsBatchDeleting(true);
    try {
      const results = await sessionsApi.deleteMany(
        targets.map((session) => ({
          providerId: session.providerId,
          sessionId: session.sessionId,
          sourcePath: session.sourcePath!,
        })),
      );

      const deletedKeys = results
        .filter((result) => result.success)
        .map(
          (result) =>
            `${result.providerId}:${result.sessionId}:${result.sourcePath ?? ""}`,
        );

      const failedErrors = results
        .filter((result) => !result.success)
        .map((result) => result.error || t("common.unknown"));

      if (deletedKeys.length > 0) {
        const deletedKeySet = new Set(deletedKeys);
        queryClient.setQueryData<SessionMeta[]>(["sessions"], (current) =>
          (current ?? []).filter(
            (session) => !deletedKeySet.has(getSessionKey(session)),
          ),
        );
      }

      results
        .filter((result) => result.success)
        .forEach((result) => {
          queryClient.removeQueries({
            queryKey: ["sessionMessages", result.providerId, result.sourcePath],
          });
        });

      setSelectedSessionKeys((current) => {
        const next = new Set(current);
        deletedKeys.forEach((key) => next.delete(key));
        return next;
      });

      await queryClient.invalidateQueries({ queryKey: ["sessions"] });

      if (deletedKeys.length > 0) {
        toast.success(
          t("sessionManager.batchDeleteSuccess", {
            defaultValue: "已删除 {{count}} 个会话",
            count: deletedKeys.length,
          }),
        );
      }

      if (failedErrors.length > 0) {
        toast.error(
          t("sessionManager.batchDeleteFailed", {
            defaultValue: "{{failed}} 个会话删除失败",
            failed: failedErrors.length,
          }),
          {
            description: failedErrors[0],
          },
        );
      }
    } catch (error) {
      toast.error(
        extractErrorMessage(error) ||
          t("sessionManager.batchDeleteRequestFailed", {
            defaultValue: "批量删除失败，请稍后重试",
          }),
      );
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const deletableFilteredSessions = useMemo(
    () => filteredSessions.filter((session) => Boolean(session.sourcePath)),
    [filteredSessions],
  );

  const selectedSessions = useMemo(
    () =>
      sessions.filter((session) =>
        selectedSessionKeys.has(getSessionKey(session)),
      ),
    [sessions, selectedSessionKeys],
  );

  const selectedDeletableSessions = useMemo(
    () => selectedSessions.filter((session) => Boolean(session.sourcePath)),
    [selectedSessions],
  );

  useEffect(() => {
    if (!selectionMode) return;

    const visibleKeys = new Set(
      deletableFilteredSessions.map((session) => getSessionKey(session)),
    );

    setSelectedSessionKeys((current) => {
      let changed = false;
      const next = new Set<string>();

      current.forEach((key) => {
        if (visibleKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [deletableFilteredSessions, selectionMode]);

  const allFilteredSelected =
    deletableFilteredSessions.length > 0 &&
    deletableFilteredSessions.every((session) =>
      selectedSessionKeys.has(getSessionKey(session)),
    );

  const toggleSessionChecked = (session: SessionMeta, checked: boolean) => {
    if (!session.sourcePath) return;
    const key = getSessionKey(session);
    setSelectedSessionKeys((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    setSelectedSessionKeys((current) => {
      const next = new Set(current);
      if (allFilteredSelected) {
        deletableFilteredSessions.forEach((session) =>
          next.delete(getSessionKey(session)),
        );
      } else {
        deletableFilteredSessions.forEach((session) =>
          next.add(getSessionKey(session)),
        );
      }
      return next;
    });
  };

  const openBatchDeleteDialog = () => {
    if (selectedDeletableSessions.length === 0) return;
    setDeleteTargets(selectedDeletableSessions);
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedSessionKeys(new Set());
  };

  return (
    <TooltipProvider>
      <div
        className="mx-auto flex h-full w-full max-w-7xl flex-col px-4 sm:px-6"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          <div className="glass-card rounded-[30px] border border-border-default p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="space-y-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  {t("sessionManager.workspaceLabel", {
                    defaultValue: "Session Workspace",
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                    {t("sessionManager.title", {
                      defaultValue: "会话工作台",
                    })}
                  </h2>
                  <span className="theme-chip-neutral inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                    {t("sessionManager.totalCount", {
                      defaultValue: "{{count}} 个会话",
                      count: filteredSessions.length,
                    })}
                  </span>
                  <span className="theme-chip-tertiary inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                    {providerFilter === "all"
                      ? t("sessionManager.providerFilterAll")
                      : getProviderLabel(providerFilter, t)}
                  </span>
                  {search.trim() && (
                    <span className="theme-chip-primary inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                      {t("sessionManager.searchSessions")}
                    </span>
                  )}
                  {selectionMode && (
                    <span className="theme-chip-warning inline-flex items-center rounded-full px-3 py-1 text-xs font-medium">
                      {t("sessionManager.selectedCount", {
                        defaultValue: "已选 {{count}} 项",
                        count: selectedDeletableSessions.length,
                      })}
                    </span>
                  )}
                </div>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {search.trim()
                    ? t("sessionManager.workspaceSearchDescription", {
                        defaultValue:
                          "正在按内容、目录和会话 ID 搜索历史记录，左侧列表与右侧详情会同步收敛到当前结果集。",
                      })
                    : t("sessionManager.subtitle", {
                        defaultValue:
                          "管理 Claude Code、Codex、OpenCode、OpenClaw 与 Gemini CLI 会话记录",
                      })}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={
                    isSearchOpen || search.trim() ? "default" : "outline"
                  }
                  className="min-w-[8rem]"
                  onClick={() => {
                    setIsSearchOpen(true);
                    setTimeout(() => searchInputRef.current?.focus(), 0);
                  }}
                >
                  <Search className="mr-2 h-4 w-4" />
                  {search.trim()
                    ? t("sessionManager.searchSessions")
                    : t("sessionManager.searchAction", {
                        defaultValue: "搜索会话",
                      })}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-w-[8rem]"
                  onClick={() => void refetch()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("common.refresh")}
                </Button>
              </div>
            </div>
          </div>

          {/* 主内容区域 - 左右分栏 */}
          <div className="flex-1 overflow-hidden grid gap-4 md:grid-cols-[340px_1fr]">
            {/* 左侧会话列表 */}
            <Card className="glass-card flex flex-col flex-1 min-h-0 overflow-hidden rounded-[28px] border border-border-default shadow-xl">
              <CardHeader className="border-b border-border-default bg-background/40 px-4 py-4">
                {isSearchOpen ? (
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                      <Input
                        ref={searchInputRef}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={t("sessionManager.searchPlaceholder")}
                        className="h-8 pl-8 pr-8 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setIsSearchOpen(false);
                            setSearch("");
                          }
                        }}
                        onBlur={() => {
                          if (search.trim() === "") {
                            setIsSearchOpen(false);
                          }
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 size-6"
                        onClick={() => {
                          setIsSearchOpen(false);
                          setSearch("");
                        }}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                    {selectionMode && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="size-7 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
                            aria-label={t(
                              "sessionManager.exitBatchModeTooltip",
                              {
                                defaultValue: "退出批量管理",
                              },
                            )}
                            onClick={exitSelectionMode}
                          >
                            <CheckSquare className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("sessionManager.exitBatchModeTooltip", {
                            defaultValue: "退出批量管理",
                          })}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <CardTitle className="text-base font-semibold whitespace-nowrap">
                          {t("sessionManager.sessionList")}
                        </CardTitle>
                        <Badge
                          variant="secondary"
                          className="rounded-full text-xs"
                        >
                          {filteredSessions.length}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {(selectionMode ||
                          deletableFilteredSessions.length > 0) && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant={selectionMode ? "secondary" : "ghost"}
                                size="icon"
                                className={
                                  selectionMode
                                    ? "size-7 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/60"
                                    : "size-7"
                                }
                                aria-label={
                                  selectionMode
                                    ? t("sessionManager.exitBatchModeTooltip", {
                                        defaultValue: "退出批量管理",
                                      })
                                    : t("sessionManager.manageBatchTooltip", {
                                        defaultValue: "批量管理",
                                      })
                                }
                                onClick={() => {
                                  if (selectionMode) {
                                    exitSelectionMode();
                                  } else {
                                    setSelectionMode(true);
                                  }
                                }}
                              >
                                <CheckSquare className="size-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {selectionMode
                                ? t("sessionManager.exitBatchModeTooltip", {
                                    defaultValue: "退出批量管理",
                                  })
                                : t("sessionManager.manageBatchTooltip", {
                                    defaultValue: "批量管理",
                                  })}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-xl"
                              onClick={() => {
                                setIsSearchOpen(true);
                                setTimeout(
                                  () => searchInputRef.current?.focus(),
                                  0,
                                );
                              }}
                            >
                              <Search className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("sessionManager.searchSessions")}
                          </TooltipContent>
                        </Tooltip>

                        <Select
                          value={providerFilter}
                          onValueChange={(value) =>
                            setProviderFilter(value as ProviderFilter)
                          }
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <SelectTrigger className="size-8 rounded-xl p-0 justify-center border-0 bg-transparent hover:bg-muted">
                                <ProviderIcon
                                  icon={
                                    providerFilter === "all"
                                      ? "apps"
                                      : getProviderIconName(providerFilter)
                                  }
                                  name={providerFilter}
                                  size={14}
                                />
                              </SelectTrigger>
                            </TooltipTrigger>
                            <TooltipContent>
                              {providerFilter === "all"
                                ? t("sessionManager.providerFilterAll")
                                : providerFilter}
                            </TooltipContent>
                          </Tooltip>
                          <SelectContent>
                            <SelectItem value="all">
                              <div className="flex items-center gap-2">
                                <ProviderIcon
                                  icon="apps"
                                  name="all"
                                  size={14}
                                />
                                <span>
                                  {t("sessionManager.providerFilterAll")}
                                </span>
                              </div>
                            </SelectItem>
                            <SelectItem value="codex">
                              <div className="flex items-center gap-2">
                                <ProviderIcon
                                  icon="openai"
                                  name="codex"
                                  size={14}
                                />
                                <span>Codex</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="grokbuild">
                              <div className="flex items-center gap-2">
                                <ProviderIcon
                                  icon="grok"
                                  name="Grok Build"
                                  size={14}
                                />
                                <span>Grok Build</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="claude">
                              <div className="flex items-center gap-2">
                                <ProviderIcon
                                  icon="claude"
                                  name="claude"
                                  size={14}
                                />
                                <span>Claude Code</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="opencode">
                              <div className="flex items-center gap-2">
                                <ProviderIcon
                                  icon="opencode"
                                  name="opencode"
                                  size={14}
                                />
                                <span>OpenCode</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="openclaw">
                              <div className="flex items-center gap-2">
                                <ProviderIcon
                                  icon="openclaw"
                                  name="openclaw"
                                  size={14}
                                />
                                <span>OpenClaw</span>
                              </div>
                            </SelectItem>
                            <SelectItem value="gemini">
                              <div className="flex items-center gap-2">
                                <ProviderIcon
                                  icon="gemini"
                                  name="gemini"
                                  size={14}
                                />
                                <span>Gemini CLI</span>
                              </div>
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-xl"
                              onClick={() => void refetch()}
                            >
                              <RefreshCw className="size-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("common.refresh")}</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {selectionMode
                        ? t("sessionManager.batchModeHint", {
                            defaultValue: "勾选要删除的会话",
                          })
                        : t("sessionManager.listDescription", {
                            defaultValue:
                              "按最近活跃时间浏览本地会话，支持搜索、按应用筛选和批量管理。",
                          })}
                    </p>
                    {selectionMode && (
                      <div className="grid gap-3 rounded-2xl border border-border-default bg-background/70 px-3 py-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs">
                            {t("sessionManager.selectedCount", {
                              defaultValue: "已选 {{count}} 项",
                              count: selectedDeletableSessions.length,
                            })}
                          </Badge>
                          <span className="truncate">
                            {t("sessionManager.batchModeHint", {
                              defaultValue: "勾选要删除的会话",
                            })}
                          </span>
                        </div>
                        <div className="grid gap-3 min-[520px]:grid-cols-[minmax(0,1fr)_auto] min-[520px]:items-center">
                          <div className="flex flex-wrap items-center gap-2">
                            {deletableFilteredSessions.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2.5 text-xs whitespace-nowrap"
                                onClick={handleToggleSelectAll}
                              >
                                {allFilteredSelected
                                  ? t("sessionManager.clearFilteredSelection", {
                                      defaultValue: "取消全选",
                                    })
                                  : t("sessionManager.selectAllFiltered", {
                                      defaultValue: "全选当前",
                                    })}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2.5 text-xs whitespace-nowrap"
                              onClick={() => setSelectedSessionKeys(new Set())}
                            >
                              {t("sessionManager.clearSelection", {
                                defaultValue: "清空已选",
                              })}
                            </Button>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            className="h-7 gap-1.5 px-2.5 whitespace-nowrap justify-self-start min-[520px]:justify-self-end"
                            onClick={openBatchDeleteDialog}
                            disabled={
                              isDeleting ||
                              selectedDeletableSessions.length === 0
                            }
                          >
                            <Trash2 className="size-3.5" />
                            <span className="text-xs">
                              {isBatchDeleting
                                ? t("sessionManager.batchDeleting", {
                                    defaultValue: "删除中...",
                                  })
                                : t("sessionManager.deleteSelected", {
                                    defaultValue: "批量删除",
                                  })}
                            </span>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-0">
                <ScrollArea className="h-full">
                  <div className="p-3">
                    {isLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : filteredSessions.length === 0 ? (
                      <div className="rounded-[22px] border border-dashed border-border-default bg-background/50 px-5 py-12 text-center">
                        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
                          <MessageSquare className="size-6 text-muted-foreground" />
                        </div>
                        <div className="mt-4 text-base font-semibold text-foreground">
                          {t("sessionManager.noSessions")}
                        </div>
                        <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                          {t("sessionManager.noSessionsDescription", {
                            defaultValue:
                              "当前筛选条件下没有找到可展示的会话记录，试试切换应用或清空搜索关键字。",
                          })}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {filteredSessions.map((session) => {
                          const isSelected =
                            selectedKey !== null &&
                            getSessionKey(session) === selectedKey;

                          return (
                            <SessionItem
                              key={getSessionKey(session)}
                              session={session}
                              isSelected={isSelected}
                              selectionMode={selectionMode}
                              searchQuery={search}
                              isChecked={selectedSessionKeys.has(
                                getSessionKey(session),
                              )}
                              isCheckDisabled={!session.sourcePath}
                              onSelect={setSelectedKey}
                              onToggleChecked={(checked) =>
                                toggleSessionChecked(session, checked)
                              }
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* 右侧会话详情 */}
            <Card
              className="glass-card flex flex-col overflow-hidden min-h-0 rounded-[28px] border border-border-default shadow-xl"
              ref={detailRef}
            >
              {!selectedSession ? (
                <div className="flex flex-1 items-center justify-center p-8">
                  <div className="max-w-md rounded-[24px] border border-dashed border-border-default bg-background/55 px-8 py-12 text-center">
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted/70">
                      <MessageSquare className="size-7 text-muted-foreground" />
                    </div>
                    <div className="mt-4 text-lg font-semibold text-foreground">
                      {t("sessionManager.selectSession")}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {t("sessionManager.selectSessionDescription", {
                        defaultValue:
                          "从左侧选择一条会话后，这里会显示恢复命令、项目目录和完整对话记录。",
                      })}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* 详情头部 */}
                  <CardHeader className="shrink-0 border-b border-border-default bg-background/35 px-5 py-5">
                    <div className="flex items-start justify-between gap-4">
                      {/* 左侧：会话信息 */}
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-center gap-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-background/80 shadow-sm">
                                <ProviderIcon
                                  icon={getProviderIconName(
                                    selectedSession.providerId,
                                  )}
                                  name={selectedSession.providerId}
                                  size={20}
                                />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {getProviderLabel(selectedSession.providerId, t)}
                            </TooltipContent>
                          </Tooltip>
                          <h2 className="truncate text-xl font-semibold tracking-tight">
                            {formatSessionTitle(selectedSession)}
                          </h2>
                        </div>

                        {/* 元信息 */}
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <div className="theme-chip-neutral inline-flex items-center gap-1 rounded-full px-3 py-1">
                            <Clock className="size-3" />
                            <span>
                              {formatTimestamp(
                                selectedSession.lastActiveAt ??
                                  selectedSession.createdAt,
                              )}
                            </span>
                          </div>
                          {selectedSession.projectDir && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleCopy(
                                      selectedSession.projectDir!,
                                      t("sessionManager.projectDirCopied"),
                                    )
                                  }
                                  className="theme-chip-neutral inline-flex items-center gap-1 rounded-full px-3 py-1 transition-colors hover:text-foreground"
                                >
                                  <FolderOpen className="size-3" />
                                  <span className="truncate max-w-[200px]">
                                    {getBaseName(selectedSession.projectDir)}
                                  </span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="bottom"
                                className="max-w-xs"
                              >
                                <p className="font-mono text-xs break-all">
                                  {selectedSession.projectDir}
                                </p>
                                <p className="text-muted-foreground mt-1">
                                  {t("sessionManager.clickToCopyPath")}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </div>

                      {/* 右侧：操作按钮组 */}
                      <div className="flex items-center gap-2 shrink-0">
                        {isWebMode && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                className="gap-1.5 rounded-xl"
                                onClick={() => void handleResume()}
                                disabled={!selectedSession.resumeCommand}
                              >
                                <Play className="size-3.5" />
                                <span className="hidden sm:inline">
                                  {t("sessionManager.resume", {
                                    defaultValue: "恢复会话",
                                  })}
                                </span>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {selectedSession.resumeCommand
                                ? t("sessionManager.resumeTooltip", {
                                    defaultValue: "在终端中恢复此会话",
                                  })
                                : t("sessionManager.noResumeCommand", {
                                    defaultValue: "此会话无法恢复",
                                  })}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="gap-1.5 rounded-xl"
                              onClick={() =>
                                setDeleteTargets([selectedSession])
                              }
                              disabled={
                                !selectedSession.sourcePath || isDeleting
                              }
                            >
                              <Trash2 className="size-3.5" />
                              <span className="hidden sm:inline">
                                {isDeleting
                                  ? t("sessionManager.deleting", {
                                      defaultValue: "删除中...",
                                    })
                                  : t("sessionManager.delete", {
                                      defaultValue: "删除会话",
                                    })}
                              </span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("sessionManager.deleteTooltip", {
                              defaultValue: "永久删除此本地会话记录",
                            })}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    {/* 恢复命令预览 */}
                    {selectedSession.resumeCommand && (
                      <div className="mt-4 rounded-[22px] border border-border-default bg-background/70 p-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                          {t("sessionManager.resume", {
                            defaultValue: "恢复会话",
                          })}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 rounded-xl bg-muted/70 px-3 py-2 font-mono text-xs text-muted-foreground truncate">
                            {selectedSession.resumeCommand}
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-9 shrink-0 rounded-xl"
                                onClick={() =>
                                  void handleCopy(
                                    selectedSession.resumeCommand!,
                                    t("sessionManager.resumeCommandCopied"),
                                  )
                                }
                              >
                                <Copy className="size-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("sessionManager.copyCommand", {
                                defaultValue: "复制命令",
                              })}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    )}
                  </CardHeader>

                  {/* 消息列表区域 */}
                  <CardContent className="flex-1 min-h-0 p-0">
                    <div className="flex h-full min-w-0">
                      {/* 消息列表 */}
                      <div className="flex flex-1 min-w-0 flex-col">
                        <div className="min-w-0 px-5 pb-3 pt-5">
                          <div className="mb-4 flex items-center gap-2">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-background/80 shadow-sm">
                              <MessageSquare className="size-4 text-muted-foreground" />
                            </div>
                            <span className="text-sm font-semibold">
                              {t("sessionManager.conversationHistory", {
                                defaultValue: "对话记录",
                              })}
                            </span>
                            <Badge
                              variant="secondary"
                              className="rounded-full text-xs"
                            >
                              {messages.length}
                            </Badge>
                          </div>
                        </div>

                        <div
                          ref={scrollContainerRef}
                          className="flex-1 min-w-0 overflow-y-auto px-5 pb-5"
                        >
                          {isLoadingMessages ? (
                            <div className="flex items-center justify-center py-12">
                              <RefreshCw className="size-5 animate-spin text-muted-foreground" />
                            </div>
                          ) : messages.length === 0 ? (
                            <div className="rounded-[22px] border border-dashed border-border-default bg-background/55 px-5 py-12 text-center">
                              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
                                <MessageSquare className="size-6 text-muted-foreground" />
                              </div>
                              <div className="mt-4 text-base font-semibold text-foreground">
                                {t("sessionManager.emptySession")}
                              </div>
                              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                                {t("sessionManager.emptySessionDescription", {
                                  defaultValue:
                                    "该会话当前没有可展示的消息内容，可能只保留了元数据或索引信息。",
                                })}
                              </p>
                            </div>
                          ) : (
                            <div
                              className="relative"
                              style={{ height: virtualizer.getTotalSize() }}
                            >
                              {virtualizer
                                .getVirtualItems()
                                .map((virtualRow) => (
                                  <div
                                    key={virtualRow.key}
                                    data-index={virtualRow.index}
                                    ref={virtualizer.measureElement}
                                    className="absolute left-0 top-0 w-full"
                                    style={{
                                      transform: `translateY(${virtualRow.start}px)`,
                                    }}
                                  >
                                    <SessionMessageItem
                                      message={messages[virtualRow.index]}
                                      isActive={
                                        activeMessageIndex === virtualRow.index
                                      }
                                      searchQuery={search}
                                      onCopy={handleMessageCopy}
                                    />
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 右侧目录 - 类似少数派 (大屏幕) */}
                      <SessionTocSidebar
                        items={userMessagesToc}
                        onItemClick={scrollToMessage}
                      />
                    </div>

                    {/* 浮动目录按钮 (小屏幕) */}
                    <SessionTocDialog
                      items={userMessagesToc}
                      onItemClick={scrollToMessage}
                      open={tocDialogOpen}
                      onOpenChange={setTocDialogOpen}
                    />
                  </CardContent>
                </>
              )}
            </Card>
          </div>
        </div>
      </div>
      <ConfirmDialog
        isOpen={Boolean(deleteTargets)}
        title={
          deleteTargets && deleteTargets.length > 1
            ? t("sessionManager.batchDeleteConfirmTitle", {
                defaultValue: "批量删除会话",
              })
            : t("sessionManager.deleteConfirmTitle", {
                defaultValue: "删除会话",
              })
        }
        message={
          deleteTargets && deleteTargets.length > 1
            ? t("sessionManager.batchDeleteConfirmMessage", {
                defaultValue:
                  "将永久删除已选中的 {{count}} 个本地会话记录。\n\n此操作不可恢复。",
                count: deleteTargets.length,
              })
            : deleteTargets?.[0]
              ? t("sessionManager.deleteConfirmMessage", {
                  defaultValue:
                    "将永久删除本地会话“{{title}}”\nSession ID: {{sessionId}}\n\n此操作不可恢复。",
                  title: formatSessionTitle(deleteTargets[0]),
                  sessionId: deleteTargets[0].sessionId,
                })
              : ""
        }
        confirmText={
          deleteTargets && deleteTargets.length > 1
            ? t("sessionManager.batchDeleteConfirmAction", {
                defaultValue: "删除所选会话",
              })
            : t("sessionManager.deleteConfirmAction", {
                defaultValue: "删除会话",
              })
        }
        cancelText={t("common.cancel", { defaultValue: "取消" })}
        variant="destructive"
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => {
          if (!isDeleting) {
            setDeleteTargets(null);
          }
        }}
      />
    </TooltipProvider>
  );
}
