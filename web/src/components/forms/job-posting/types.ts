import type { UseFormReturn } from 'react-hook-form';

import type { JobPostingFormValues } from '@/lib/schemas/jobs';

/** The job-posting wizard's form object, shared by the shell and every step. */
export type JobFormType = UseFormReturn<JobPostingFormValues>;
