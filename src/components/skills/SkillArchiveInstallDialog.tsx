import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileArchive, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SkillArchiveInstallResult } from "@/lib/api/skills";

/**
 * 从 ZIP 安装（Web）：浏览器选文件 / 拖进来上传，可一次选多个。
 * 桌面版是系统文件对话框选一个本地路径；Web 的服务端看不到浏览器这边的文件，只能上传。
 */

function buildArchiveFileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function isZipArchiveFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".zip");
}

function mergeArchiveFiles(current: File[], incoming: File[]): File[] {
  const merged = new Map<string, File>();
  current.forEach((file) => {
    merged.set(buildArchiveFileKey(file), file);
  });
  incoming.forEach((file) => {
    merged.set(buildArchiveFileKey(file), file);
  });
  return Array.from(merged.values());
}

function formatArchiveFileSize(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
}

export function summarizeArchiveFailures(
  results: SkillArchiveInstallResult[],
): string {
  return results
    .slice(0, 3)
    .map((result) => result.fileName)
    .join(", ");
}

interface InstallSkillsFromZipDialogProps {
  open: boolean;
  files: File[];
  isDragActive: boolean;
  isInstalling: boolean;
  onBrowse: () => void;
  onClear: () => void;
  onClose: () => void;
  onDropFiles: (files: File[]) => void;
  onInstall: () => void;
  onRemoveFile: (fileKey: string) => void;
  onSetDragActive: (active: boolean) => void;
}

export function SkillArchiveInstallDialog({
  open,
  isInstalling,
  onInstall,
  onClose,
}: {
  open: boolean;
  isInstalling: boolean;
  /** 返回 true 时关掉对话框并清空已选文件 */
  onInstall: (files: File[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const appendFiles = (incoming: File[]) => {
    const valid = incoming.filter(isZipArchiveFile);
    const invalidCount = incoming.length - valid.length;
    if (invalidCount > 0) {
      toast.error(t("skills.installFromZip.invalidFilesTitle"), {
        description: t("skills.installFromZip.invalidFilesDescription", {
          count: invalidCount,
        }),
        closeButton: true,
      });
    }
    if (valid.length === 0) return;
    setFiles((current) => mergeArchiveFiles(current, valid));
  };

  const close = () => {
    if (isInstalling) return;
    setFiles([]);
    setIsDragActive(false);
    onClose();
  };

  const install = async () => {
    if (files.length === 0) {
      toast.info(t("skills.installFromZip.emptySelection"), {
        closeButton: true,
      });
      return;
    }
    if (await onInstall(files)) {
      setFiles([]);
      setIsDragActive(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        multiple
        className="hidden"
        onChange={(event) => {
          appendFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <ZipFilesDialog
        open={open}
        files={files}
        isDragActive={isDragActive}
        isInstalling={isInstalling}
        onBrowse={() => inputRef.current?.click()}
        onClose={close}
        onClear={() => setFiles([])}
        onDropFiles={appendFiles}
        onInstall={() => void install()}
        onRemoveFile={(fileKey) =>
          setFiles((current) =>
            current.filter((file) => buildArchiveFileKey(file) !== fileKey),
          )
        }
        onSetDragActive={setIsDragActive}
      />
    </>
  );
}

const ZipFilesDialog: React.FC<InstallSkillsFromZipDialogProps> = ({
  open,
  files,
  isDragActive,
  isInstalling,
  onBrowse,
  onClear,
  onClose,
  onDropFiles,
  onInstall,
  onRemoveFile,
  onSetDragActive,
}) => {
  const { t } = useTranslation();

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onSetDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextTarget = event.relatedTarget;
    if (
      nextTarget instanceof Node &&
      event.currentTarget.contains(nextTarget)
    ) {
      return;
    }
    onSetDragActive(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onSetDragActive(false);
    onDropFiles(Array.from(event.dataTransfer.files ?? []));
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col"
        zIndex="alert"
      >
        <DialogHeader>
          <DialogTitle>{t("skills.installFromZip.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("skills.installFromZip.dialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div
            className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              isDragActive
                ? "border-foreground bg-muted/60"
                : "border-border-default bg-muted/30"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-background shadow-sm">
              <Upload size={20} className="text-muted-foreground" />
            </div>
            <div className="text-sm font-medium text-foreground">
              {isDragActive
                ? t("skills.installFromZip.dropActive")
                : t("skills.installFromZip.dropTitle")}
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              {t("skills.installFromZip.dropHint")}
            </div>
            <div className="mt-4 flex justify-center gap-3">
              <Button type="button" variant="outline" onClick={onBrowse}>
                {t("skills.installFromZip.selectFiles")}
              </Button>
              {files.length > 0 && (
                <Button type="button" variant="ghost" onClick={onClear}>
                  {t("skills.installFromZip.clearSelection")}
                </Button>
              )}
            </div>
          </div>

          {files.length === 0 ? (
            <div className="rounded-xl border border-border-default bg-background/70 p-6 text-center text-sm text-muted-foreground">
              {t("skills.installFromZip.empty")}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">
                  {t("skills.installFromZip.selectedFiles", {
                    count: files.length,
                  })}
                </div>
              </div>
              <div className="space-y-2">
                {files.map((file) => {
                  const fileKey = buildArchiveFileKey(file);
                  return (
                    <div
                      key={fileKey}
                      className="flex items-center gap-3 rounded-xl border border-border-default bg-background/80 px-4 py-3"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                        <FileArchive
                          size={16}
                          className="text-muted-foreground"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-foreground">
                          {file.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatArchiveFileSize(file.size)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onRemoveFile(fileKey)}
                        disabled={isInstalling}
                        title={t("skills.installFromZip.removeFile")}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isInstalling}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={onInstall}
            disabled={files.length === 0 || isInstalling}
          >
            {isInstalling
              ? t("skills.installFromZip.installing")
              : t("skills.installFromZip.installSelected", {
                  count: files.length,
                })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
