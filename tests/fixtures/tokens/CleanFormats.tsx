// Same notations as DriftedFormats.tsx, but none of the values are in the profile, so
// nothing may fire.

export function Hex3Badge() {
  return <span style={{ color: '#0af' }}>Sale</span>;
}

export function Hex8Button() {
  return <button style={{ background: '#12345680' }}>Buy</button>;
}

export function RgbTile() {
  return <div style={{ borderColor: 'rgb(1, 2, 3)' }} />;
}

export function RgbaModernTile() {
  return <div style={{ background: 'rgba(10 20 30 / 0.4)' }} />;
}

export function HslLabel() {
  return <label style={{ color: 'hsl(120, 50%, 40%)' }}>Name</label>;
}

export function VarLink() {
  return <a style={{ color: 'var(--other-color-interactive)' }}>Docs</a>;
}

export function VarOnlyDefinedHere() {
  return <a style={{ ['--ds-color-interactive' as string]: 'blue' }}>Docs</a>;
}

export function TailwindArbitrary() {
  return <div className="bg-[#123456] p-4" />;
}

export function TailwindUtility() {
  return <div className="p-4 hover:bg-neutral-500 xbg-brand-500 text-primary" />;
}
