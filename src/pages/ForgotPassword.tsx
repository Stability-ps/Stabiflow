import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLayout } from "@/components/layout/AuthLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <AuthLayout>
        <Card className="w-full max-w-sm">
          <CardHeader><CardTitle className="text-xl">Check your email</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              If an account exists for <strong>{email}</strong>, we've sent a link to reset your password.
            </p>
            <Link to="/login" className="mt-4 block text-center text-sm text-foreground underline">Back to sign in</Link>
          </CardContent>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Enter the email address on your account and we'll send you a link to reset your password.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Sending..." : "Send reset link"}
            </Button>
          </form>
          <Link to="/login" className="mt-4 block text-center text-sm text-muted-foreground underline">Back to sign in</Link>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
