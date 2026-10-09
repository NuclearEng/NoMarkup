import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';

import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFormField,
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

  it('throws when useFormField is used outside <FormField>', () => {
    // Suppress React error boundary noise for this throw-path test.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Inner() {
      const f = useForm<FormValues>({ defaultValues: { email: '' } });
      return (
        <Form {...f}>
          <FormItem>
            <BareLabel />
          </FormItem>
        </Form>
      );
    }
    function BareLabel() {
      // Used inside <FormItem> but NOT inside a <FormField>.
      useFormField();
      return null;
    }
    expect(() => render(<Inner />)).toThrow(/useFormField should be used within <FormField>/);
    errSpy.mockRestore();
  });

  it('throws when useFormField is used outside <FormItem>', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Inner() {
      const f = useForm<FormValues>({ defaultValues: { email: '' } });
      return (
        <Form {...f}>
          <FormField
            control={f.control}
            name="email"
            render={() => <BareLabel />}
          />
        </Form>
      );
    }
    function BareLabel() {
      // Used inside <FormField> but NOT inside <FormItem>.
      useFormField();
      return null;
    }
    expect(() => render(<Inner />)).toThrow(/useFormField should be used within <FormItem>/);
    errSpy.mockRestore();
  });

  it('renders an error message when validation fails (FormMessage error branch)', async () => {
    function ErrorForm() {
      const form = useForm<FormValues>({ defaultValues: { email: '' } });
      return (
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit(() => {})(e);
            }}
          >
            <FormField
              control={form.control}
              name="email"
              rules={{ required: 'Email is required' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="you@example.com" />
                  </FormControl>
                  <FormDescription>Help text</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <button type="submit">Save</button>
          </form>
        </Form>
      );
    }
    const user = userEvent.setup();
    render(<ErrorForm />);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Email is required')).toBeDefined();
    // FormControl describedby should now reference both description + message ids.
    const input = screen.getByPlaceholderText('you@example.com');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ').length).toBe(2);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('renders FormMessage children when there is no error', () => {
    function MessageForm() {
      const form = useForm<FormValues>({ defaultValues: { email: '' } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="you@example.com" />
                </FormControl>
                <FormMessage>A custom message</FormMessage>
              </FormItem>
            )}
          />
        </Form>
      );
    }
    render(<MessageForm />);
    expect(screen.getByText('A custom message')).toBeDefined();
  });

  it('renders nothing from FormMessage when there is neither error nor children', () => {
    function EmptyMessageForm() {
      const form = useForm<FormValues>({ defaultValues: { email: '' } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel data-testid="lbl">Email</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="you@example.com" />
                </FormControl>
                <FormMessage data-testid="empty-msg" />
              </FormItem>
            )}
          />
        </Form>
      );
    }
    render(<EmptyMessageForm />);
    expect(screen.queryByTestId('empty-msg')).toBeNull();
  });
});
