import { describe, it, expect } from 'vitest';
import {
  buildDetectionProfile,
  allBuiltinProfiles,
  CARBON_PROFILE,
  MUI_PROFILE,
  emptyProfile,
} from '../src/profiles';
import { checkDriftFull, checkInlineDrift } from '../src/parser';
import { parseConfig } from '../src/config';

describe('buildDetectionProfile — built-in matching', () => {
  it('@carbon/* packages pull in the Carbon profile only', () => {
    const p = buildDetectionProfile(['@carbon/react', '@carbon/icons-react']);
    expect(p.tokens['#0f62fe']).toBeDefined(); // Carbon interactive blue
    expect(p.tokens['#1976d2']).toBeUndefined(); // MUI primary.main NOT included
    expect(p.propSignatures['Modal']).toBeDefined();
    expect(p.propSignatures['MuiChip']).toBeUndefined();
  });

  it('@mui/* packages pull in the MUI profile only', () => {
    const p = buildDetectionProfile(['@mui/material']);
    expect(p.tokens['#1976d2']).toBeDefined();
    expect(p.tokens['#0f62fe']).toBeUndefined();
    expect(p.subComponentMap['CardMedia']).toBe('MuiCard');
    expect(p.subComponentMap['ModalBody']).toBeUndefined();
  });

  it('both configured → both profiles merged', () => {
    const p = buildDetectionProfile(['@carbon/react', '@mui/material']);
    expect(p.tokens['#0f62fe']).toBeDefined();
    expect(p.tokens['#1976d2']).toBeDefined();
  });

  it('unknown package → empty profile', () => {
    const p = buildDetectionProfile(['@acme/design-system']);
    expect(p).toEqual(emptyProfile());
  });

  it('allBuiltinProfiles is the union of every built-in', () => {
    const all = allBuiltinProfiles();
    for (const key of Object.keys(CARBON_PROFILE.propSignatures)) {
      expect(all.propSignatures[key]).toBeDefined();
    }
    for (const key of Object.keys(MUI_PROFILE.propSignatures)) {
      expect(all.propSignatures[key]).toBeDefined();
    }
  });
});

describe('buildDetectionProfile — custom detection data', () => {
  const CUSTOM = {
    tokens: { '#FF3366': 'brand/coral' }, // uppercase on purpose
    classPrefixes: ['acme--'],
    propSignatures: { AcmeModal: ['open', 'onClose', 'heading'] },
    subComponents: { AcmeCardBody: 'AcmeCard' },
    nameSegments: { Acme: 'AcmeCard' },
  };

  it('custom data lands in the profile even with an unknown component_library', () => {
    const p = buildDetectionProfile(['@acme/design-system'], CUSTOM);
    expect(p.propSignatures['AcmeModal']).toEqual(['open', 'onClose', 'heading']);
    expect(p.subComponentMap['AcmeCardBody']).toBe('AcmeCard');
    expect(p.classPatterns).toHaveLength(1);
  });

  it('custom tokens power token-fingerprint detection end to end', () => {
    const content = `
      export function Promo() {
        return <div className="acme--card" style={{ color: '#ff3366' }} />;
      }
    `;
    const profile = buildDetectionProfile(['@acme/design-system'], CUSTOM);
    const result = checkDriftFull(content, new Set(), ['@acme/design-system'], [], 'Promo.tsx', profile);
    expect(result.inlineDrift.tokenFingerprints).toHaveLength(1);
    expect(result.inlineDrift.tokenFingerprints[0].tokens).toContain('#ff3366');
    expect(result.inlineDrift.tokenFingerprints[0].classNames).toContain('acme--card');
  });

  it('custom prop signatures power prop-match detection', () => {
    const content = `
      export function QuickModal({ open, onClose, heading }: Props) {
        return <div>{heading}</div>;
      }
    `;
    const profile = buildDetectionProfile([], CUSTOM);
    const result = checkInlineDrift(content, new Set(), 'QuickModal.tsx', profile);
    expect(result.propMatches).toHaveLength(1);
    expect(result.propMatches[0].matchedDs).toBe('AcmeModal');
  });

  it('custom sub-components + name segments power subcomponent detection', () => {
    const content = `
      export function AcmeProductCard() {
        return <div><AcmeCardBody /></div>;
      }
    `;
    const profile = buildDetectionProfile([], CUSTOM);
    const result = checkInlineDrift(content, new Set(), 'Card.tsx', profile);
    expect(result.subComponentMatches).toHaveLength(1);
    expect(result.subComponentMatches[0].matchedDs).toBe('AcmeCard');
    expect(result.subComponentMatches[0].confidence).toBe('high'); // name segment matched too
  });

  it('sub-component next to its real parent is still legitimate composition', () => {
    const content = `
      export function Wrapper() {
        return <AcmeCard><AcmeCardBody /></AcmeCard>;
      }
    `;
    const profile = buildDetectionProfile([], CUSTOM);
    const result = checkInlineDrift(content, new Set(), 'Wrapper.tsx', profile);
    expect(result.subComponentMatches).toHaveLength(0);
  });

  it('regex specials in a class prefix are escaped, not interpreted', () => {
    const profile = buildDetectionProfile([], { classPrefixes: ['acme.btn'] });
    expect(profile.classPatterns[0].test('acme.btn-primary')).toBe(true);
    profile.classPatterns[0].lastIndex = 0;
    expect(profile.classPatterns[0].test('acmeXbtn-primary')).toBe(false);
  });
});

describe('.polder.yml custom detection keys', () => {
  const BASE = 'component_library: "@acme/ds"\n';

  it('parses all five custom keys, lowercasing token hexes', () => {
    const cfg = parseConfig(
      BASE +
        'tokens:\n  "#FF3366": brand/coral\n' +
        'class_prefixes: ["acme--"]\n' +
        'prop_signatures:\n  AcmeModal: [open, onClose]\n' +
        'sub_components:\n  AcmeCardBody: AcmeCard\n' +
        'name_segments:\n  Acme: AcmeCard\n',
    );
    expect(cfg.tokens).toEqual({ '#ff3366': 'brand/coral' });
    expect(cfg.classPrefixes).toEqual(['acme--']);
    expect(cfg.propSignatures).toEqual({ AcmeModal: ['open', 'onClose'] });
    expect(cfg.subComponents).toEqual({ AcmeCardBody: 'AcmeCard' });
    expect(cfg.nameSegments).toEqual({ Acme: 'AcmeCard' });
  });

  it('all custom keys are optional', () => {
    const cfg = parseConfig(BASE);
    expect(cfg.tokens).toBeUndefined();
    expect(cfg.classPrefixes).toBeUndefined();
  });

  it('rejects non-hex token keys', () => {
    expect(() => parseConfig(BASE + 'tokens:\n  "red": brand\n')).toThrow('hex colors');
    expect(() => parseConfig(BASE + 'tokens:\n  "#fff": brand\n')).toThrow('hex colors');
  });

  it('rejects non-string token values and malformed maps', () => {
    expect(() => parseConfig(BASE + 'tokens:\n  "#ff3366": 3\n')).toThrow('must be a string');
    expect(() => parseConfig(BASE + 'tokens: [a, b]\n')).toThrow('mapping');
  });

  it('rejects empty or non-string class prefixes', () => {
    expect(() => parseConfig(BASE + 'class_prefixes: ["ok", ""]\n')).toThrow('non-empty strings');
    expect(() => parseConfig(BASE + 'class_prefixes: "acme--"\n')).toThrow('non-empty strings');
  });

  it('rejects prop signatures that can never match', () => {
    expect(() => parseConfig(BASE + 'prop_signatures:\n  X: [only]\n')).toThrow('at least 2');
    expect(() => parseConfig(BASE + 'prop_signatures:\n  X: nope\n')).toThrow('array of prop names');
  });

  it('rejects non-string sub_components / name_segments values', () => {
    expect(() => parseConfig(BASE + 'sub_components:\n  A: 1\n')).toThrow('must be a string');
    expect(() => parseConfig(BASE + 'name_segments:\n  A: [x]\n')).toThrow('must be a string');
  });
});
