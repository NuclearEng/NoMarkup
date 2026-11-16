import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetIdempotencyKeysForTests,
  clearIdempotencyKey,
  idempotencyHeader,
} from '@/lib/api';

describe('idempotencyHeader', () => {
  beforeEach(() => {
    __resetIdempotencyKeysForTests();
  });

  it('reuses the same key for the same logical operation', () => {
    const a = idempotencyHeader('order-pay:ord-1');
    const b = idempotencyHeader('order-pay:ord-1');
    expect(a['Idempotency-Key']).toBe(b['Idempotency-Key']);
    expect(a['Idempotency-Key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('mints distinct keys for different operations', () => {
    const a = idempotencyHeader('order-pay:ord-1');
    const b = idempotencyHeader('order-pay:ord-2');
    expect(a['Idempotency-Key']).not.toBe(b['Idempotency-Key']);
  });

  it('mints a fresh key after clearIdempotencyKey', () => {
    const a = idempotencyHeader('buy-now:list-1');
    clearIdempotencyKey('buy-now:list-1');
    const b = idempotencyHeader('buy-now:list-1');
    expect(a['Idempotency-Key']).not.toBe(b['Idempotency-Key']);
  });

  it('still mints a key when no operation id is passed (legacy)', () => {
    const a = idempotencyHeader();
    const b = idempotencyHeader();
    expect(a['Idempotency-Key']).toBeTruthy();
    expect(b['Idempotency-Key']).toBeTruthy();
    // Without an operation key, each call is independent (the pre-fix behaviour).
    expect(a['Idempotency-Key']).not.toBe(b['Idempotency-Key']);
  });
});
