import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "@/components/layout/BrandLogo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <div className="flex flex-col items-center gap-2">
        <BrandLogo variant="full" className="h-9" />
        <p className="text-sm text-muted-foreground">Create. Advertise. Connect. Convert.</p>
      </div>
      {children}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <Link to="/legal/privacy" className="hover:text-foreground">Privacy Policy</Link>
        <Link to="/legal/terms" className="hover:text-foreground">Terms of Service</Link>
        <Link to="/legal/data-deletion" className="hover:text-foreground">Data Deletion</Link>
      </div>
    </div>
  );
}
