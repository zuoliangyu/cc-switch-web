import React, { useId, useMemo, useState } from "react";
import { getIcon, hasIcon, getIconMetadata } from "@/icons/extracted";
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
  const iconSvg = useMemo(() => {
    if (icon && !isCustomIcon(icon) && hasIcon(icon)) {
      const svg = getIcon(icon);
      if (!svg.includes('id="')) return svg;
      return svg
        .replace(/\bid="([^"]+)"/g, `id="$1-${instanceId}"`)
        .replace(/url\(#([^)]+)\)/g, `url(#$1-${instanceId})`)
        .replace(/href="#([^"]+)"/g, `href="#$1-${instanceId}"`);
    }
    return "";
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

  // 获取有效颜色：优先使用传入的有效 color，否则从元数据获取 defaultColor
  const effectiveColor = useMemo(() => {
    // 只有当 color 是有效的非空字符串时才使用
    if (color && typeof color === "string" && color.trim() !== "") {
      return color;
    }
    // 否则从元数据获取 defaultColor
    if (icon) {
      const metadata = getIconMetadata(icon);
      // 只有当 defaultColor 不是 currentColor 时才使用
      if (metadata?.defaultColor && metadata.defaultColor !== "currentColor") {
        return metadata.defaultColor;
      }
    }
    return undefined;
  }, [color, icon]);

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
    const initials = name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
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
