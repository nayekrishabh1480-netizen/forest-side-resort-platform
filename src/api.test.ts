import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from './api';

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
