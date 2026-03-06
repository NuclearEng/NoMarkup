'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Shield } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api';
import { changePasswordSchema } from '@/lib/validations';
import type { ChangePasswordFormValues } from '@/lib/validations';

export default function SecuritySettingsPage() {
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
    },
  });

  async function onSubmit(values: ChangePasswordFormValues) {
    setPasswordError(null);
    setPasswordSuccess(false);
    try {
      await api.post('/api/v1/auth/change-password', {
        current_password: values.currentPassword,
        new_password: values.newPassword,
      });
      setPasswordSuccess(true);
      form.reset();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to change password';
      setPasswordError(message);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your password and account security
        </p>
      </div>

      {/* Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5" aria-hidden="true" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form
              onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
              className="max-w-md space-y-4"
              noValidate
            >
              {passwordError ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {passwordError}
                </div>
              ) : null}

              {passwordSuccess ? (
                <div
                  role="status"
                  className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
                >
                  Password changed successfully.
                </div>
              ) : null}

              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter current password"
                        autoComplete="current-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="newPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Enter new password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirmNewPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="Confirm new password"
                        autoComplete="new-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="min-h-[44px]"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting
                  ? 'Changing...'
                  : 'Change Password'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Separator />

      {/* Active Sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You are currently signed in. Your session will expire after 60
            minutes of inactivity.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
