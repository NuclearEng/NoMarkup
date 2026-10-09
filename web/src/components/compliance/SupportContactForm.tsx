'use client';

// Client contact form for /support — opens mailto: with prefilled subject/body.
// No backend support ticket API is assumed (ASR support surface).

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const SUPPORT_EMAIL = 'support@no-markup.com';

export function SupportContactForm() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmedSubject = subject.trim() || 'NoMarkup support request';
    const bodyLines = [
      name.trim() ? `Name: ${name.trim()}` : null,
      email.trim() ? `Reply-to: ${email.trim()}` : null,
      '',
      message.trim(),
    ].filter((line): line is string => line !== null);

    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(trimmedSubject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
    window.location.href = mailto;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-white/10 bg-white/[0.02] p-5"
      noValidate
      data-testid="support-contact-form"
    >
      <div className="space-y-2">
        <Label htmlFor="support-name">Name (optional)</Label>
        <Input
          id="support-name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => { setName(e.target.value); }}
          className="min-h-[44px]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-email">Your email (optional)</Label>
        <Input
          id="support-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); }}
          className="min-h-[44px]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-subject">Subject</Label>
        <Input
          id="support-subject"
          name="subject"
          required
          value={subject}
          onChange={(e) => { setSubject(e.target.value); }}
          placeholder="How can we help?"
          className="min-h-[44px]"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="support-message">Message</Label>
        <Textarea
          id="support-message"
          name="message"
          required
          rows={5}
          value={message}
          onChange={(e) => { setMessage(e.target.value); }}
          placeholder="Describe your issue, include relevant job/listing IDs if you have them."
          className="min-h-[120px]"
        />
      </div>
      <Button type="submit" className="min-h-[44px] w-full sm:w-auto">
        Open email to support
      </Button>
      <p className="text-xs text-zinc-500">
        This opens your email app addressed to{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="text-[var(--brand-gold)] underline-offset-4 hover:underline"
        >
          {SUPPORT_EMAIL}
        </a>
        . No message is stored on our servers from this form.
      </p>
    </form>
  );
}
