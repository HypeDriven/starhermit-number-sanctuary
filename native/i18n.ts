// Localization: the engine's string tables (assets/strings.json, generated from
// the browser build's i18n.js tables: keyed strings, the nine StarHermit locales)
// in the interface language the runtime reports (the player's choice in Options ›
// Language, else the account's preferred language or the device's). The runtime's
// Options replace the game's own Language setting (sh-language.js) and the DOM
// re-labelling: every string is drawn through T() each frame, so a change shows on
// the next frame. Account lines are the engine's `starhermit.*` keys.
import { strings } from "starhermit:engine";
import * as ui from "starhermit:ui";

strings.load("assets/strings.json");
strings.defaultLocale = "en-US";
ui.setLanguage(strings.locale);
strings.onChange((locale) => ui.setLanguage(locale));

export type Vars = Record<string, string | number>;
/** A string key in the player's language; `{name}` placeholders from vars. */
export function T(key: string, vars?: Vars | null): string { return strings.t(String(key), vars ?? undefined); }
export function currentLocale(): string { return strings.locale; }
