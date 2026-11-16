// Chat.
import { CHAT_MESSAGE_RULE } from '@/lib/text-rules';
import * as z from '@/lib/zod-mini';

export const chatMessageSchema = z
  .string()
  .check(
    z.minLength(CHAT_MESSAGE_RULE.min, CHAT_MESSAGE_RULE.minMessage),
    z.maxLength(CHAT_MESSAGE_RULE.max, CHAT_MESSAGE_RULE.maxMessage),
  );
