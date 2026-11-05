import type { PropsWithChildren } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { replaceRepoDiscovery } from "@/hooks/useSkills.helpers";
import {
  useAddSkillRepo,
  useDiscoverableSkills,
  useRefreshDiscoverableSkills,
  useRemoveSkillRepo,
} from "@/hooks/useSkills";
import type {
  DiscoverableSkill,
  SkillDiscoveryResult,
  SkillRepo,
  SkillRepoFailure,
} from "@/lib/api/skills";

const apiMocks = vi.hoisted(() => ({
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
  discoverRepo: vi.fn(),
  discoverReport: vi.fn(),
}));

vi.mock("@/lib/api/skills", () => ({
  skillsApi: apiMocks,
}));

// Web 把发现到的 Skill 和没读到的仓库分两份缓存
const DISCOVERABLE = ["skills", "discoverable"];
const FAILURES = ["skills", "discoverable-failures"];

function skill(owner: string, repo: string, name: string): DiscoverableSkill {
  return {
    key: `${owner}/${repo}:${name}`,
    name,
    description: "",
    directory: name,
    repoOwner: owner,
    repoName: repo,
    repoBranch: "main",
  };
}

const repoA: SkillRepo = {
  owner: "a",
  name: "one",
  branch: "main",
  enabled: true,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const discoveredNames = (queryClient: QueryClient) =>
  queryClient
    .getQueryData<DiscoverableSkill[]>(DISCOVERABLE)
    ?.map((s) => s.name);

describe("replaceRepoDiscovery", () => {
  it("replaces only the target repo's skills and failures, sorted by name", () => {
    const skills = [skill("a", "one", "old"), skill("b", "two", "zeta")];
    const failures: SkillRepoFailure[] = [
      { owner: "a", name: "one", branch: "main", error: "x" },
      { owner: "b", name: "three", branch: "main", error: "y" },
    ];
    const next: SkillDiscoveryResult = {
      skills: [skill("a", "one", "Alpha")],
      failures: [],
    };

    expect(replaceRepoDiscovery(skills, failures, repoA, next)).toEqual({
      skills: [skill("a", "one", "Alpha"), skill("b", "two", "zeta")],
      failures: [{ owner: "b", name: "three", branch: "main", error: "y" }],
    });
    expect(replaceRepoDiscovery(skills, failures, repoA)?.skills).toEqual([
      skill("b", "two", "zeta"),
    ]);
  });

  it("leaves an empty cache alone", () => {
    expect(
      replaceRepoDiscovery(undefined, undefined, repoA, {
        skills: [],
        failures: [],
      }),
    ).toBeUndefined();
  });
});

describe("repo mutations patch discovery instead of refetching every repo", () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    apiMocks.addRepo.mockResolvedValue(true);
    apiMocks.removeRepo.mockResolvedValue(true);
  });

  it("adding a repo discovers just that repo", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(DISCOVERABLE, [skill("b", "two", "beta")]);
    queryClient.setQueryData(FAILURES, [
      { owner: "a", name: "one", branch: "main", error: "old" },
    ]);
    const fresh = { skills: [skill("a", "one", "alpha")], failures: [] };
    apiMocks.discoverRepo.mockResolvedValue(fresh);

    const { result } = renderHook(() => useAddSkillRepo(), { wrapper });
    let returned: SkillDiscoveryResult | null = null;
    await act(async () => {
      returned = await result.current.mutateAsync(repoA);
    });

    expect(returned).toEqual(fresh);
    expect(apiMocks.discoverRepo).toHaveBeenCalledWith("a", "one");
    expect(apiMocks.discoverReport).not.toHaveBeenCalled();
    expect(discoveredNames(queryClient)).toEqual(["alpha", "beta"]);
    // 这个仓库读成功了，之前的失败记录要清掉
    expect(queryClient.getQueryData(FAILURES)).toEqual([]);
  });

  it("disabling a repo drops its skills without any network call", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(DISCOVERABLE, [
      skill("a", "one", "alpha"),
      skill("b", "two", "beta"),
    ]);

    const { result } = renderHook(() => useAddSkillRepo(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ ...repoA, enabled: false });
    });

    expect(apiMocks.discoverRepo).not.toHaveBeenCalled();
    expect(apiMocks.discoverReport).not.toHaveBeenCalled();
    expect(discoveredNames(queryClient)).toEqual(["beta"]);
  });

  it("removing a repo drops its skills without any network call", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(DISCOVERABLE, [
      skill("a", "one", "alpha"),
      skill("b", "two", "beta"),
    ]);

    const { result } = renderHook(() => useRemoveSkillRepo(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ owner: "a", name: "one" });
    });

    expect(apiMocks.discoverReport).not.toHaveBeenCalled();
    expect(discoveredNames(queryClient)).toEqual(["beta"]);
  });

  it("falls back to a full discovery when there is nothing to patch yet", async () => {
    const { queryClient, wrapper } = setup();
    // 第一次整体发现挂着不回来，第二次正常返回
    apiMocks.discoverReport
      .mockReturnValueOnce(new Promise(() => {}))
      .mockResolvedValue({
        skills: [skill("a", "one", "alpha")],
        failures: [],
      });
    apiMocks.discoverRepo.mockResolvedValue({
      skills: [skill("a", "one", "alpha")],
      failures: [],
    });
    renderHook(() => useDiscoverableSkills(), { wrapper });
    await vi.waitFor(() => expect(apiMocks.discoverReport).toHaveBeenCalled());

    // 首次整体发现还没回来就添加：它会被取消，必须再整体发现一次
    const { result } = renderHook(() => useAddSkillRepo(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(repoA);
    });

    await vi.waitFor(() =>
      expect(discoveredNames(queryClient)).toEqual(["alpha"]),
    );
    expect(apiMocks.discoverReport).toHaveBeenCalledTimes(2);
    queryClient.clear();
  });

  it("refreshes the repo list before the repo's archive finishes downloading", async () => {
    const { queryClient, wrapper } = setup();
    apiMocks.discoverRepo.mockReturnValue(new Promise(() => {}));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useAddSkillRepo(), { wrapper });
    act(() => {
      void result.current.mutateAsync(repoA);
    });

    await vi.waitFor(() => expect(apiMocks.discoverRepo).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["skills", "repos"] });
  });

  it("a slow discovery does not restore a repo removed meanwhile", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(DISCOVERABLE, [skill("b", "two", "beta")]);
    let resolveDiscover!: (value: SkillDiscoveryResult) => void;
    apiMocks.discoverRepo.mockReturnValue(
      new Promise<SkillDiscoveryResult>((resolve) => {
        resolveDiscover = resolve;
      }),
    );

    const add = renderHook(() => useAddSkillRepo(), { wrapper });
    const remove = renderHook(() => useRemoveSkillRepo(), { wrapper });
    let adding!: Promise<unknown>;
    act(() => {
      adding = add.result.current.mutateAsync(repoA);
    });
    await vi.waitFor(() => expect(apiMocks.discoverRepo).toHaveBeenCalled());
    await act(async () => {
      await remove.result.current.mutateAsync({ owner: "a", name: "one" });
    });
    await act(async () => {
      resolveDiscover({ skills: [skill("a", "one", "alpha")], failures: [] });
      await adding;
    });

    expect(discoveredNames(queryClient)).toEqual(["beta"]);
  });
});

describe("useRefreshDiscoverableSkills", () => {
  it("asks the backend to bypass its per-repo cache", async () => {
    apiMocks.discoverReport.mockResolvedValue({ skills: [], failures: [] });
    const { queryClient, wrapper } = setup();
    // 需要一个活跃的 observer，refetchQueries 才会真正发请求；先等挂载时的
    // 首次发现结束，否则刷新会直接复用那次在飞的请求
    const discover = renderHook(() => useDiscoverableSkills(), { wrapper });
    await vi.waitFor(() =>
      expect(discover.result.current.isFetching).toBe(false),
    );

    const { result } = renderHook(() => useRefreshDiscoverableSkills(), {
      wrapper,
    });
    await act(async () => {
      await result.current();
    });

    expect(apiMocks.discoverReport).toHaveBeenLastCalledWith(true);
    queryClient.clear();
  });
});
