import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../msw/server";
import { CodexSessionCompressionSettings } from "@/components/settings/CodexSessionCompressionSettings";

const RUNTIME = "http://runtime.local";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CodexSessionCompressionSettings />
    </QueryClientProvider>,
  );
}

describe("CodexSessionCompressionSettings", () => {
  it("reads the current state and the sessions size from config.toml", async () => {
    server.use(
      http.post(`${RUNTIME}/get_codex_session_compression`, () =>
        HttpResponse.json(true),
      ),
      http.post(`${RUNTIME}/get_codex_sessions_disk_usage`, () =>
        HttpResponse.json(3 * 1024 * 1024),
      ),
    );
    renderSettings();
    await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
    expect(
      await screen.findByText(/settings\.codexSessionCompressionUsage/),
    ).toBeInTheDocument();
  });

  it("writes the switch straight to config.toml and shows the saved state", async () => {
    const writes: boolean[] = [];
    server.use(
      http.post(
        `${RUNTIME}/set_codex_session_compression`,
        async ({ request }) => {
          const { enabled } = (await request.json()) as { enabled: boolean };
          writes.push(enabled);
          return HttpResponse.json(enabled);
        },
      ),
    );
    renderSettings();
    const toggle = screen.getByRole("switch");
    await waitFor(() => expect(toggle).not.toBeChecked());
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(writes).toEqual([true]);
  });

  it("keeps the previous state and reports an error when the write fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(
      http.post(`${RUNTIME}/set_codex_session_compression`, () =>
        HttpResponse.json({ error: "boom" }, { status: 500 }),
      ),
    );
    renderSettings();
    const toggle = screen.getByRole("switch");
    await userEvent.click(toggle);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "settings.codexSessionCompressionFailed",
      ),
    );
    expect(toggle).not.toBeChecked();
    errorLog.mockRestore();
  });
});
