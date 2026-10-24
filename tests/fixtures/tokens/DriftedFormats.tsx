// Each component hardcodes a design-system value in a different notation. Run with
// the profile in token-formats.test.ts: tokens #0f62fe / #da1e28, css_variables
// ["--ds-"], utility_classes ["bg-brand-*", "text-brand-*"].

export function Hex3Badge() {
  return <span style={{ color: '#f00' }}>Sale</span>;
}

export function Hex8Button() {
  return <button style={{ background: '#0f62fe80' }}>Buy</button>;
}

export function RgbTile() {
  return <div style={{ borderColor: 'rgb(15, 98, 254)' }} />;
}

export function RgbaModernTile() {
  return <div style={{ background: 'rgba(218 30 40 / 0.4)' }} />;
}

export function HslLabel() {
  return <label style={{ color: 'hsl(219, 99%, 53%)' }}>Name</label>;
}

export function VarLink() {
  return <a style={{ color: 'var(--ds-color-interactive)' }}>Docs</a>;
}

export function VarWithFallback() {
  return <a style={{ color: 'var(--ds-color-support-error, red)' }}>Docs</a>;
}

export function TailwindArbitrary() {
  return <div className="bg-[#0f62fe] p-4" />;
}

export function TailwindUtility() {
  return <div className="p-4 hover:bg-brand-500 text-brand-fg" />;
}
