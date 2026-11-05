/**
 * Pyx design system, ink ground, white type, calm signal colours (mint pass,
 * coral leak, amber blocked) and quiet glass surfaces, matching the website. Single source of truth: embedded in HTML reports and copied to
 * the website (`apps/web/assets/theme.css`) by scripts/build-site.mjs.
 *
 * Reports must stay self-contained, so this file uses system font stacks; the website
 * layers self-hosted faces on top through the --rp-font-* tokens.
 */

/** Pyx mark: a sealed box holding a verified coin (the Trial of the Pyx). */
export const LOGO_SVG = `<svg class="rp-logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="3.75" y="3.75" width="24.5" height="24.5" rx="8.25" fill="rgba(255,255,255,.12)" stroke="rgba(255,255,255,.75)" stroke-width="1.5"/><circle cx="16" cy="16" r="6.4" fill="#fff"/><path d="M13.4 16.2l1.8 1.8 3.4-3.6" stroke="#0a0c12" stroke-width="1.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export const THEME_CSS = String.raw`
:root {
  color-scheme: dark;
  --rp-bg: #07080c;
  --rp-bg-2: #0b0d13;
  --rp-panel: #121520;
  --rp-ink: #f4f6fb;
  --rp-ink-2: #b4bccb;
  --rp-ink-3: #7c8496;
  --rp-line: rgba(255, 255, 255, 0.09);
  --rp-line-strong: rgba(255, 255, 255, 0.17);
  --rp-accent: #c9d2e4;
  --rp-accent-hi: #ffffff;
  --rp-accent-lo: #8e97ab;
  --rp-pass: #5fe0b0;
  --rp-fail: #ff6a5c;
  --rp-block: #ffc457;
  --rp-na: #8e97ab;
  --rp-glass: rgba(24, 28, 40, 0.55);
  --rp-glass-solid: #151926;
  --rp-radius: 18px;
  --rp-radius-sm: 12px;
  --rp-shadow: 0 40px 90px -40px rgba(0, 0, 0, 0.85), 0 1px 0 rgba(0, 0, 0, 0.4);
  --rp-font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  --rp-font-display: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  --rp-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  /* Back-compat aliases used by earlier markup. */
  --rp-cyan: var(--rp-accent);
}

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body.rp {
  margin: 0;
  min-height: 100vh;
  font-family: var(--rp-font);
  font-size: 15px;
  line-height: 1.6;
  color: var(--rp-ink);
  background-color: var(--rp-bg);
  background-image:
    radial-gradient(1000px 640px at 0% -10%, rgba(255, 112, 104, 0.12), transparent 62%),
    radial-gradient(1000px 640px at 100% -6%, rgba(96, 140, 255, 0.14), transparent 62%),
    radial-gradient(900px 600px at 90% 110%, rgba(64, 214, 178, 0.08), transparent 60%),
    linear-gradient(180deg, var(--rp-bg) 0%, var(--rp-bg-2) 100%);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  font-feature-settings: "ss01", "cv11";
}
/* Film grain instead of a grid: reads as material, not as a template. */
body.rp::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.05;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
body.rp > * { position: relative; z-index: 1; }

a { color: var(--rp-accent-hi); text-decoration: none; }
a:hover { text-decoration: underline; text-decoration-color: var(--rp-accent-lo); text-underline-offset: 4px; }
:focus-visible { outline: 1.5px solid var(--rp-accent); outline-offset: 3px; border-radius: 4px; }
::selection { background: rgba(201, 179, 138, 0.28); color: var(--rp-ink); }

.rp-wrap { width: min(1160px, 100% - 40px); margin-inline: auto; }
.rp-mono { font-family: var(--rp-mono); font-size: 0.86em; letter-spacing: 0; }
.rp-muted { color: var(--rp-ink-2); }
.rp-faint { color: var(--rp-ink-3); }
.rp-eyebrow {
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--rp-accent);
}
.rp-h1 { font-family: var(--rp-font-display); font-size: clamp(32px, 4.6vw, 58px); line-height: 1.02; letter-spacing: -0.035em; font-weight: 700; margin: 0; text-wrap: balance; }
.rp-h2 { font-family: var(--rp-font-display); font-size: clamp(26px, 3vw, 40px); line-height: 1.1; letter-spacing: -0.03em; font-weight: 700; margin: 0; text-wrap: balance; }
.rp-h3 { font-size: 16.5px; letter-spacing: -0.005em; font-weight: 600; margin: 0; }
/* Kept for compatibility: no gradient text in this system. */
.rp-gradient-text { color: var(--rp-ink); }

/* ---------- Glass: quiet, warm, refractive rim ---------- */
.rp-glass {
  position: relative;
  border-radius: var(--rp-radius);
  background:
    linear-gradient(180deg, rgba(236, 230, 219, 0.045), rgba(236, 230, 219, 0.012) 38%, rgba(236, 230, 219, 0.02)),
    var(--rp-glass);
  border: 1px solid var(--rp-line);
  box-shadow:
    inset 0 1px 0 rgba(255, 248, 235, 0.08),
    inset 0 -1px 0 rgba(0, 0, 0, 0.35),
    var(--rp-shadow);
  -webkit-backdrop-filter: blur(24px) saturate(140%);
          backdrop-filter: blur(24px) saturate(140%);
  isolation: isolate;
}
.rp-glass::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: -1;
  background: radial-gradient(420px 220px at var(--mx, 20%) var(--my, -20%), rgba(255, 244, 222, 0.07), transparent 70%);
  transition: background 0.2s;
}
.rp-glass::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  pointer-events: none;
  background: linear-gradient(170deg, rgba(255, 245, 225, 0.22), rgba(255, 245, 225, 0.02) 30%, rgba(201, 179, 138, 0.06) 75%, rgba(201, 179, 138, 0.16));
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
          mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
.rp-glass--strong { background: linear-gradient(180deg, rgba(236, 230, 219, 0.06), rgba(236, 230, 219, 0.015)), rgba(18, 20, 23, 0.72); }
.rp-pad { padding: 30px; }
.rp-pad-sm { padding: 18px 20px; }

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .rp-glass { background: var(--rp-glass-solid); }
}
@media (prefers-reduced-transparency: reduce) {
  .rp-glass { background: var(--rp-glass-solid); -webkit-backdrop-filter: none; backdrop-filter: none; }
  .rp-glass::before, .rp-glass::after { display: none; }
}

/* ---------- Status ---------- */
.rp-pill {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 3px 10px 3px 9px; border-radius: 6px;
  font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase;
  border: 1px solid color-mix(in srgb, currentColor 35%, transparent); white-space: nowrap;
  background: color-mix(in srgb, currentColor 8%, transparent);
}
.rp-pill::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.rp-pass { color: var(--rp-pass); }
.rp-fail { color: var(--rp-fail); }
.rp-blocked { color: var(--rp-block); }
.rp-na { color: var(--rp-na); }

.rp-verdict { display: flex; align-items: center; gap: 18px; }
.rp-verdict__orb {
  width: 58px; height: 58px; border-radius: 50%; flex: none;
  display: grid; place-items: center;
  border: 1px solid color-mix(in srgb, currentColor 55%, transparent);
  background: radial-gradient(circle at 50% 35%, color-mix(in srgb, currentColor 22%, transparent), transparent 70%);
  box-shadow: inset 0 0 0 6px color-mix(in srgb, currentColor 7%, transparent);
}
.rp-verdict__orb svg { width: 24px; height: 24px; color: currentColor; }

/* ---------- Layout helpers ---------- */
.rp-grid { display: grid; gap: 18px; }
.rp-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rp-grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.rp-grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 860px) { .rp-grid-3, .rp-grid-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .rp-grid-2, .rp-grid-3 { grid-template-columns: 1fr; } }
.rp-stack > * + * { margin-top: 14px; }
.rp-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.rp-spread { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }

.rp-kv { display: grid; grid-template-columns: max-content 1fr; gap: 9px 22px; margin: 0; font-size: 14px; }
.rp-kv dt { color: var(--rp-ink-3); }
.rp-kv dd { margin: 0; color: var(--rp-ink); overflow-wrap: anywhere; }

.rp-stat__n { font-family: var(--rp-font-display); font-size: 40px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; font-variant-numeric: tabular-nums lining-nums; }
.rp-stat__l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--rp-ink-3); margin-top: 8px; }

/* ---------- Tables ---------- */
.rp-table-wrap { overflow-x: auto; }
.rp-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.rp-table th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--rp-ink-3); padding: 0 14px 14px; }
.rp-table td { padding: 16px 14px; border-top: 1px solid var(--rp-line); vertical-align: top; }

/* ---------- Matrix ---------- */
.rp-matrix { display: grid; gap: 10px; }
.rp-matrix__head { font-size: 11px; color: var(--rp-ink-3); text-transform: uppercase; letter-spacing: 0.16em; align-self: end; padding: 0 4px 4px; }
.rp-cell {
  border-radius: 12px; padding: 14px 16px; min-height: 88px;
  border: 1px solid var(--rp-line);
  background: rgba(236, 230, 219, 0.02);
  display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start; gap: 10px;
}
.rp-cell--pass { border-color: color-mix(in srgb, var(--rp-pass) 26%, transparent); }
.rp-cell--fail { border-color: color-mix(in srgb, var(--rp-fail) 55%, transparent); background: color-mix(in srgb, var(--rp-fail) 7%, transparent); }
.rp-cell--blocked { border-color: color-mix(in srgb, var(--rp-block) 40%, transparent); }
.rp-cell__exp { font-size: 12.5px; color: var(--rp-ink-2); }
.rp-actor { font-weight: 600; font-size: 14px; align-self: center; }
.rp-actor small { display: block; font-weight: 400; color: var(--rp-ink-3); font-size: 12px; }

/* ---------- Buttons ---------- */
.rp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  padding: 13px 22px; border-radius: 10px; font-weight: 550; font-size: 14.5px; letter-spacing: 0.005em;
  color: var(--rp-ink); text-decoration: none; cursor: pointer;
  border: 1px solid var(--rp-line-strong);
  background: rgba(236, 230, 219, 0.03);
  transition: border-color 0.3s ease, background 0.3s ease, color 0.3s ease, transform 0.3s cubic-bezier(.2,.7,.2,1);
}
.rp-btn:hover { text-decoration: none; border-color: rgba(236, 230, 219, 0.34); background: rgba(236, 230, 219, 0.06); }
.rp-btn--primary {
  color: #0a0c12;
  border-color: transparent;
  background: linear-gradient(180deg, #ffffff 0%, #e7eaf2 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), inset 0 -1px 0 rgba(0, 0, 0, 0.18), 0 10px 30px -14px rgba(201, 179, 138, 0.55);
}
.rp-btn--primary:hover { color: #0a0c12; background: linear-gradient(180deg, #ffffff 0%, #f0f2f7 100%); }

.rp-logo { width: 26px; height: 26px; flex: none; }
.rp-brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 700; letter-spacing: -0.03em; font-size: 19px; color: var(--rp-ink); }
.rp-brand:hover { text-decoration: none; }

.rp-code {
  font-family: var(--rp-mono); font-size: 13px; line-height: 1.75;
  padding: 18px 20px; margin: 0; overflow-x: auto; color: var(--rp-ink-2);
  border-radius: var(--rp-radius-sm); background: rgba(0, 0, 0, 0.35); border: 1px solid var(--rp-line);
}
.rp-divider { height: 1px; background: var(--rp-line-strong); border: 0; margin: 28px 0; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}

/* ---------- Print: clean, ink-friendly evidence ---------- */
@media print {
  body.rp { background: #fff !important; color: #14120e; font-size: 12px; }
  body.rp::before { display: none; }
  .rp-glass { background: #fff !important; box-shadow: none !important; border: 1px solid #d6d0c4 !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; break-inside: avoid; }
  .rp-glass::before, .rp-glass::after { display: none; }
  .rp-muted, .rp-kv dt, .rp-faint, .rp-table th { color: #57524a !important; }
  .rp-eyebrow { color: #7a6744 !important; }
  .rp-pass { color: #2f6b52; } .rp-fail { color: #b3261e; } .rp-blocked { color: #8a5a00; } .rp-na { color: #57524a; }
  .rp-cell { background: #fff !important; }
  .rp-noprint { display: none !important; }
  a { color: #14120e; }
}
`;
