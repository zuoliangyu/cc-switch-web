import { ProviderIcon } from "@/components/ProviderIcon";
import { isTileIcon } from "@/icons/extracted";
import { cn } from "@/lib/utils";
import { isCustomIcon } from "@/utils/customIcon";

interface ProviderIconBoxProps {
  icon?: string;
  name: string;
  color?: string;
  /** 框的边长（px），默认 32 */
  size?: number;
  /** 透明 logo 的尺寸（px），默认按 22 / 32 的比例随框缩放 */
  glyphSize?: number;
  /** 框的圆角、底色、透明度等 */
  className?: string;
  iconClassName?: string;
}

/**
 * 供应商图标的圆角框。透明 logo 缩小居中、框带边框；自带实心底的图标
 * （metadata 里 shape: "tile"）和用户上传的图标铺满整框并裁成框的圆角，否则会变成
 * 「框里套一块小方块」。
 */
export function ProviderIconBox({
  icon,
  name,
  color,
  size = 32,
  glyphSize,
  className,
  iconClassName,
}: ProviderIconBoxProps) {
  // 用户上传的图标在编码时已经按 tile / 透明 logo 留好了白，统一铺满整框
  const tile = isCustomIcon(icon) || isTileIcon(icon);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-[8px]",
        tile
          ? // 描边画在图片上层：白底图标放在白色卡片上也有轮廓
            "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:ring-inset after:ring-black/10 dark:after:ring-white/10"
          : "border border-border-default",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <ProviderIcon
        icon={icon}
        name={name}
        color={color}
        size={tile ? size : (glyphSize ?? Math.round((size * 22) / 32))}
        className={cn(iconClassName, tile && "rounded-none object-cover")}
      />
    </span>
  );
}
