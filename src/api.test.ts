import { describe, expect, it } from 'vitest';
import { resolveApiBase, safeExternalUrl } from './api';

describe('resolveApiBase', () => {
  it('adds the versioned API prefix to a Render service origin', () => {
    expect(resolveApiBase('https://forest-api.onrender.com')).toBe('https://forest-api.onrender.com/api/v1');
  });

  it('preserves a complete versioned base URL', () => {
    expect(resolveApiBase('https://forest-api.onrender.com/api/v1/')).toBe('https://forest-api.onrender.com/api/v1');
  });

  it('uses the local API default when no value is supplied', () => {
    expect(resolveApiBase()).toBe('http://localhost:4000/api/v1');
  });
});

describe('safeExternalUrl', () => {
  const fallback = 'https://maps.google.com/?q=Guptkashi';

  it('allows HTTPS map destinations', () => {
    expect(safeExternalUrl('https://maps.google.com/?q=Guptkashi', fallback)).toBe('https://maps.google.com/?q=Guptkashi');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.com', 'https://user:pass@example.com', null, 'not a URL'])(
    'uses the safe fallback for unsupported URL %s', (input) => {
      expect(safeExternalUrl(input, fallback)).toBe(fallback);
    },
  );
});
