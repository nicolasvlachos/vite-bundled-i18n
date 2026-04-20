import { describe, it, expect } from 'vitest';
import { resolveRequestInit } from '../../core/createI18n';

describe('resolveRequestInit', () => {
  it('returns undefined when config has no requestInit', async () => {
    const result = await resolveRequestInit(undefined);
    expect(result).toBeUndefined();
  });

  it('returns static RequestInit as-is', async () => {
    const init = { credentials: 'include' as RequestCredentials };
    const result = await resolveRequestInit(init);
    expect(result).toEqual({ credentials: 'include' });
  });

  it('calls sync function and returns result', async () => {
    const fn = () => ({ headers: { 'X-Token': 'abc' } });
    const result = await resolveRequestInit(fn);
    expect(result).toEqual({ headers: { 'X-Token': 'abc' } });
  });

  it('calls async function and returns result', async () => {
    const fn = async () => ({ headers: { Authorization: 'Bearer fresh' } });
    const result = await resolveRequestInit(fn);
    expect(result).toEqual({ headers: { Authorization: 'Bearer fresh' } });
  });
});
