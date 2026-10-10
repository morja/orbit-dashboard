/* Independent text scaling, whole-interface zoom and palette-aware contrast. */
const contrastTokens = ['--text', '--muted', '--faint', '--line', '--line-soft', '--line-strong',
  '--accent-text', '--grey-text', '--blue-text', '--amber-text', '--red-text'];

export function applyReadability(config) {
  const root = document.documentElement;
  root.dataset.density = config.density === "comfortable" ? "comfortable" : "compact";
  const bounded = (key, min, max) => Math.min(max, Math.max(min, Number(config[key]) || 100));
  root.style.setProperty('--font-scale', bounded('font_size', 80, 160) / 100);
  root.style.setProperty('--ui-zoom', bounded('zoom', 70, 200) / 100);

  // Read the active palette afresh, without mixing an earlier preview into itself.
  for (const token of contrastTokens) root.style.removeProperty(token);
  const strength = (bounded('contrast', 100, 200) - 100) / 100;
  if (!strength) return;
  const palette = getComputedStyle(root);
  const ink = palette.getPropertyValue('--ink').trim();
  const originals = contrastTokens.map(token => [token, palette.getPropertyValue(token).trim()]);
  for (const [token, original] of originals) {
    if (!original) continue;
    const amount = strength * (token.startsWith('--line') ? 35 : token === '--faint' ? 75 : 55);
    root.style.setProperty(token, `color-mix(in srgb, ${original} ${100 - amount}%, ${ink})`);
  }
}
