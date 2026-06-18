import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectComponentLibrary } from '../src/detect';
import { resolveConfig } from '../src/resolve-config';
import { runInitSubcommand } from '../src/commands/init';

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polder-detect-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

describe('detectComponentLibrary', () => {
  it('detects a single known DS from dependencies', () => {
    const dir = tmp({ 'package.json': JSON.stringify({ dependencies: { '@carbon/react': '1' } }) });
    expect(detectComponentLibrary(dir)).toEqual({ libraries: ['@carbon/react'], source: 'detected' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('detects multiple and reads peerDependencies too', () => {
    const dir = tmp({
      'package.json': JSON.stringify({ dependencies: { antd: '5' }, peerDependencies: { '@mui/material': '5' } }),
    });
    expect(detectComponentLibrary(dir).libraries.sort()).toEqual(['@mui/material', 'antd']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns none when no known DS present', () => {
    const dir = tmp({ 'package.json': JSON.stringify({ dependencies: { lodash: '4' } }) });
    expect(detectComponentLibrary(dir)).toEqual({ libraries: [], source: 'none' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns none when package.json is missing or unparseable', () => {
    const dir = tmp({});
    expect(detectComponentLibrary(dir).source).toBe('none');
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not json');
    expect(detectComponentLibrary(dir).source).toBe('none');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('resolveConfig precedence', () => {
  it('an explicit .polder.yml wins over detection', () => {
    const dir = tmp({
      '.polder.yml': 'component_library: "@acme/ds"\n',
      'package.json': JSON.stringify({ dependencies: { '@mui/material': '5' } }),
    });
    const r = resolveConfig(dir, path.join(dir, '.polder.yml'));
    expect(r).toEqual({ config: { componentLibrary: ['@acme/ds'], allowlist: [], failOnDrift: false }, source: 'file' });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to detection when no .polder.yml', () => {
    const dir = tmp({ 'package.json': JSON.stringify({ dependencies: { '@carbon/react': '1' } }) });
    const r = resolveConfig(dir, path.join(dir, '.polder.yml'));
    expect(r?.source).toBe('detected');
    expect(r?.config.componentLibrary).toEqual(['@carbon/react']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null when neither file nor detection', () => {
    const dir = tmp({ 'package.json': JSON.stringify({ dependencies: {} }) });
    expect(resolveConfig(dir, path.join(dir, '.polder.yml'))).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('throws on an invalid .polder.yml (does not silently fall back)', () => {
    const dir = tmp({ '.polder.yml': 'this: : : not valid yaml: [' });
    expect(() => resolveConfig(dir, path.join(dir, '.polder.yml'))).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('init', () => {
  it('writes a .polder.yml seeded from detection', () => {
    const dir = tmp({ 'package.json': JSON.stringify({ dependencies: { '@carbon/react': '1' } }) });
    expect(runInitSubcommand([], dir)).toBe(0);
    expect(fs.readFileSync(path.join(dir, '.polder.yml'), 'utf8')).toContain('component_library: "@carbon/react"');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to overwrite an existing .polder.yml', () => {
    const dir = tmp({ '.polder.yml': 'component_library: "@acme/ds"\n' });
    expect(runInitSubcommand([], dir)).toBe(1);
    expect(fs.readFileSync(path.join(dir, '.polder.yml'), 'utf8')).toContain('@acme/ds');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to a placeholder when nothing detected', () => {
    const dir = tmp({ 'package.json': JSON.stringify({ dependencies: {} }) });
    expect(runInitSubcommand([], dir)).toBe(0);
    expect(fs.readFileSync(path.join(dir, '.polder.yml'), 'utf8')).toContain('@your-org/design-system');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
