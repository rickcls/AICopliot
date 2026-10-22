import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { FOCUS_RING } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The frame around signing in and accepting an invite: the mark and name over
 * one centred column, on the same soft terracotta wash as the landing page.
 * The two pages had copied this wrapper by hand.
 */
export function AuthShell({
  appName,
  children,
}: {
  appName: string;
  children: React.ReactNode;
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-linear-to-b from-brand-50/70 via-sand-50 to-sand-50 px-6 py-12">
      <div className="w-full max-w-sm">
        <Link
          href="/"
          className={cn(
            "mx-auto mb-8 flex w-fit flex-col items-center gap-3 rounded-xl",
            FOCUS_RING,
          )}
        >
          <BrandMark className="size-11" />
          <span className="text-base font-semibold tracking-tight">{appName}</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
