import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useForm } from 'react-hook-form';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';

interface FormValues {
  email: string;
}

function TestForm({ defaultValues = { email: '' } }: { defaultValues?: FormValues }) {
  const form = useForm<FormValues>({ defaultValues });
  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} placeholder="you@example.com" />
              </FormControl>
              <FormDescription>Your work email</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

describe('Form', () => {
  it('renders label, input and description', () => {
    render(<TestForm />);
    expect(screen.getByText('Email')).toBeDefined();
    expect(screen.getByPlaceholderText('you@example.com')).toBeDefined();
    expect(screen.getByText('Your work email')).toBeDefined();
  });

  it('associates label with input via htmlFor / id', () => {
    render(<TestForm />);
    const label = screen.getByText('Email');
    const input = screen.getByPlaceholderText('you@example.com');
    expect(label.getAttribute('for')).toBe(input.id);
  });

  it('uses default value from the form state', () => {
    render(<TestForm defaultValues={{ email: 'a@b.com' }} />);
    expect(screen.getByPlaceholderText<HTMLInputElement>('you@example.com').value).toBe(
      'a@b.com',
    );
  });
});
