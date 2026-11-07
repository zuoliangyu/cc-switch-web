import { useTranslation } from "react-i18next";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";
import type { AuthCenterTarget } from "@/lib/api";

interface AuthSettingsPanelProps {
  target: AuthCenterTarget | null;
  onClose: () => void;
}

/**
 * 供应商表单里「添加或管理账号」打开的全屏授权中心，定位到对应的那一组；关掉回到表单，
 * 表单草稿不动。由对话框渲染在表单面板之外，这里的操作不会登记为表单的未保存改动。
 */
export function AuthSettingsPanel({ target, onClose }: AuthSettingsPanelProps) {
  const { t } = useTranslation();
  const isOpen = target !== null;

  return (
    <FullScreenPanel
      isOpen={isOpen}
      title={t("nav.auth")}
      onClose={onClose}
      motionPreset="slide-from-right"
    >
      {target ? <AuthCenterPanel authScrollTarget={target} /> : null}
    </FullScreenPanel>
  );
}
