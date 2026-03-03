'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUpdateProfile } from '@/hooks/useProfile';
import { profileSchema, type ProfileFormValues } from '@/lib/validations';
import type { User } from '@/types';

const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
] as const;

interface ProfileFormProps {
  user: User;
  onCancel: () => void;
  onSuccess: () => void;
}

export function ProfileForm({ user, onCancel, onSuccess }: ProfileFormProps) {
  const updateProfile = useUpdateProfile();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user.displayName,
      phone: '',
      timezone: 'America/New_York',
      avatarUrl: user.avatarUrl ?? '',
    },
  });

  async function onSubmit(values: ProfileFormValues) {
    await updateProfile.mutateAsync({
      display_name: values.displayName,
      phone: values.phone || undefined,
      timezone: values.timezone,
      avatar_url: values.avatarUrl || undefined,
    });
    onSuccess();
  }

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6">
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display Name</FormLabel>
              <FormControl>
                <Input {...field} className="min-h-[44px]" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number</FormLabel>
              <FormControl>
                <Input type="tel" placeholder="+15551234567" {...field} className="min-h-[44px]" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="timezone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Timezone</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger className="min-h-[44px]">
                    <SelectValue placeholder="Select timezone" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {US_TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="avatarUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Avatar URL</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  placeholder="https://example.com/avatar.jpg"
                  {...field}
                  className="min-h-[44px]"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-3">
          <Button type="submit" disabled={updateProfile.isPending} className="min-h-[44px]">
            {updateProfile.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  );
}
