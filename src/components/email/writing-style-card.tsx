"use client";

import { useId, useState } from "react";
import { Sparkles } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useToast } from "@/components/toast";
import { Button, Card, ErrorState, Spinner, Textarea } from "@/components/ui";
import type { WritingStyleView } from "@/lib/email/service";

const MAX_SAMPLES = 10;

/**
 * The person's own emails and the description of their tone drawn from them.
 * Samples shape how drafts sound; they are never a source of facts. The
 * description is the AI's reading and stays editable, because the person knows
 * their own voice better than any summary of it.
 */
export function WritingStyleCard({ initial }: { initial: WritingStyleView }) {
  const t = useT();
  const toast = useToast();
  const ids = useId();
  const [open, setOpen] = useState(initial.samples.length === 0);
  const [samples, setSamples] = useState(initial.samples.length > 0 ? initial.samples : [""]);
  const [profile, setProfile] = useState(initial.profile ?? "");
  const [signature, setSignature] = useState(initial.signature ?? "");
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState<"save" | "analyse" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cleanSamples = samples.map((sample) => sample.trim()).filter(Boolean);

  async function save(): Promise<boolean> {
    setBusy("save");
    setError(null);
    try {
      const response = await fetch("/api/me/writing-style", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples: cleanSamples, profile: profile.trim() || null, signature: signature.trim() || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? t("email.style.saveFailed"));
        return false;
      }
      setSaved(data.style);
      toast.success(t("email.style.saved"));
      return true;
    } catch {
      setError(t("common.couldNotReach"));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function analyse() {
    if (cleanSamples.length < 2) {
      setError(t("email.style.needTwo"));
      return;
    }
    // The description is drawn from what is stored, so store the samples first.
    if (!(await save())) return;
    setBusy("analyse");
    try {
      const response = await fetch("/api/me/writing-style/profile", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? t("email.style.saveFailed"));
        return;
      }
      setSaved(data.style);
      setProfile(data.style.profile ?? "");
    } catch {
      setError(t("common.couldNotReach"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-sand-900">{t("email.style.title")}</h2>
          <p className="mt-0.5 text-xs text-sand-500">
            {saved.samples.length > 0
              ? t("email.style.samples", { count: saved.samples.length })
              : t("email.style.lead")}
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t("email.style.close") : t("email.style.edit")}
        </Button>
      </div>

      {!open && saved.profile ? (
        <p className="border-t border-sand-100 px-4 py-3 text-sm whitespace-pre-wrap text-sand-700">{saved.profile}</p>
      ) : null}

      {open ? (
        <div className="space-y-4 border-t border-sand-100 p-4">
          <p className="text-xs text-sand-500">{t("email.style.lead")}</p>
          {samples.map((sample, index) => (
            <div key={index}>
              <div className="mb-1 flex items-center justify-between">
                <label htmlFor={`${ids}-sample-${index}`} className="text-xs font-medium text-sand-500">
                  {t("email.style.sampleLabel", { index: index + 1 })}
                </label>
                {samples.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setSamples(samples.filter((_, i) => i !== index))}
                    className="text-xs text-sand-500 hover:text-red-700"
                  >
                    {t("email.style.removeSample")}
                  </button>
                ) : null}
              </div>
              <Textarea
                id={`${ids}-sample-${index}`}
                value={sample}
                rows={4}
                maxLength={4000}
                placeholder={t("email.style.samplePlaceholder")}
                onChange={(event) =>
                  setSamples(samples.map((value, i) => (i === index ? event.target.value : value)))
                }
              />
            </div>
          ))}
          {samples.length < MAX_SAMPLES ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setSamples([...samples, ""])}>
              {t("email.style.addSample")}
            </Button>
          ) : null}

          <div>
            <label htmlFor={`${ids}-signature`} className="mb-1 block text-xs font-medium text-sand-500">
              {t("email.style.signature")}
            </label>
            <Textarea
              id={`${ids}-signature`}
              value={signature}
              rows={3}
              maxLength={500}
              onChange={(event) => setSignature(event.target.value)}
            />
          </div>

          <div>
            <label htmlFor={`${ids}-profile`} className="mb-1 block text-xs font-medium text-sand-500">
              {t("email.style.profile")}
            </label>
            <Textarea
              id={`${ids}-profile`}
              value={profile}
              rows={5}
              maxLength={2000}
              placeholder={t("email.style.noProfile")}
              onChange={(event) => setProfile(event.target.value)}
            />
            <p className="mt-1 text-xs text-sand-400">{t("email.style.profileHint")}</p>
          </div>

          {error ? <ErrorState message={error} /> : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy !== null} onClick={() => void save()}>
              {busy === "save" ? <Spinner className="border-white/40 border-t-white" /> : null}
              {t("email.style.save")}
            </Button>
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void analyse()}>
              {busy === "analyse" ? <Spinner /> : <Sparkles className="size-4" aria-hidden />}
              {busy === "analyse" ? t("email.style.analysing") : t("email.style.analyse")}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
