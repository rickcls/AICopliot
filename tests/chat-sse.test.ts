import { describe, expect, it } from "vitest";
import { parseSseChunk } from "@/lib/chat/sse";

/**
 * The answer stream is read through a fetch body reader, so the client sees
 * arbitrary byte boundaries rather than whole frames.
 */

describe("parseSseChunk", () => {
  it("reads a complete frame", () => {
    const { events, rest } = parseSseChunk('event: progress\ndata: {"phase":"reasoning"}\n\n');

    expect(events).toEqual([{ event: "progress", data: '{"phase":"reasoning"}' }]);
    expect(rest).toBe("");
  });

  it("holds a partial frame back until the rest arrives", () => {
    const first = parseSseChunk('event: progress\ndata: {"phase":"ret');
    expect(first.events).toEqual([]);

    const second = parseSseChunk(`${first.rest}rieving"}\n\n`);
    expect(second.events).toEqual([
      { event: "progress", data: '{"phase":"retrieving"}' },
    ]);
    expect(second.rest).toBe("");
  });

  it("reads two frames delivered in one chunk", () => {
    const { events } = parseSseChunk(
      "event: progress\ndata: 1\n\nevent: result\ndata: 2\n\n",
    );

    expect(events).toEqual([
      { event: "progress", data: "1" },
      { event: "result", data: "2" },
    ]);
  });

  it("ignores a heartbeat comment", () => {
    const { events } = parseSseChunk(": ping\n\nevent: result\ndata: 1\n\n");

    expect(events).toEqual([{ event: "result", data: "1" }]);
  });

  it("joins repeated data lines with a newline", () => {
    const { events } = parseSseChunk("event: error\ndata: line one\ndata: line two\n\n");

    expect(events[0].data).toBe("line one\nline two");
  });

  it("defaults an unnamed frame to the message event", () => {
    const { events } = parseSseChunk("data: bare\n\n");

    expect(events).toEqual([{ event: "message", data: "bare" }]);
  });
});
