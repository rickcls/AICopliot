/**
 * Ways a draft leaves the app — all of them opened by the person, none of them
 * sending anything. A compose link fills Gmail's own compose window; mailto:
 * fills whatever mail client the device uses.
 */

const EMAIL = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;

/** Only a real address goes in "to"; a name like "Peter" would be a broken recipient. */
export function recipientAddress(recipient: string | null | undefined): string | null {
  const value = recipient?.trim() ?? "";
  return EMAIL.test(value) ? value : null;
}

export function gmailComposeUrl(draft: { to: string | null; subject: string; body: string }): string {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (draft.to) params.set("to", draft.to);
  params.set("su", draft.subject);
  params.set("body", draft.body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function mailtoUrl(draft: { to: string | null; subject: string; body: string }): string {
  // encodeURIComponent, not URLSearchParams: mail clients read "+" literally.
  return `mailto:${draft.to ? encodeURIComponent(draft.to) : ""}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
}
