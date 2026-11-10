import React, { useId, useMemo, useState } from "react";
import {
  getIcon,
  hasIcon,
  getIconMetadata,
  isDarkInk,
  adaptSvgToTheme,
  isTileIcon,
} from "@/icons/extracted";
import { getLocalIconUrl, hasLocalIcon } from "@/icons/local";
import { cn } from "@/lib/utils";
import { isCustomIcon } from "@/utils/customIcon";

interface ProviderIconProps {
  icon?: string; // 图标名称
  name: string; // 供应商名称（用于 fallback）
  color?: string; // 自定义颜色 (Deprecated, kept for compatibility but ignored for SVG)
  size?: number | string; // 尺寸
  className?: string;
  showFallback?: boolean; // 是否显示 fallback
}

/**
 * 提取供应商名称的首字母（最多 2 个字符）。
 *
 * 使用 `Array.from` 按 Unicode 码位安全切分，避免 emoji 或 UTF-16 代理对（surrogate pairs）
 * 被截半产生无效字符（例如 `🤖 AI` 会被截出孤立的高代理项 `\ud83e`）。
 */
export function getProviderInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return Array.from(
    words
      .map((word) => Array.from(word)[0])
      .filter(Boolean)
      .join(""),
  )
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export const ProviderIcon: React.FC<ProviderIconProps> = ({
  icon,
  name,
  color,
  size = 32,
  className,
  showFallback = true,
}) => {
  // 获取图标 SVG；渐变、裁剪等内部 id 按实例加后缀。同一图标在页面里出现多次时
  // url(#id) 会解析到第一份，第一份在隐藏的侧栏里时其余几份都画不出来
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const { svg: iconSvg, adapted } = useMemo(() => {
    if (icon && !isCustomIcon(icon) && hasIcon(icon)) {
      const raw = getIcon(icon);
      // tile 图标自带底色，里面的深色是底，不能换成文字色
      const svg = isTileIcon(icon) ? raw : adaptSvgToTheme(raw);
      const adapted = svg !== raw;
      if (!svg.includes('id="')) return { svg, adapted };
      return {
        svg: svg
          .replace(/\bid="([^"]+)"/g, `id="$1-${instanceId}"`)
          .replace(/url\(#([^)]+)\)/g, `url(#$1-${instanceId})`)
          .replace(/href="#([^"]+)"/g, `href="#$1-${instanceId}"`),
        adapted,
      };
    }
    return { svg: "", adapted: false };
  }, [icon, instanceId]);

  // 本地光栅图标，或用户上传的 PNG。自定义图标只认我们自己编码的 PNG data URI，
  // 从不把外链地址当图标加载
  const localIconUrl = useMemo(() => {
    if (isCustomIcon(icon)) {
      return icon;
    }
    if (icon && hasLocalIcon(icon)) {
      return getLocalIconUrl(icon);
    }
    return "";
  }, [icon]);

  // 解码失败的图片（截断、损坏的自定义图标）记下来，退回首字母，不显示破图
  const [brokenUrl, setBrokenUrl] = useState<string>();

  // 计算尺寸样式
  const sizeStyle = useMemo(() => {
    const sizeValue = typeof size === "number" ? `${size}px` : size;
    return {
      width: sizeValue,
      height: sizeValue,
      // 内嵌 SVG 使用 1em 作为尺寸基准，这里同步 fontSize 让图标实际跟随 size 放大
      fontSize: sizeValue,
      lineHeight: 1,
    };
  }, [size]);

  // 获取有效颜色：优先使用传入的有效 color，否则从元数据获取 defaultColor。
  // 近黑色（#000 / #111 这类）的颜色不写死，交给外层文字色，
  // 否则深色模式下是黑底上的黑图标。已经把近黑笔画换成 currentColor 的图标
  // 也不能再套品牌色，否则眼睛、嘴这些细节会和脸同色
  const effectiveColor = useMemo(() => {
    if (adapted) return undefined;
    let resolved: string | undefined;
    if (color && typeof color === "string" && color.trim() !== "") {
      resolved = color;
    } else if (icon) {
      const metadata = getIconMetadata(icon);
      // 只有当 defaultColor 不是 currentColor 时才使用
      if (metadata?.defaultColor && metadata.defaultColor !== "currentColor") {
        resolved = metadata.defaultColor;
      }
    }
    return isDarkInk(resolved) ? undefined : resolved;
  }, [color, icon, adapted]);

  if (localIconUrl && localIconUrl !== brokenUrl) {
    return (
      <img
        src={localIconUrl}
        onError={() => setBrokenUrl(localIconUrl)}
        alt={name}
        title={name}
        className={cn(
          "inline-flex items-center justify-center flex-shrink-0 rounded-lg object-cover",
          className,
        )}
        style={sizeStyle}
        loading="lazy"
      />
    );
  }

  // 如果有图标，显示图标
  if (iconSvg) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center flex-shrink-0",
          className,
        )}
        title={name}
        style={{ ...sizeStyle, color: effectiveColor }}
        dangerouslySetInnerHTML={{ __html: iconSvg }}
      />
    );
  }

  // Fallback：显示首字母
  if (showFallback) {
    const initials = getProviderInitials(name);
    const fallbackFontSize =
      typeof size === "number" ? `${Math.max(size * 0.5, 12)}px` : "0.5em";
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center flex-shrink-0 rounded-lg",
          "bg-muted text-muted-foreground font-semibold",
          className,
        )}
        title={name}
        style={sizeStyle}
      >
        <span
          style={{
            fontSize: fallbackFontSize,
          }}
        >
          {initials}
        </span>
      </span>
    );
  }

  return null;
};
