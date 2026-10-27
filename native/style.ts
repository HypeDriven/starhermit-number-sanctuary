// The look of the top bar, panels, overlays and dialogs: the browser build's
// style.css, rewritten class-based in tools/ui-style.css and converted once
// with `starhermit css` into assets/ui-style.json (`npm run css`), registered
// at start with the theme the runtime's own widgets take, in the old page's
// Arial (the sans-serif family). The focus ring is style.css's 3 px yellow
// button:focus-visible outline 2 px out.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({
    fontSize: 14, smallSize: 12, headingSize: 20, padding: 8, spacing: 8, radius: 6,
    text: "#e8edf2", muted: "#9aa7b4", panel: "#232b33", control: "#2d3742", hovered: "#3a4550",
    pressed: "#4a5763", field: "#2d3742", accent: "#c05621", focus: "#f6e05e", outline: "#3a4550",
  });
  ui.setTokens(css.tokens);
  ui.setAnimations(css.animations);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$text" } },
    paragraph: { text: { color: "$text" } },
    heading: { text: { color: "$text" } },
    widget: { focusRing: { color: "$focus", width: 3, offset: 2 } },
    // style.css .settings-backdrop / .settings-panel
    dialog: {
      background: "#141a20f7", border: { width: 1, color: "$line" }, radius: 10, padding: { top: 14, bottom: 14, start: 16, end: 16 },
      shadow: { x: 0, y: 12, blur: 40, color: "#00000080" }, parts: { backdrop: { background: "#080c1099" } },
    },
    scrollArea: { parts: { bar: { background: "#9aa7b466", radius: 4 } } },
  });
}
