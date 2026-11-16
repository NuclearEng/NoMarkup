'use client';

import { Mic, MicOff } from 'lucide-react';
import { useState } from 'react';

import { ImageAnalysisButton } from '@/components/forms/ImageAnalysisButton';
import { PreQuoteQuestions } from '@/components/forms/PreQuoteQuestions';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCategories } from '@/hooks/useCategories';
import { type SubmitAnswerInput } from '@/types';
import type { JobFormType } from '@/components/forms/job-posting/types';

// Minimal local interface for the Web Speech API (not yet in all TS DOM lib builds).
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } | undefined } | undefined } }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
}

// Typed accessor for the browser's SpeechRecognition constructor (unprefixed + webkit prefix).
function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window &
    typeof globalThis & {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface StepDetailsProps {
  form: JobFormType;
  questionAnswers: Record<string, SubmitAnswerInput>;
  onQuestionAnswersChange: (next: Record<string, SubmitAnswerInput>) => void;
}

export function StepDetails({ form, questionAnswers, onQuestionAnswersChange }: StepDetailsProps) {
  const { data: categories } = useCategories();
  const [isListening, setIsListening] = useState(false);
  const hasSpeechRecognition = getSpeechRecognitionConstructor() !== null;
  const categoryId = form.watch('categoryId');

  function startVoiceInput() {
    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setIsListening(true);
    recognition.onresult = (event: { results: { [i: number]: { [j: number]: { transcript: string } | undefined } | undefined } }) => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      form.setValue('title', transcript.slice(0, 60), { shouldValidate: true, shouldDirty: true });
    };
    recognition.onerror = () => { setIsListening(false); };
    recognition.onend = () => { setIsListening(false); };
    recognition.start();
  }

  return (
    <div className="space-y-6">
      <ImageAnalysisButton
        onResult={(result) => {
          form.setValue('title', result.title, { shouldValidate: true, shouldDirty: true });
          form.setValue('description', result.description, {
            shouldValidate: true,
            shouldDirty: true,
          });
          if (categories) {
            const match = categories.find(
              (c) => c.name.toLowerCase() === result.category.toLowerCase(),
            );
            if (match) {
              form.setValue('categoryId', match.id, { shouldValidate: true, shouldDirty: true });
            }
          }
        }}
      />

      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <div className="flex items-center gap-2">
              <FormLabel>Job Title</FormLabel>
              {hasSpeechRecognition ? (
                <button
                  type="button"
                  onClick={startVoiceInput}
                  disabled={isListening}
                  aria-label={isListening ? 'Listening for voice input' : 'Use voice input for title'}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {isListening ? (
                    <MicOff className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                  ) : (
                    <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </div>
            <FormControl>
              <Input
                {...field}
                placeholder="e.g., Kitchen sink repair and replacement"
                maxLength={200}
                className="min-h-[44px]"
              />
            </FormControl>
            <FormDescription>
              {String(field.value.length)}/200 characters (minimum 10)
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                rows={6}
                maxLength={5000}
                placeholder="Describe the work you need done in detail. Include any specific requirements, materials needed, or preferences..."
              />
            </FormControl>
            <FormDescription>
              {String(field.value.length)}/5000 characters (minimum 50)
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Wave 5 services-polish — Thumbtack-style pre-quote questions
          render below the description so providers can quote off real
          scope. Hides itself when the category has no questions. */}
      <PreQuoteQuestions
        categoryId={categoryId}
        value={questionAnswers}
        onChange={onQuestionAnswersChange}
      />
    </div>
  );
}
