import { describe, expect, it } from 'vitest';
import { allowedProjects } from '../../seed/seed';

describe('seed allowlist', () => {
  it('is empty when SEED_ALLOWED_PROJECTS is unset', () => {
    expect(allowedProjects({})).toEqual([]);
  });

  it('parses a comma-separated list and trims blanks', () => {
    expect(allowedProjects({ SEED_ALLOWED_PROJECTS: ' proj-a, proj-b ,,' })).toEqual(['proj-a', 'proj-b']);
  });
});
