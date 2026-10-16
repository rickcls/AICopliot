import * as OpenCC from "opencc-js/cn2t";

/**
 * Converts any Simplified characters in model-written prose to Traditional,
 * Hong Kong standard. A prompt rule asks for Traditional; this makes it so.
 *
 * Apply it only to text the model wrote — titles, notes, descriptions — and
 * only after citations are checked. Never to a quote or excerpt: those must
 * stay the source's own characters, and `buildVerifiedExcerpt` matches them
 * against the stored text verbatim.
 */
let converter: ((text: string) => string) | null = null;

export function toTraditional(text: string): string {
  converter ??= OpenCC.Converter({ from: "cn", to: "hk" });
  return converter(text);
}
