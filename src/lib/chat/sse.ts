/**
 * Minimal SSE frame parser for the answer stream.
 *
 * The chat stream is a POST (a 2000-character question does not belong in a
 * query string, and EventSource's auto-reconnect would re-run the whole
 * pipeline every time an answer completed), so it is read through
 * `response.body.getReader()` rather than EventSource — which means parsing the
 * framing ourselves. Kept string-in/string-out so it is directly testable.
 */

export interface SseEvent {
  event: string;
  data: string;
}

export interface SseParseResult {
  events: SseEvent[];
  /** The trailing partial frame, to be prepended to the next chunk. */
  rest: string;
}

export function parseSseChunk(buffer: string): SseParseResult {
  const frames = buffer.split("\n\n");
  // The final segment has no terminator yet, so it may be half a frame.
  const rest = frames.pop() ?? "";
  const events: SseEvent[] = [];

  for (const frame of frames) {
    let event = "message";
    const data: string[] = [];

    for (const line of frame.split("\n")) {
      // `: ping` heartbeats keep proxies from closing an idle stream.
      if (line.startsWith(":") || line.trim() === "") continue;
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice("data:".length).replace(/^ /, ""));
      }
    }

    if (data.length > 0) events.push({ event, data: data.join("\n") });
  }

  return { events, rest };
}
