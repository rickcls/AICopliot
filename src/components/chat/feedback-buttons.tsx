"use client";

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Answer rating. `initialRating` is what a replayed thread was already given —
 * without it, reopening a conversation would silently invite the same person to
 * rate the same answer again.
 */
export function FeedbackButtons({
  messageId,
  initialRating = null,
}: {
  messageId: string;
  initialRating?: "up" | "down" | null;
}) {
  const [rating, setRating] = useState<"up" | "down" | null>(initialRating);
  const [failed, setFailed] = useState(false);

  async function send(value: "up" | "down") {
    const previous = rating;
    setRating(value);
    setFailed(false);

    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatMessageId: messageId, rating: value }),
    }).catch(() => null);

    if (!response?.ok) {
      setRating(previous);
      setFailed(true);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-xs text-slate-500">Was this helpful?</span>
      <Button
        variant={rating === "up" ? "secondary" : "ghost"}
        size="icon"
        aria-pressed={rating === "up"}
        aria-label="Helpful"
        onClick={() => send("up")}
      >
        <ThumbsUp className="size-3.5" aria-hidden />
      </Button>
      <Button
        variant={rating === "down" ? "secondary" : "ghost"}
        size="icon"
        aria-pressed={rating === "down"}
        aria-label="Not helpful"
        onClick={() => send("down")}
      >
        <ThumbsDown className="size-3.5" aria-hidden />
      </Button>
      {rating && !failed ? (
        <span className="text-xs text-slate-500">Thanks.</span>
      ) : null}
      {failed ? (
        <span className="text-xs text-red-600">Could not save feedback.</span>
      ) : null}
    </div>
  );
}
