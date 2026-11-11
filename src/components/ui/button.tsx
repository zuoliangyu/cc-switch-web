import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // 主按钮：Material Monet 主色
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        // 危险按钮：红底白字
        destructive:
          "bg-red-500 text-white hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700",
        // 轮廓按钮
        outline:
          "border border-border-default bg-background/80 text-foreground hover:bg-accent hover:text-accent-foreground hover:border-border-hover",
        // 次按钮：柔和表面色
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/85",
        // 幽灵按钮
        ghost: "text-muted-foreground hover:text-foreground hover:bg-accent/80",
        // MCP 专属按钮：Monet 冷色强调
        mcp: "theme-tertiary-solid",
        // 链接按钮
        link: "text-primary underline-offset-4 hover:text-primary/80 hover:underline",
      },
      size: {
        // 高度随界面密度变：紧凑 36 / 32 / 28，舒适各高 4px（--h-control*）
        default: "h-control px-4 py-2",
        sm: "h-control-sm rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-control w-control p-1.5",
        // 上游 v7 的三档尺寸（用量页等迁入的组件在用）：compact 28、regular 32、icon-compact 28 见方
        compact: "h-control-xs rounded-md px-3 text-[13px] font-medium",
        regular: "h-control-sm rounded-md px-3.5 text-[13px] font-medium",
        "icon-compact":
          "h-control-xs w-control-xs rounded-md p-0 text-muted-foreground hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
