import { useState, type FormEvent } from "react";
import { Navigate, Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Checkbox } from "@/components/ui/checkbox";

export default function Signup() {
  const { user, loading } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectParam = searchParams.get("redirect");
  const loginHref = redirectParam ? `/login?redirect=${encodeURIComponent(redirectParam)}` : "/login";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(() => {
    const saved = sessionStorage.getItem("stabiflow.authEmail") ?? "";
    sessionStorage.removeItem("stabiflow.authEmail");
    return saved;
  });
  const [password, setPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [resending, setResending] = useState(false);

  if (!loading && user) return <Navigate to={sessionStorage.getItem("stabiflow.pendingCheckout") ? "/app/billing" : "/app"} replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreedToTerms) return;
    setSubmitting(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      // legal_acceptance_requested is a durable marker only - it does NOT
      // carry a version or timestamp (those can never come from the
      // browser). It just tells the post-login bootstrap in useAuth.tsx
      // "this account checked the consent box at signup", so the server
      // can call accept_current_legal_terms() (which records the DB's own
      // current versions + clock) as soon as a session exists - whether
      // that's immediately (email confirmation off) or after the user
      // clicks the confirmation link (email confirmation on).
      options: {
        data: { full_name: fullName, legal_acceptance_requested: true },
        emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
      },
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSubmitted(true);
  };

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/login?confirmed=1` },
    });
    setResending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Confirmation email resent. Please check your inbox and spam folder.");
  };

  if (submitted) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle className="text-xl">Check your email</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              We sent a confirmation link to <strong>{email}</strong>. Confirm your address, then{" "}
              <Link
                to={loginHref}
                onClick={() => sessionStorage.setItem("stabiflow.authEmail", email)}
                className="text-foreground underline"
              >
                sign in
              </Link>.
            </p>
            <Button type="button" variant="outline" className="w-full" onClick={handleResend} disabled={resending}>
              {resending ? "Resending..." : "Resend confirmation email"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Didn't receive it? Check your spam or junk folder, or resend the email above.
            </p>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Create your account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name</Label>
              <Input id="fullName" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="flex items-start gap-2">
              <Checkbox id="agreeToTerms" checked={agreedToTerms} onCheckedChange={(checked) => setAgreedToTerms(checked === true)} className="mt-0.5" />
              <Label htmlFor="agreeToTerms" className="text-xs font-normal leading-snug text-muted-foreground">
                I agree to the{" "}
                <Link to="/legal/terms" target="_blank" rel="noreferrer" className="text-foreground underline">Terms of Service</Link>{" "}
                and{" "}
                <Link to="/legal/privacy" target="_blank" rel="noreferrer" className="text-foreground underline">Privacy Policy</Link>.
              </Label>
            </div>
            <Button type="submit" className="w-full" disabled={submitting || !agreedToTerms}>
              {submitting ? "Creating account..." : "Create account"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              to={loginHref}
              onClick={() => {
                if (email.trim()) sessionStorage.setItem("stabiflow.authEmail", email.trim());
              }}
              className="text-foreground underline"
            >
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
