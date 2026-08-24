import type { ReactNode } from "react";
import { BrandLogo } from "@/components/layout/BrandLogo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <div className="flex flex-col items-center gap-2">
        <BrandLogo variant="full" className="h-9" />
        <p className="text-sm text-muted-foreground">Create. Advertise. Connect. Convert.</p>
      </div>
      {children}
    </div>
  );
}
