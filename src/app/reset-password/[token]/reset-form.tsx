"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Button, Card, ErrorState, FOCUS_RING, Input, LinkButton, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<"form" | "updated" | "invalid">("form");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setPending(true);
    try {
      const response = await fetch("/api/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => null);

      if (response.ok) {
        setDone("updated");
        return;
      }

      if (data?.code === "invalid_token") {
        setDone("invalid");
        return;
      }

      setError(t("auth.genericError"));
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setPending(false);
    }
  }

  if (done === "updated") {
    return (
      <Card className="p-7">
        <h1 className="text-xl font-semibold tracking-tight">{t("auth.resetDoneTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-sand-600">{t("auth.resetDone")}</p>
        <LinkButton href="/login" className="mt-6 w-full">
          {t("auth.signInLink")}
        </LinkButton>
      </Card>
    );
  }

  if (done === "invalid") {
    return (
      <Card className="p-7">
        <h1 className="text-xl font-semibold tracking-tight">{t("auth.resetInvalidTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-sand-600">{t("auth.resetInvalid")}</p>
        <LinkButton href="/forgot-password" className="mt-6 w-full">
          {t("auth.requestNewLink")}
        </LinkButton>
      </Card>
    );
  }

  return (
    <Card className="p-7">
      <h1 className="text-xl font-semibold tracking-tight">{t("auth.resetTitle")}</h1>
      <p className="mt-1 text-sm text-sand-500">{t("auth.resetLead")}</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            {t("auth.newPassword")}
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="mt-1.5 text-xs text-sand-500">{t("auth.passwordHint")}</p>
        </div>

        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium">
            {t("auth.confirmPassword")}
          </label>
          <Input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        {error ? <ErrorState message={error} /> : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Spinner inverse /> : null}
          {t("auth.resetSubmit")}
        </Button>
      </form>

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
