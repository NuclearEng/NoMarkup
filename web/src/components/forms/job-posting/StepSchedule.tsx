'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { JobFormType } from '@/components/forms/job-posting/types';

interface StepScheduleProps {
  form: JobFormType;
  sameDayRequested: boolean;
  onSameDayChange: (value: boolean) => void;
}

export function StepSchedule({ form, sameDayRequested, onSameDayChange }: StepScheduleProps) {
  const scheduleType = form.watch('scheduleType');
  const isRecurring = form.watch('isRecurring');

  return (
    <div className="space-y-6">
      <FormField
        control={form.control}
        name="scheduleType"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Schedule Type</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue placeholder="Select schedule type" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="specific_date">Specific Date</SelectItem>
                <SelectItem value="date_range">Date Range</SelectItem>
                <SelectItem value="flexible">Flexible</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {scheduleType === 'specific_date' ? (
        <FormField
          control={form.control}
          name="scheduledDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred Date</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="date"
                  min={new Date().toISOString().split('T')[0]}
                  className="min-h-[44px]"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      <FormField
        control={form.control}
        name="isRecurring"
        render={({ field }) => (
          <FormItem className="flex min-h-[44px] items-center gap-3">
            <FormControl>
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormLabel className="cursor-pointer">This is a recurring job</FormLabel>
            <FormMessage />
          </FormItem>
        )}
      />

      {isRecurring ? (
        <FormField
          control={form.control}
          name="recurrenceFrequency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Recurrence Frequency</FormLabel>
              <Select onValueChange={field.onChange} value={field.value ?? ''}>
                <FormControl>
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : null}

      {/* Wave 5 services-polish — Thumbtack-style "I need this today"
          SLA flag. Downstream matcher prioritizes providers with
          same_day_available=true on their availability profile.
          Plain div instead of FormItem/FormControl — this checkbox
          isn't tied to react-hook-form state, so wrapping in a
          FormField context is unnecessary and would error. */}
      <label
        htmlFor="same-day-toggle"
        className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3"
      >
        <Checkbox
          id="same-day-toggle"
          checked={sameDayRequested}
          onCheckedChange={(c) => {
            onSameDayChange(c === true);
          }}
          aria-label="I need this done today"
        />
        <div>
          <span className="text-sm font-medium">I need this done today</span>
          <p className="text-muted-foreground text-xs">
            We&apos;ll prioritize providers who can show up the same day. Higher rates may apply.
          </p>
        </div>
      </label>
    </div>
  );
}
