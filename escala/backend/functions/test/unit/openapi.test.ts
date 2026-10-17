import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ROUTES } from '../../src/http/router';

const spec = parse(readFileSync(join(__dirname, '../../src/http/openapi.yaml'), 'utf8')) as any;

const operations = (): Array<{ method: string; path: string; operationId: string; description: string }> =>
  Object.entries(spec.paths).flatMap(([path, item]: [string, any]) =>
    Object.entries(item).map(([method, op]: [string, any]) => ({ method: method.toUpperCase(), path, operationId: op.operationId, description: op.description })),
  );

describe('CUJ-19 OpenAPI schema vs router', () => {
  it('lists exactly the CES-facing router operations (listScenarios excluded)', () => {
    const fromRouter = ROUTES.filter((r) => r.ces).map((r) => `${r.method} ${r.path} ${r.operationId}`).sort();
    const fromSpec = operations().map((o) => `${o.method} ${o.path} ${o.operationId}`).sort();
    expect(fromSpec).toEqual(fromRouter);
    expect(fromSpec.some((x) => x.includes('/scenarios') || x.includes('listScenarios'))).toBe(false);
  });

  it('has unique operationIds and a rich description on every operation and parameter', () => {
    const ops = operations();
    expect(new Set(ops.map((o) => o.operationId)).size).toBe(ops.length);
    for (const op of ops) expect(op.description.length, op.operationId).toBeGreaterThan(200);
    for (const item of Object.values<any>(spec.paths))
      for (const op of Object.values<any>(item)) for (const p of op.parameters ?? []) expect(p.description, p.name).toBeTruthy();
  });

  it('is OpenAPI 3.0 and every $ref resolves', () => {
    expect(spec.openapi).toMatch(/^3\.0\./);
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1].split('/'));
    for (const ref of refs) expect(ref.reduce((node: any, key) => node?.[key], spec), ref.join('/')).toBeDefined();
  });
});
