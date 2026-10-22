"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { useT } from "@/components/i18n-provider";
import { Button, Card, ErrorState, FOCUS_RING, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

/**
 * `callbackUrl` has already been checked by `safeCallbackUrl` on the server,
 * so it is always a path on this site. An invite link sends people here and
 * back again, which is why sign-up says what happens next when `invited`.
 */
export function LoginForm({
  callbackUrl,
  initialMode,
  invited,
}: {
  callbackUrl: string;
  initialMode: Mode;
  invited: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      if (mode === "signup") {
        const response = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(
            response.status === 409
              ? t("auth.emailTaken")
              : (data.error ?? t("auth.createFailed")),
          );
          return;
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(t("auth.wrongPassword"));
        return;
      }

      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError(t("auth.genericError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="p-7">
      <h1 className="text-xl font-semibold tracking-tight">
        {mode === "signin" ? t("auth.signInTitle") : t("auth.signUpTitle")}
      </h1>
      <p className="mt-1 text-sm text-sand-500">
        {invited
          ? t("auth.invitedLead")
          : mode === "signin"
            ? t("auth.signInLead")
            : t("auth.signUpLead")}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {mode === "signup" ? (
          <div>
            <label htmlFor="name" className="mb-1.5 block text-sm font-medium">
              {t("auth.name")}
            </label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </div>
        ) : null}

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            {t("auth.email")}
          </label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            {t("auth.password")}
          </label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
          {mode === "signup" ? (
            <p className="mt-1.5 text-xs text-sand-500">
              {t("auth.passwordHint")}
            </p>
          ) : (
            <p className="mt-1.5 text-right text-sm">
              <Link
                href="/forgot-password"
                className={cn(
                  "rounded-md font-medium text-sand-600 underline underline-offset-2",
                  FOCUS_RING,
                )}
              >
                {t("auth.forgotPassword")}
              </Link>
            </p>
          )}
        </div>

        {error ? <ErrorState message={error} /> : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <Spinner inverse /> : null}
          {mode === "signin" ? t("auth.submitSignIn") : t("auth.submitSignUp")}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-sand-500">
        {mode === "signin" ? t("auth.noAccount") : t("auth.haveAccount")}{" "}
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
          }}
          className="font-medium text-sand-900 underline underline-offset-2"
        >
          {mode === "signin" ? t("auth.createOne") : t("auth.signInLink")}
        </button>
      </p>
    </Card>
  );
}
