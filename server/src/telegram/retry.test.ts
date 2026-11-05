import { describe, expect, it, vi } from 'vitest';
import { tg } from './retry.js';

const flood = (s: number) =>
  Object.assign(new Error('flood'), { seconds: s, errorMessage: `FLOOD_WAIT_${s}` });

describe('tg', () => {
  it('returns value without retry', async () => {
    expect(await tg(async () => 1)).toBe(1);
  });
  it('waits seconds+1 then retries', async () => {
    const sleep = vi.fn(async () => {});
    const fn = vi.fn().mockRejectedValueOnce(flood(3)).mockResolvedValue('ok');
    expect(await tg(fn, { sleep })).toBe('ok');
    expect(sleep).toHaveBeenCalledWith(4000);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('rethrows other errors immediately', async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      tg(
        async () => {
          throw new Error('boom');
        },
        { sleep },
      ),
    ).rejects.toThrow('boom');
    expect(sleep).not.toHaveBeenCalled();
  });
  it('gives up after retries', async () => {
    const sleep = vi.fn(async () => {});
    await expect(
      tg(
        async () => {
          throw flood(1);
        },
        { sleep, retries: 2 },
      ),
    ).rejects.toThrow('flood');
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
