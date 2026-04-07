'use client';

import { Camera } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export interface ImageAnalysisResult {
  category: string;
  title: string;
  description: string;
  budgetMinCents: number;
  budgetMaxCents: number;
}

interface ImageAnalysisButtonProps {
  onResult: (result: ImageAnalysisResult) => void;
  className?: string;
}

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected FileReader result type'));
        return;
      }
      // Strip the data URL prefix (e.g. "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      if (!base64) {
        reject(new Error('Could not extract base64 data'));
        return;
      }
      resolve(base64);
    };
    reader.onerror = () => { reject(new Error('Failed to read file')); };
    reader.readAsDataURL(file);
  });
}

const analyzeImageResponseSchema = {
  isValid: (value: unknown): value is ImageAnalysisResult => {
    if (!value || typeof value !== 'object') return false;
    const v = value as Record<string, unknown>;
    return (
      typeof v['category'] === 'string' &&
      typeof v['title'] === 'string' &&
      typeof v['description'] === 'string' &&
      typeof v['budgetMinCents'] === 'number' &&
      typeof v['budgetMaxCents'] === 'number'
    );
  },
};

export function ImageAnalysisButton({ onResult, className }: ImageAnalysisButtonProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleButtonClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      toast.error('Please select a JPEG, PNG, GIF, or WebP image.');
      return;
    }

    setIsAnalyzing(true);
    try {
      const imageBase64 = await fileToBase64(file);

      const response = await fetch('/api/analyze-job-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType: file.type }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: 'Unknown error' }));
        const message =
          typeof errorBody === 'object' &&
          errorBody !== null &&
          'error' in errorBody &&
          typeof (errorBody as Record<string, unknown>)['error'] === 'string'
            ? (errorBody as Record<string, string>)['error']
            : 'Failed to analyze image';
        toast.error(message);
        return;
      }

      const data: unknown = await response.json();
      if (!analyzeImageResponseSchema.isValid(data)) {
        toast.error('Unexpected response from image analysis. Please try again.');
        return;
      }

      onResult(data);
    } catch {
      toast.error('Could not analyze image. Check your connection and try again.');
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => { void handleFileChange(e); }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleButtonClick}
        disabled={isAnalyzing}
        className={className}
        aria-label={isAnalyzing ? 'Analyzing photo...' : 'Analyze a photo to auto-fill the form'}
      >
        <Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />
        {isAnalyzing ? 'Analyzing...' : 'Analyze a Photo'}
      </Button>
    </>
  );
}
