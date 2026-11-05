import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { CodexQuotaProtectionSettings } from "@/components/settings/CodexQuotaProtectionSettings";
import type { SettingsFormState } from "@/hooks/useSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const key = (name: string) => `settings.codexQuotaProtection.${name}`;

const ENABLED = { enabled: true, fiveHourThreshold: 95, weeklyThreshold: 98 };

// 上游 aa42a93d；Web 的设置页保存失败时返回 false（不抛错）并回滚乐观更新
function setup(
  initial: Partial<SettingsFormState> = { codexQuotaProtection: ENABLED },
  save = vi.fn().mockResolvedValue(true),
) {
  function Form() {
    const [settings, setSettings] = useState(initial as SettingsFormState);
    return (
      <CodexQuotaProtectionSettings
        settings={settings}
        onChange={async (updates) => {
          const previous = settings;
          setSettings({ ...settings, ...updates });
          const saved = await save(updates);
          if (!saved) setSettings(previous);
          return saved;
        }}
      />
    );
  }
  render(<Form />);
  return save;
}

describe("Codex 官方额度保护设置", () => {
  it("保存失败回滚后两个输入框的草稿都还在，可以重试", async () => {
    let complete!: (value: boolean) => void;
    const pending = new Promise<boolean>((resolve) => {
      complete = resolve;
    });
    const save = setup(
      undefined,
      vi.fn().mockReturnValueOnce(pending).mockResolvedValue(true),
    );
    const fiveHour = screen.getByRole("spinbutton", { name: key("fiveHour") });
    const weekly = screen.getByRole("spinbutton", { name: key("weekly") });
    const submit = screen.getByRole("button", { name: key("save") });
    fireEvent.change(fiveHour, { target: { value: "89" } });
    fireEvent.change(weekly, { target: { value: "92" } });
    fireEvent.click(submit);
    await waitFor(() => expect(fiveHour).toBeDisabled());
    await act(async () => complete(false));
    // 返回 false 时设置页的自动保存已经提示过（同上游），这里不再重复提示
    expect(toastError).not.toHaveBeenCalled();
    expect(fiveHour).toHaveValue(89);
    expect(weekly).toHaveValue(92);
    expect(submit).toBeEnabled();
    await act(async () => {
      fireEvent.click(submit);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({
      codexQuotaProtection: {
        enabled: true,
        fiveHourThreshold: 89,
        weeklyThreshold: 92,
      },
    });
    expect(submit).toBeDisabled();
  });

  it("恢复默认值失败时保留已输入的阈值", async () => {
    setup(undefined, vi.fn().mockResolvedValue(false));
    const fiveHour = screen.getByRole("spinbutton", { name: key("fiveHour") });
    fireEvent.change(fiveHour, { target: { value: "89" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: key("reset") }));
    });
    expect(fiveHour).toHaveValue(89);
    expect(screen.getByRole("button", { name: key("save") })).toBeEnabled();
  });

  it("默认关闭，打开时用 95% / 98% 的默认阈值", async () => {
    const save = setup({});
    const toggle = screen.getByRole("switch", { name: key("title") });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(save).toHaveBeenLastCalledWith({ codexQuotaProtection: ENABLED });
    expect(
      screen.getByRole("spinbutton", { name: key("fiveHour") }),
    ).toHaveValue(95);
    expect(screen.getByRole("spinbutton", { name: key("weekly") })).toHaveValue(
      98,
    );
  });

  it("两个阈值分别修改后一起保存", async () => {
    const save = setup();
    const fiveHour = screen.getByRole("spinbutton", { name: key("fiveHour") });
    expect(screen.getByRole("button", { name: key("save") })).toBeDisabled();
    fireEvent.change(fiveHour, { target: { value: "90" } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: key("save") }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        codexQuotaProtection: {
          enabled: true,
          fiveHourThreshold: 90,
          weeklyThreshold: 98,
        },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: key("save") })).toBeDisabled(),
    );
  });

  it.each(["", "0", "100", "95.5", "-1"])("阈值 %j 不合法时不保存", (value) => {
    const save = setup();
    fireEvent.change(screen.getByRole("spinbutton", { name: key("weekly") }), {
      target: { value },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(key("invalid"));
    expect(screen.getByRole("button", { name: key("save") })).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });

  it("恢复默认值后仍可关闭保护", async () => {
    const save = setup({
      codexQuotaProtection: {
        enabled: true,
        fiveHourThreshold: 85,
        weeklyThreshold: 90,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: key("reset") }));
    await waitFor(() =>
      expect(
        screen.getByRole("spinbutton", { name: key("fiveHour") }),
      ).toHaveValue(95),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: key("title") }));
    });
    expect(save).toHaveBeenLastCalledWith({
      codexQuotaProtection: {
        enabled: false,
        fiveHourThreshold: 95,
        weeklyThreshold: 98,
      },
    });
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });
});
