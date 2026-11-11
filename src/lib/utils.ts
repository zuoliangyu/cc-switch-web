import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// 随界面密度变的尺寸（tailwind.config.cjs）：h-control 和调用方传的 h-8 要能互相覆盖
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["control", "control-sm", "control-xs", "nav-row", "card-y"],
    },
    classGroups: {
      "min-h": [{ "min-h": ["card"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
