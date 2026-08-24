import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-all duration-200 ease-out hover:-translate-y-0.5 hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:brightness-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-0 active:scale-[0.99]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_14px_34px_-18px_hsl(var(--primary)/0.6)] hover:-translate-y-0.5 hover:bg-primary/95 hover:shadow-[0_18px_40px_-18px_hsl(var(--primary)/0.55)]",
        destructive: "bg-destructive text-destructive-foreground shadow-[0_14px_34px_-18px_hsl(var(--destructive)/0.5)] hover:-translate-y-0.5 hover:bg-destructive/90",
        outline: "border border-input/90 bg-white/90 text-foreground shadow-[0_8px_24px_-22px_rgba(15,23,42,0.35)] hover:-translate-y-0.5 hover:border-primary/25 hover:bg-accent/70 hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-[0_10px_24px_-20px_rgba(15,23,42,0.22)] hover:-translate-y-0.5 hover:bg-secondary/90",
        ghost: "text-foreground/80 hover:bg-accent/70 hover:text-foreground hover:shadow-[0_10px_24px_-20px_rgba(15,23,42,0.28)]",
        link: "text-primary underline-offset-4 hover:translate-y-0 hover:brightness-100 hover:underline",
      },
      size: {
        default: "h-11 px-4 py-2.5",
        sm: "h-9 rounded-lg px-3",
        lg: "h-12 rounded-xl px-8",
        icon: "h-11 w-11",
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
