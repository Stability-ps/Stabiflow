import { cn } from "@/lib/utils";

// Wires in the approved StabiFlow_Transparent_PNG_Logo_Pack assets as-is -
// nothing here is regenerated or redesigned. StabiFlow_Full_Logo_Light.png
// has a transparent background with dark navy text, so it's the correct
// choice for every LIGHT surface this app currently has (the whole shell
// is light-themed in Phase 4). StabiFlow_Full_Logo_Dark.png, by contrast,
// is a self-contained navy lockup card with an OPAQUE background baked
// in (verified: not a transparent asset) - using it anywhere here would
// mean a visible mismatched rectangle unless a surface exactly matching
// its baked-in navy existed, so it's deliberately not used until a real
// dark-mode surface is designed. StabiFlow_Icon.png IS genuinely
// transparent and safe on any background - used for the compact mark.
type BrandLogoProps = { variant?: "full" | "icon"; className?: string };

export function BrandLogo({ variant = "full", className }: BrandLogoProps) {
  if (variant === "icon") {
    return <img src="/brand/StabiFlow_Icon.png" alt="StabiFlow" className={cn("object-contain", className)} />;
  }
  return <img src="/brand/StabiFlow_Full_Logo_Light.png" alt="StabiFlow" className={cn("object-contain", className)} />;
}
