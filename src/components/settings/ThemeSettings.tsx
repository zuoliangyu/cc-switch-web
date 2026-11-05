import { useMemo, useState } from "react";
import { ChevronRight, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/theme-provider";
import { THEME_SCHEMES } from "@/config/themeSchemes";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * 设置 → 通用 → 外观里的「配色」：当前配色的色块 + 「更换」，点开选配色的弹窗。
 * 明暗模式在同一节的分段控件里，这里只管配色（Web 自有的主题配色）。
 */
export function ThemePaletteControl() {
  const { t } = useTranslation();
  const { scheme, setScheme } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const currentScheme = useMemo(
    () => THEME_SCHEMES.find((item) => item.id === scheme) ?? THEME_SCHEMES[0],
    [scheme],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label={t("settings.themePaletteAction")}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm hover:bg-muted"
      >
        <span className="flex items-center gap-1">
          {currentScheme.swatches.map((color) => (
            <span
              key={`${currentScheme.id}-${color}`}
              className="h-3.5 w-3.5 rounded-full border border-black/5 dark:border-white/10"
              style={{ backgroundColor: color }}
            />
          ))}
        </span>
        <span className="max-w-[9rem] truncate">
          {t(currentScheme.labelKey)}
        </span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="max-w-5xl border-border-default bg-background/95 p-0">
          <DialogHeader className="space-y-2 border-b border-border-default bg-transparent px-6 py-5">
            <DialogTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5 theme-primary-text" />
              {t("settings.themePaletteDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.themePaletteDialogHint")}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[72vh] overflow-y-auto px-6 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {THEME_SCHEMES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={scheme === item.id}
                  onClick={(e) => {
                    setScheme(item.id, e);
                    setPaletteOpen(false);
                  }}
                  className={cn(
                    "group relative overflow-hidden rounded-[28px] border p-5 text-left transition-all duration-200",
                    "glass-card hover:-translate-y-0.5 hover:shadow-2xl",
                    scheme === item.id
                      ? "border-border-active shadow-xl"
                      : "border-border-default",
                  )}
                >
                  <div className="absolute inset-0 opacity-90">
                    <div
                      className="absolute -left-10 top-0 h-28 w-28 rounded-full blur-3xl"
                      style={{ backgroundColor: "hsl(var(--primary) / 0.08)" }}
                    />
                    <div
                      className="absolute bottom-0 right-0 h-24 w-24 rounded-full blur-3xl"
                      style={{ backgroundColor: "hsl(var(--tertiary) / 0.08)" }}
                    />
                  </div>
                  <div className="relative flex h-full flex-col gap-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {item.swatches.map((color) => (
                          <span
                            key={`${item.id}-${color}`}
                            className="h-8 w-8 rounded-full border border-black/5 shadow-sm dark:border-white/10"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                      {scheme === item.id ? (
                        <span className="rounded-full bg-background/90 px-3 py-1 text-xs font-semibold theme-primary-text shadow-sm">
                          {t("settings.themeCurrent")}
                        </span>
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      <div className="text-2xl font-semibold tracking-tight text-foreground">
                        {t(item.labelKey)}
                      </div>
                      <p className="text-base text-muted-foreground">
                        {t(item.descriptionKey)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
