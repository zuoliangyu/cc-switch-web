import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { profilesApi } from "@/lib/api";
import type { ProfileScope } from "@/lib/api/profiles";
import { extractErrorMessage } from "@/utils/errorUtils";

const profileErrorDetail = (error: Error, fallback: string) =>
  extractErrorMessage(error) || fallback;

export const useProfilesQuery = () =>
  useQuery({
    queryKey: ["profiles"],
    queryFn: () => profilesApi.list(),
  });

export const useCreateProfileMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ name, scope }: { name: string; scope: ProfileScope }) =>
      profilesApi.create(name, scope),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success(t("profiles.createSuccess"), { closeButton: true });
    },
    onError: (error: Error) =>
      toast.error(
        t("profiles.createFailed", {
          detail: profileErrorDetail(error, t("common.unknown")),
        }),
        { closeButton: true },
      ),
  });
};

export const useUpdateProfileMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({
      id,
      name,
      resnapshot,
      scope,
    }: {
      id: string;
      name?: string;
      resnapshot?: boolean;
      scope?: ProfileScope;
    }) => profilesApi.update(id, { name, resnapshot, scope }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success(t("profiles.updateSuccess"), { closeButton: true });
    },
    onError: (error: Error) =>
      toast.error(
        t("profiles.updateFailed", {
          detail: profileErrorDetail(error, t("common.unknown")),
        }),
        { closeButton: true },
      ),
  });
};

export const useDeleteProfileMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (id: string) => profilesApi.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success(t("profiles.deleteSuccess"), { closeButton: true });
    },
    onError: (error: Error) =>
      toast.error(
        t("profiles.deleteFailed", {
          detail: profileErrorDetail(error, t("common.unknown")),
        }),
        { closeButton: true },
      ),
  });
};

export const useClearProfileMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (scope: ProfileScope) => profilesApi.clearCurrent(scope),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      toast.success(t("profiles.clearSuccess"), { closeButton: true });
    },
    onError: (error: Error) =>
      toast.error(
        t("profiles.applyFailed", {
          detail: profileErrorDetail(error, t("common.unknown")),
        }),
        { closeButton: true },
      ),
  });
};

export const useApplyProfileMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: ProfileScope }) =>
      profilesApi.apply(id, scope),
    onSuccess: async (warnings) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["profiles"] }),
        queryClient.invalidateQueries({ queryKey: ["providers"] }),
        queryClient.invalidateQueries({ queryKey: ["mcp", "all"] }),
        queryClient.invalidateQueries({ queryKey: ["skills"] }),
        queryClient.invalidateQueries({ queryKey: ["proxyStatus"] }),
        queryClient.invalidateQueries({ queryKey: ["proxyRunning"] }),
        queryClient.invalidateQueries({ queryKey: ["proxyTakeoverStatus"] }),
      ]);

      if (warnings.length > 0) {
        toast.warning(
          t("profiles.applyWarnings", {
            warningCount: warnings.length,
            details: warnings.join("\n"),
          }),
          { closeButton: true, duration: 10000 },
        );
      } else {
        toast.success(t("profiles.applySuccess"), { closeButton: true });
      }
    },
    onError: (error: Error) =>
      toast.error(
        t("profiles.applyFailed", {
          detail: profileErrorDetail(error, t("common.unknown")),
        }),
        { closeButton: true },
      ),
  });
};
