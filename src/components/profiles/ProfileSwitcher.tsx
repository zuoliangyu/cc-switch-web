import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Check,
  ChevronsUpDown,
  FolderCog,
  FolderOpen,
  Plus,
  X,
} from "lucide-react";

import type { AppId } from "@/lib/api/types";
import type { CurrentProfileIds, ProfileScope } from "@/lib/api/profiles";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useApplyProfileMutation,
  useClearProfileMutation,
  useCreateProfileMutation,
  useProfilesQuery,
} from "@/lib/query/profiles";
import { cn } from "@/lib/utils";
import { ProfileManageDialog } from "./ProfileManageDialog";
import { APP_PROFILE_SCOPE, hasScopeSnapshot } from "./scope";

const CURRENT_ID_KEY: Record<ProfileScope, keyof CurrentProfileIds> = {
  claude: "claude",
  "claude-desktop": "claudeDesktop",
  codex: "codex",
};

export function ProfileSwitcher({ activeApp }: { activeApp: AppId }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const { data } = useProfilesQuery();
  const applyMutation = useApplyProfileMutation();
  const clearMutation = useClearProfileMutation();
  const createMutation = useCreateProfileMutation();
  const scope = APP_PROFILE_SCOPE[activeApp];

  if (!scope) return null;

  const profiles = data?.profiles ?? [];
  const currentId = data?.currentIds?.[CURRENT_ID_KEY[scope]] ?? null;
  const currentProfile = profiles.find((profile) => profile.id === currentId);

  const closeCreate = () => {
    setCreateOpen(false);
    setNewName("");
  };

  const createProfile = () => {
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate({ name, scope }, { onSuccess: closeCreate });
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            title={t(`profiles.switcherTooltip.${scope}`)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors md:px-2.5",
              "hover:bg-black/5 dark:hover:bg-white/5",
              currentProfile ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <FolderOpen className="h-4 w-4 shrink-0 opacity-70" />
            <span className="hidden max-w-36 truncate md:inline">
              {currentProfile?.name ?? t("profiles.none")}
            </span>
            <ChevronsUpDown className="hidden h-3.5 w-3.5 shrink-0 opacity-50 md:block" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-[100] w-64 p-0"
        >
          <Command>
            <CommandInput placeholder={t("profiles.searchPlaceholder")} />
            <CommandList>
              <CommandEmpty>{t("profiles.empty")}</CommandEmpty>
              {profiles.length > 0 && (
                <CommandGroup>
                  {profiles.map((profile) => (
                    <CommandItem
                      key={profile.id}
                      value={profile.id}
                      keywords={[profile.name]}
                      onSelect={() => {
                        setOpen(false);
                        if (profile.id !== currentId) {
                          applyMutation.mutate({ id: profile.id, scope });
                        }
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4 shrink-0",
                          profile.id === currentId
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span className="truncate">{profile.name}</span>
                      {!hasScopeSnapshot(profile, scope) && (
                        <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                          {t("profiles.noSnapshotForScope")}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <div className="mx-1 my-1 h-px bg-border" />
              <CommandGroup>
                <CommandItem
                  value="__create__"
                  keywords={[t("profiles.createFromCurrent")]}
                  onSelect={() => {
                    setOpen(false);
                    setCreateOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4 shrink-0" />
                  {t("profiles.createFromCurrent")}
                </CommandItem>
                {currentId && (
                  <CommandItem
                    value="__clear__"
                    keywords={[t("profiles.none")]}
                    onSelect={() => {
                      setOpen(false);
                      clearMutation.mutate(scope);
                    }}
                  >
                    <X className="mr-2 h-4 w-4 shrink-0" />
                    {t("profiles.none")}
                  </CommandItem>
                )}
                {profiles.length > 0 && (
                  <CommandItem
                    value="__manage__"
                    keywords={[t("profiles.manage")]}
                    onSelect={() => {
                      setOpen(false);
                      setManageOpen(true);
                    }}
                  >
                    <FolderCog className="mr-2 h-4 w-4 shrink-0" />
                    {t("profiles.manage")}
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog
        open={createOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeCreate();
        }}
      >
        <DialogContent className="max-w-sm" zIndex="alert">
          <DialogHeader className="space-y-3 border-b-0 bg-transparent pb-0">
            <DialogTitle>{t("profiles.createFromCurrent")}</DialogTitle>
            <DialogDescription>
              {t(`profiles.createDescription.${scope}`)}
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pt-3">
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder={t("profiles.namePlaceholder")}
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") createProfile();
              }}
            />
          </div>
          <DialogFooter className="flex gap-2 border-t-0 bg-transparent pt-2 sm:justify-end">
            <Button variant="outline" onClick={closeCreate}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={createProfile}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProfileManageDialog
        isOpen={manageOpen}
        onClose={() => setManageOpen(false)}
      />
    </>
  );
}
