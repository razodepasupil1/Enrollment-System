// Checks WCAG 2 contrast for the colour pairs the UI actually uses, in both themes.
// Run: node scripts/contrast.mjs   (exits 1 if any pair fails)
import fs from "node:fs";

const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const block = (re) => Object.fromEntries([...css.match(re)[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const themes = {
  light: block(/:root\s*{([\s\S]*?)\n}/),
  dark: { ...block(/:root\s*{([\s\S]*?)\n}/), ...block(/:root\[data-theme="dark"\]\s*{([\s\S]*?)\n}/) },
};

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

let failed = 0;
for (const [name, t] of Object.entries(themes)) {
  const text = [
    ["ink", "paper"], ["ink", "surface"], ["ink", "sunken"],
    ["muted", "paper"], ["muted", "surface"], ["muted", "sunken"],
    ["on-brand", "brand"], ["brand", "paper"], ["brand", "surface"],
    ["open", "open-bg"], ["almost", "almost-bg"], ["full", "full-bg"], ["wait", "wait-bg"],
    ["open", "surface"], ["almost", "surface"], ["full", "surface"], ["wait", "surface"],
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`c${i}-fg`, `c${i}-bg`]),
  ];
  const ui = [["focus", "paper"], ["focus", "surface"], ["brand", "surface"]];
  console.log(`\n${name} theme`);
  for (const [fg, bg, min] of [...text.map((p) => [...p, 4.5]), ...ui.map((p) => [...p, 3])]) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? "pass" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1  (need ${min})  ${fg} on ${bg}`);
  }
}
console.log(failed ? `\n${failed} pair(s) below the WCAG threshold` : "\nAll pairs meet WCAG AA in both themes.");
process.exit(failed ? 1 : 0);
