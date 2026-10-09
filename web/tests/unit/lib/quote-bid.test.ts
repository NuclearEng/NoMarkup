import { describe, expect, it, vi } from 'vitest';

import { clipQuoteBody, sendQuoteOpeningMessage } from '@/lib/quote-bid';

describe('sendQuoteOpeningMessage', () => {
  it('skips an empty body', async () => {
    const createChannel = vi.fn();
    const sendMessage = vi.fn();
    const result = await sendQuoteOpeningMessage({
      jobId: 'job-1',
      body: '   ',
      createChannel,
      sendMessage,
    });
    expect(result).toBe('skipped');
    expect(createChannel).not.toHaveBeenCalled();
  });

  it('clips the note to 2000 characters and sends it on the bid channel', async () => {
    const createChannel = vi.fn(async () => ({ id: 'ch-1' }));
    const sendMessage = vi.fn(async () => ({}));
    const body = 'a'.repeat(2005);
    const result = await sendQuoteOpeningMessage({
      jobId: 'job-1',
      body,
      createChannel,
      sendMessage,
    });
    expect(result).toBe('sent');
    expect(clipQuoteBody(body)).toHaveLength(2000);
    expect(sendMessage).toHaveBeenCalledWith({
      channelId: 'ch-1',
      input: { content: 'a'.repeat(2000), message_type: 'text' },
    });
  });

  it('returns failed when chat errors and does not throw', async () => {
    const result = await sendQuoteOpeningMessage({
      jobId: 'job-1',
      body: 'Parts included',
      createChannel: vi.fn(async () => {
        throw new Error('down');
      }),
      sendMessage: vi.fn(),
    });
    expect(result).toBe('failed');
  });
});
