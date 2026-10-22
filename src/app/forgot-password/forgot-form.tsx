"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Button, Card, ErrorState, Input, Spinner, FOCUS_RING } from "@/components/ui";
import { cn } from "@/lib/utils";

export function ForgotPasswordForm() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<"resend" | "log" | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (response.status === 503) {
        setError(t("auth.resetUnavailable"));
        return;
      }

      if (!response.ok) {
        setError(t("auth.genericError"));
        return;
      }

      const data = await response.json().catch(() => null);
      setSent(data?.delivery === "log" ? "log" : "resend");
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-7">
      {sent ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight">
            {sent === "log" ? t("auth.resetSentDevTitle") : t("auth.resetSentTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-sand-600">
            {sent === "log" ? t("auth.resetSentDev") : t("auth.resetSent")}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight">{t("auth.forgotTitle")}</h1>
          <p className="mt-1 text-sm text-sand-500">{t("auth.forgotLead")}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
                {t("auth.email")}
              </label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </div>

            {error ? <ErrorState message={error} /> : null}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? <Spinner inverse /> : null}
              {t("auth.forgotSubmit")}
            </Button>
          </form>
        </>
      )}

      <p className="mt-5 text-center text-sm text-sand-500">
        <Link
          href="/login"
          className={cn(
            "rounded-md font-medium text-sand-900 underline underline-offset-2",
            FOCUS_RING,
          )}
        >
          {t("auth.backToSignIn")}
        </Link>
      </p>
    </Card>
  );
}
