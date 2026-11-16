// Contract forms.
import { REVISION_NOTES_RULE } from '@/lib/text-rules';
import * as z from '@/lib/zod-mini';

export const revisionNotesSchema = z.string().check(
  z.minLength(REVISION_NOTES_RULE.min, REVISION_NOTES_RULE.minMessage),
  // No custom message: the upper bound reports Zod's default text.
  z.maxLength(REVISION_NOTES_RULE.max),
);
