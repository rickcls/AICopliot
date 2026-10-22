import { UserRound } from "lucide-react";
import { identityTone } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A project's mark: its initial on a colour taken from its id, or a person
 * glyph on the brand tint for someone's own project. The same project wears
 * the same mark in the sidebar, the project list, and its own header, which is
 * what lets the eye find it without reading. Decorative: the name is always
 * beside it.
 */
export function ProjectMark({
  id,
  name,
  personal,
  className,
}: {
  id: string;
  name: string;
  personal: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-lg text-[11px] font-semibold",
        personal ? "bg-brand-100 text-brand-700" : identityTone(id),
        className,
      )}
    >
      {personal ? (
        <UserRound className="size-[60%]" />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
