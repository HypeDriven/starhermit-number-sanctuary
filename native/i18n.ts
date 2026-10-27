// Localization: the browser build's i18n.js tables (lang/strings.js, keyed
// strings, the nine StarHermit locales) in the interface language the runtime
// reports (preferences().language: the player's choice in Options › Language,
// else the account's preferred language or the device's). The runtime's
// Options replace the game's own Language setting (sh-language.js) and the
// DOM re-labelling: every string is drawn through T() each frame, so a change
// shows on the next frame.
import { onPreferencesChange, preferences } from "starhermit:engine";
import * as ui from "starhermit:ui";
import { LOCALES, TABLE } from "../lang/strings.js";

const TABLES = TABLE as unknown as Record<string, Record<string, string>>;
export type Vars = Record<string, string | number>;
let locale = "en-US";

/** The supported locale for a language tag (exact, then the same language: es-MX → es-419, fr-BE → fr-FR). */
export function pickLocale(tag: string): string {
  const t = String(tag || "").toLowerCase().replace("_", "-");
  const exact = (LOCALES as string[]).find((l) => l.toLowerCase() === t);
  if (exact) return exact;
  const lang = t.split("-")[0];
  if (lang === "es") return t === "es" || t.startsWith("es-es") ? "es-ES" : "es-419";
  if (lang === "fr") return t.startsWith("fr-ca") ? "fr-CA" : "fr-FR";
  if (lang === "en") return t.startsWith("en-gb") || t.startsWith("en-ie") || t.startsWith("en-au") || t.startsWith("en-nz") ? "en-GB" : "en-US";
  return (LOCALES as string[]).find((l) => l.toLowerCase().split("-")[0] === lang) ?? "en-US";
}

/** A string key in the player's language (falling back to en-US, then the key); `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string {
  const own = TABLES[locale];
  let s = own && Object.prototype.hasOwnProperty.call(own, key) ? own[key]! : TABLES["en-US"]![key];
  if (s === undefined) s = key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}
export function currentLocale(): string { return locale; }

function apply(tag: string): void {
  locale = pickLocale(tag);
  ui.setLanguage(locale);
}
apply(preferences().language);
onPreferencesChange((p) => { if (pickLocale(p.language) !== locale) apply(p.language); });
