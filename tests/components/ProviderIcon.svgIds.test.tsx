import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProviderIcon } from "@/components/ProviderIcon";

describe("ProviderIcon SVG ids", () => {
  it("gives each instance its own gradient ids so a hidden copy cannot blank the rest", () => {
    const { container } = render(
      <>
        <ProviderIcon icon="minimax" name="MiniMax" />
        <ProviderIcon icon="minimax" name="MiniMax" />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);

    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);

    for (const svg of svgs) {
      const ownIds = new Set(
        [...svg.querySelectorAll("[id]")].map((node) => node.id),
      );
      const refs = [...svg.outerHTML.matchAll(/url\(#([^)]+)\)/g)].map(
        (match) => match[1],
      );
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) expect(ownIds.has(ref)).toBe(true);
    }
  });
});
