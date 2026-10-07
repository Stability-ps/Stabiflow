import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Figma "Button": Primary / Secondary (outline) / Ghost / Destructive.
// Heights come from --control-h / --control-h-sm (44px on phones, 36/32px
// from md up), so an explicit h-* passed by a caller still wins.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        destructive: "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90",
        outline: "border border-input bg-card text-foreground shadow-xs hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-border",
        ghost: "text-foreground hover:bg-accent",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[var(--control-h)] px-4",
        sm: "h-[var(--control-h-sm)] px-3 text-[13px]",
        lg: "h-11 px-5",
        icon: "h-[var(--control-h)] w-[var(--control-h)]",
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
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
