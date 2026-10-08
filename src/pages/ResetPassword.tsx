import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLayout } from "@/components/layout/AuthLayout";

type LinkStatus = "checking" | "valid" | "invalid";

/**
 * Supabase redirects here with the recovery grant in the URL hash (parsed
 * automatically by detectSessionInUrl) rather than as a query param, and an
 * expired/invalid link comes back as `#error=...&error_code=otp_expired`
 * instead of ever firing PASSWORD_RECOVERY - so both cases have to be read
 * from the hash directly.
 */
function getHashParams() {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [linkStatus, setLinkStatus] = useState<LinkStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const hashParams = getHashParams();
    if (hashParams.get("error")) {
      setLinkStatus("invalid");
      return;
    }

    let settled = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        settled = true;
        setLinkStatus("valid");
      }
    });

    // Covers the case where PASSWORD_RECOVERY already fired before this
    // listener was attached (detectSessionInUrl runs on client init).
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!settled && session) {
        settled = true;
        setLinkStatus("valid");
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) setLinkStatus("invalid");
    }, 4000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDone(true);
  };

  if (linkStatus === "checking") {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardContent className="pt-6">
            <p className="text-center text-sm text-muted-foreground">Verifying your link…</p>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  if (linkStatus === "invalid") {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle className="text-xl">Link expired</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This password reset link is invalid or has expired. Request a new one to continue.
            </p>
            <Link to="/forgot-password" className="mt-4 block text-center text-sm text-foreground underline">
              Request a new link
            </Link>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  if (done) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle className="text-xl">Password updated</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Your password has been changed successfully.</p>
            <Button className="mt-4 w-full" onClick={() => navigate("/app", { replace: true })}>
              Continue to StabiFlow
            </Button>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Set a new password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Updating…" : "Update password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
