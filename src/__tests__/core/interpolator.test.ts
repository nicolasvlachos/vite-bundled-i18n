import { describe, it, expect } from 'vitest';
import { interpolate } from '../../core/interpolator';

describe('interpolate', () => {
  it('returns the string unchanged when there are no placeholders', () => {
    expect(interpolate('Hello world', {})).toBe('Hello world');
  });

  it('replaces a single placeholder', () => {
    expect(interpolate('Hello {{name}}', { name: 'Alice' })).toBe('Hello Alice');
  });

  it('replaces multiple placeholders', () => {
    expect(
      interpolate('{{greeting}}, {{name}}!', { greeting: 'Hi', name: 'Bob' }),
    ).toBe('Hi, Bob!');
  });

  it('replaces the same placeholder used multiple times', () => {
    expect(interpolate('{{x}} + {{x}} = {{result}}', { x: 2, result: 4 })).toBe('2 + 2 = 4');
  });

  it('trims whitespace inside placeholders', () => {
    expect(interpolate('Hello {{ name }}', { name: 'Alice' })).toBe('Hello Alice');
  });

  it('leaves placeholders intact when the param is missing', () => {
    expect(interpolate('Hello {{name}}', {})).toBe('Hello {{name}}');
  });

  it('converts non-string values to strings', () => {
    expect(interpolate('Count: {{n}}', { n: 42 })).toBe('Count: 42');
    expect(interpolate('Active: {{flag}}', { flag: true })).toBe('Active: true');
  });

  it('returns the string unchanged when params is undefined', () => {
    expect(interpolate('Hello {{name}}')).toBe('Hello {{name}}');
  });

  it('returns the string unchanged when there are no params object', () => {
    expect(interpolate('No placeholders here')).toBe('No placeholders here');
  });

  it('handles empty string input', () => {
    expect(interpolate('', { name: 'Alice' })).toBe('');
  });
});
