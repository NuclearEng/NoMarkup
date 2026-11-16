// Bid forms.
import * as z from '@/lib/zod-mini';

export const bidAmountSchema = z
  .number()
  .check(z.int('Amount must be in whole cents'), z.positive('Amount must be positive'));

// Bid schemas
export const bidSchema = z.object({
  amountDollars: z.number().check(z.positive('Bid amount must be positive')),
});

export type BidFormValues = z.infer<typeof bidSchema>;
