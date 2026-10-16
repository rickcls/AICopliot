import { intlLocale, type Locale } from "@/lib/i18n/locales";
import type { en } from "@/lib/i18n/dictionaries/en";

/**
 * A message that changes with a count. Only `one` and `other` are modelled:
 * Chinese has no grammatical plural (`Intl.PluralRules` says "other" for every
 * count), and English needs exactly these two. Anything other than "one" reads
 * `other`.
 */
export interface PluralMessage {
  one: string;
  other: string;
}

type Widen<T> = T extends string
  ? string
  : { -readonly [K in keyof T]: Widen<T[K]> };

/**
 * The English dictionary is the source of truth for keys. Every other
 * dictionary is checked against this widened shape with `satisfies`, so a
 * missing or misspelt key fails the type-check instead of rendering a key.
 */
export type Dictionary = Widen<typeof en>;

type Join<P extends string, K extends string> = P extends "" ? K : `${P}.${K}`;

type Paths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? Join<P, K>
    : T[K] extends PluralMessage
      ? Join<P, K>
      : Paths<T[K], Join<P, K>>;
}[keyof T & string];

/** Every dotted key with a message at the end of it, e.g. `nav.today`. */
export type MessageKey = Paths<typeof en>;

export type MessageVars = Record<string, string | number>;

export type Translate = (key: MessageKey, vars?: MessageVars) => string;

function lookup(dictionary: unknown, key: string): string | PluralMessage | undefined {
  let node: unknown = dictionary;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "string") return node;
  if (
    node !== null &&
    typeof node === "object" &&
    typeof (node as PluralMessage).one === "string" &&
    typeof (node as PluralMessage).other === "string"
  ) {
    return node as PluralMessage;
  }
  return undefined;
}

function interpolate(template: string, vars: MessageVars | undefined): string {
  if (!vars) return template;
  // An unknown placeholder is left visible rather than blanked, so a missing
  // variable shows up in review instead of producing a silently shorter line.
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Builds `t(key, vars)` for one locale. A key missing from `dictionary` falls
 * back to `fallback` (English); a key missing from both renders as the key
 * itself, which is visible in review rather than an empty string.
 */
export function createTranslator(
  locale: Locale,
  dictionary: Dictionary,
  fallback: Dictionary,
): Translate {
  const plurals = new Intl.PluralRules(intlLocale(locale));

  return (key, vars) => {
    const message = lookup(dictionary, key) ?? lookup(fallback, key);
    if (message === undefined) return key;
    if (typeof message === "string") return interpolate(message, vars);

    const count = Number(vars?.count ?? 0);
    const form = plurals.select(count) === "one" ? message.one : message.other;
    return interpolate(form, vars);
  };
}
