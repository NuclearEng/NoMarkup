// Apply a saved quote into a live service bid.
// The bid row has no notes column, so the template body is the opening
// message on the job channel after the bid is accepted. A chat failure
// does not undo the bid.

export const QUOTE_MESSAGE_MAX = 2000;

export function clipQuoteBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= QUOTE_MESSAGE_MAX) return trimmed;
  return trimmed.slice(0, QUOTE_MESSAGE_MAX);
}

export type QuoteOpeningResult = 'sent' | 'skipped' | 'failed';

export async function sendQuoteOpeningMessage(args: {
  jobId: string;
  body: string;
  createChannel: (input: {
    job_id: string;
    channel_type: 'bid';
  }) => Promise<{ id?: string } | null | undefined>;
  sendMessage: (input: {
    channelId: string;
    input: { content: string; message_type: 'text' };
  }) => Promise<unknown>;
}): Promise<QuoteOpeningResult> {
  const content = clipQuoteBody(args.body);
  if (!content) return 'skipped';
  try {
    const channel = await args.createChannel({
      job_id: args.jobId,
      channel_type: 'bid',
    });
    const channelId = channel?.id?.trim() ?? '';
    if (!channelId) return 'failed';
    await args.sendMessage({
      channelId,
      input: { content, message_type: 'text' },
    });
    return 'sent';
  } catch {
    return 'failed';
  }
}
