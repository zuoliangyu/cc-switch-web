import { useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { FilePlus2, Pencil, Save, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { piApi, type PiPromptFileKind } from "@/lib/api/pi";
import { piKeys } from "@/lib/query/pi";
import { extractErrorMessage } from "@/utils/errorUtils";

type EditorState =
  | {
      type: "file";
      kind: PiPromptFileKind;
      revision: string;
      content: string;
    }
  | {
      type: "template";
      slug: string;
      originalSlug?: string;
      revision: string;
      content: string;
    };

const FILES: Array<{ kind: PiPromptFileKind; filename: string }> = [
  { kind: "system_override", filename: "SYSTEM.md" },
  { kind: "system_append", filename: "APPEND_SYSTEM.md" },
];

export function PiNativePromptResources() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const fileQueries = useQueries({
    queries: FILES.map(({ kind }) => ({
      queryKey: piKeys.promptFile(kind),
      queryFn: () => piApi.getPromptFile(kind),
    })),
  });
  const templatesQuery = useQuery({
    queryKey: piKeys.promptTemplates,
    queryFn: piApi.listPromptTemplates,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["pi", "prompt-file"] });
    await queryClient.invalidateQueries({ queryKey: piKeys.promptTemplates });
  };

  const handleSave = async () => {
    if (!editor || saving) return;
    if (editor.type === "file" && !editor.content.trim()) {
      toast.error(t("pi.prompts.fileCannotBeBlank"));
      return;
    }
    if (editor.type === "template" && !editor.slug.trim()) {
      toast.error(t("pi.prompts.slugRequired"));
      return;
    }
    setSaving(true);
    try {
      if (editor.type === "file") {
        await piApi.savePromptFile(
          editor.kind,
          editor.revision,
          editor.content,
        );
      } else {
        await piApi.savePromptTemplate(
          editor.slug.trim(),
          editor.originalSlug,
          editor.revision,
          editor.content,
        );
      }
      await refresh();
      setEditor(null);
      toast.success(t("pi.prompts.saveSuccess"));
    } catch (error) {
      toast.error(t("pi.prompts.saveFailed"), {
        description: extractErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const deleteFile = async (kind: PiPromptFileKind, revision: string) => {
    try {
      await piApi.deletePromptFile(kind, revision);
      await refresh();
      toast.success(t("pi.prompts.deleteSuccess"));
    } catch (error) {
      toast.error(t("pi.prompts.deleteFailed"), {
        description: extractErrorMessage(error),
      });
    }
  };

  const deleteTemplate = async (slug: string, revision: string) => {
    try {
      await piApi.deletePromptTemplate(slug, revision);
      await refresh();
      toast.success(t("pi.prompts.deleteSuccess"));
    } catch (error) {
      toast.error(t("pi.prompts.deleteFailed"), {
        description: extractErrorMessage(error),
      });
    }
  };

  return (
    <section className="mb-5 space-y-4 border-b border-border-default pb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("pi.prompts.nativeTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("pi.prompts.nativeDescription")}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setEditor({
              type: "template",
              slug: "",
              revision: "missing",
              content: "",
            })
          }
        >
          <FilePlus2 className="mr-2 h-4 w-4" />
          {t("pi.prompts.addTemplate")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FILES.map((file, index) => {
          const snapshot = fileQueries[index].data;
          return (
            <div
              key={file.kind}
              className="rounded-md border border-border-default p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {file.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {snapshot?.exists
                      ? t("pi.prompts.configured")
                      : t("pi.prompts.notConfigured")}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("common.edit")}
                    onClick={() =>
                      setEditor({
                        type: "file",
                        kind: file.kind,
                        revision: snapshot?.revision ?? "missing",
                        content: snapshot?.content ?? "",
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={!snapshot?.exists}
                    aria-label={t("common.delete")}
                    onClick={() =>
                      snapshot && void deleteFile(file.kind, snapshot.revision)
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t("pi.prompts.templates")}</Label>
          <span className="text-xs text-muted-foreground">
            {templatesQuery.data?.length ?? 0}
          </span>
        </div>
        {(templatesQuery.data ?? []).length === 0 ? (
          <p className="rounded-md border border-dashed border-border-default px-3 py-4 text-sm text-muted-foreground">
            {t("pi.prompts.noTemplates")}
          </p>
        ) : (
          <div className="divide-y divide-border-default rounded-md border border-border-default">
            {templatesQuery.data?.map((template) => (
              <div
                key={template.slug}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span className="truncate text-sm">/{template.slug}</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("common.edit")}
                    onClick={() =>
                      setEditor({
                        type: "template",
                        slug: template.slug,
                        originalSlug: template.slug,
                        revision: template.revision,
                        content: template.content,
                      })
                    }
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("common.delete")}
                    onClick={() =>
                      void deleteTemplate(template.slug, template.revision)
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editor && (
        <div className="space-y-3 rounded-md border border-border-active bg-background/80 p-4">
          <div className="flex items-center justify-between gap-3">
            <Label>
              {editor.type === "file"
                ? FILES.find((file) => file.kind === editor.kind)?.filename
                : t("pi.prompts.templateEditor")}
            </Label>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setEditor(null)}
              aria-label={t("common.close")}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          {editor.type === "template" && (
            <Input
              value={editor.slug}
              onChange={(event) =>
                setEditor({ ...editor, slug: event.target.value })
              }
              placeholder={t("pi.prompts.slugPlaceholder")}
              aria-label={t("pi.prompts.slug")}
            />
          )}
          <Textarea
            value={editor.content}
            onChange={(event) =>
              setEditor({ ...editor, content: event.target.value })
            }
            rows={10}
            aria-label={t("pi.prompts.content")}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              <Save className="mr-2 h-4 w-4" />
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
