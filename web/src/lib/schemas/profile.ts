// Profile edit form.
import * as z from '@/lib/zod-mini';

import { optionalOrEmpty } from './_helpers';
import { displayNameSchema, phoneSchema } from './common';

export const timezoneSchema = z.string().check(z.minLength(1, 'Timezone is required'));

export const profileSchema = z.object({
  displayName: displayNameSchema,
  phone: optionalOrEmpty(phoneSchema),
  timezone: timezoneSchema,
  avatarUrl: optionalOrEmpty(z.url('Must be a valid URL')),
});

export type ProfileFormValues = z.infer<typeof profileSchema>;
