import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProviderIconBox } from "@/components/ProviderIconBox";
import { hasIcon, isTileIcon } from "@/icons/extracted";
import { iconMetadata } from "@/icons/extracted/metadata";
import { hasLocalIcon } from "@/icons/local";
import { pngDataUri } from "../fixtures/customIcon";

describe("ProviderIconBox", () => {
  it("lets icons with their own solid background fill the box", () => {
    const { container } = render(
      <ProviderIconBox icon="88api" name="88API" size={44} glyphSize={20} />,
    );
    const box = container.firstElementChild as HTMLElement;
    const img = box.querySelector("img") as HTMLImageElement;

    expect(box.className).not.toContain("border-border-default");
    expect(img.style.width).toBe("44px");
    expect(img.className).toContain("object-cover");
  });

  it("keeps transparent logos small and centered inside a bordered box", () => {
    const { container } = render(
      <ProviderIconBox icon="dmxapi" name="DMXAPI" size={44} glyphSize={20} />,
    );
    const box = container.firstElementChild as HTMLElement;
    const img = box.querySelector("img") as HTMLImageElement;

    expect(box.className).toContain("border-border-default");
    expect(img.style.width).toBe("20px");
  });

  it("fills the box with an uploaded icon", () => {
    const { container } = render(
      <ProviderIconBox icon={pngDataUri(96, 96)} name="Acme" />,
    );
    const box = container.firstElementChild as HTMLElement;
    const img = box.querySelector("img") as HTMLImageElement;

    expect(box.className).not.toContain("border-border-default");
    expect(img.style.width).toBe("32px");
  });

  it("only marks icons that exist in the icon index", () => {
    const tiles = Object.keys(iconMetadata).filter(isTileIcon);

    expect(tiles.length).toBeGreaterThan(0);
    for (const name of tiles) {
      expect(hasIcon(name) || hasLocalIcon(name), name).toBe(true);
    }
  });
});
