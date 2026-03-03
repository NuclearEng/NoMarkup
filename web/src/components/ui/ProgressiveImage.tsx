'use client';

import Image from 'next/image';
import { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';

interface ProgressiveImageProps {
  src: string;
  alt: string;
  blurHash?: string | null;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
}

/**
 * Derives a simple average background color from a BlurHash string.
 *
 * BlurHash encodes DC (average) and AC components using a base-83 alphabet.
 * The first character encodes the size, the second encodes max AC, and
 * characters 2-5 encode the DC (average) color as a 4-digit base-83 value.
 * We decode those 4 characters to extract the average RGB color.
 */
const BASE83_ALPHABET =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';

function base83Decode(str: string): number {
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === undefined) continue;
    const idx = BASE83_ALPHABET.indexOf(char);
    if (idx === -1) return 0;
    value = value * 83 + idx;
  }
  return value;
}

function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped <= 0.0031308
    ? Math.round(clamped * 12.92 * 255 + 0.5)
    : Math.round((1.055 * Math.pow(clamped, 1 / 2.4) - 0.055) * 255 + 0.5);
}

function extractAverageColor(blurHash: string): string {
  if (blurHash.length < 6) return 'rgb(229, 231, 235)';

  // Characters at index 2-5 encode the DC component
  const dcSlice = blurHash.slice(2, 6);
  const dcValue = base83Decode(dcSlice);

  const intR = dcValue >> 16;
  const intG = (dcValue >> 8) & 255;
  const intB = dcValue & 255;

  // BlurHash DC values are stored in linear space, convert to sRGB
  const r = linearToSrgb(srgbToLinear(intR));
  const g = linearToSrgb(srgbToLinear(intG));
  const b = linearToSrgb(srgbToLinear(intB));

  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

const PLACEHOLDER_COLOR = 'rgb(229, 231, 235)';

export function ProgressiveImage({
  src,
  alt,
  blurHash,
  width,
  height,
  className,
  priority = false,
}: ProgressiveImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  const backgroundColor = blurHash ? extractAverageColor(blurHash) : PLACEHOLDER_COLOR;

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  // When both width and height are provided, use fixed-size rendering.
  // Otherwise, use fill mode for responsive containers.
  const useFill = width === undefined || height === undefined;

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{
        backgroundColor,
        ...(useFill ? {} : { width, height }),
      }}
    >
      {useFill ? (
        <Image
          src={src}
          alt={alt}
          fill
          priority={priority}
          className={cn(
            'object-cover transition-opacity duration-200',
            isLoaded ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={handleLoad}
          sizes="100vw"
        />
      ) : (
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          priority={priority}
          className={cn(
            'transition-opacity duration-200',
            isLoaded ? 'opacity-100' : 'opacity-0',
          )}
          onLoad={handleLoad}
        />
      )}
    </div>
  );
}
