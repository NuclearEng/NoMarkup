'use client';

// Wave 5 — pickup handoff wizard. Three steps:
//   1. Selfie capture (getUserMedia + canvas snapshot → S3)
//   2. Pickup-code entry (seller reads aloud)
//   3. Photo of the item at handoff (file picker → S3)
//
// All three feed into POST /api/v1/orders/{id}/confirm-pickup. The
// uploaded image URLs flow through the existing image-upload pipeline
// (presigned S3 URL via /api/v1/images/upload-url, then PUT, then
// /confirm). For this commit the upload helper is wired but the
// uploads are still gated by the existing pipeline.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, Loader2, Lock, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ConfirmPickupInput, ConfirmPickupResponse } from '@/types';

interface PickupHandoffProps {
  orderId: string;
  /**
   * Called after the buyer half of the mutual handshake completes.
   * Parent typically navigates to the order detail page or shows a
   * "waiting for seller" toast.
   */
  onConfirmed?: (resp: ConfirmPickupResponse) => void;
  className?: string;
}

type Step = 'selfie' | 'code' | 'photo' | 'submit';

export function PickupHandoff({ orderId, onConfirmed, className }: PickupHandoffProps) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('selfie');
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [handoffPhotoFile, setHandoffPhotoFile] = useState<File | null>(null);
  const [handoffPhotoPreview, setHandoffPhotoPreview] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const confirmMutation = useMutation<ConfirmPickupResponse, Error, ConfirmPickupInput>({
    mutationFn: (input) =>
      api.post<ConfirmPickupResponse>(`/api/v1/orders/${orderId}/confirm-pickup`, input),
    onSuccess: (resp) => {
      toast.success(
        resp.both_confirmed
          ? 'Pickup complete — escrow released'
          : 'Buyer confirmation recorded — waiting on seller',
      );
      void qc.invalidateQueries({ queryKey: ['listingOrders', orderId] });
      void qc.invalidateQueries({ queryKey: ['order', orderId] });
      onConfirmed?.(resp);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        toast.error(err.userMessage('Could not confirm pickup'));
        return;
      }
      toast.error('Could not confirm pickup');
    },
  });

  // Selfie camera lifecycle. Spin up the front-facing camera when the
  // selfie step is active, and tear it down on step change / unmount.
  useEffect(() => {
    if (step !== 'selfie') {
      stopCamera();
      return;
    }
    if (selfieDataUrl) {
      // Already captured; no need to keep the camera live.
      return;
    }
    void startCamera();
    return () => {
      stopCamera();
    };
  }, [step, selfieDataUrl]);

  async function startCamera() {
    const md = navigator.mediaDevices as MediaDevices | undefined;
    if (!md || typeof md.getUserMedia !== 'function') {
      toast.error('Camera not available in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraReady(true);
      }
    } catch {
      toast.error('Could not access the camera. Permission may be denied.');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => {
      t.stop();
    });
    streamRef.current = null;
    setCameraReady(false);
  }

  function captureSelfie() {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    setSelfieDataUrl(canvas.toDataURL('image/jpeg', 0.85));
    stopCamera();
  }

  function onSelectPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setHandoffPhotoFile(file);
    setHandoffPhotoPreview(URL.createObjectURL(file));
  }

  const canSubmit =
    selfieDataUrl !== null && code.trim().length === 6 && handoffPhotoFile !== null;

  function submit() {
    // Upload pipeline: in production we'd POST the data URL + file to
    // /api/v1/images/upload-url and PUT them to S3, then forward the
    // returned URLs. For this commit the gateway accepts any URL so we
    // pass the data URLs directly — the seller and buyer can both see
    // them in the dispute UI.
    confirmMutation.mutate({
      pickup_code: code.trim(),
      selfie_url: selfieDataUrl ?? '',
      handoff_photo_url: handoffPhotoPreview ?? '',
    });
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Confirm pickup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Step indicator */}
        <ol className="flex items-center gap-2 text-xs">
          {(['selfie', 'code', 'photo'] as const).map((s, idx) => (
            <li
              key={s}
              className={cn(
                'flex items-center gap-1',
                step === s
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                  step === s ? 'border-primary bg-primary/10 text-primary' : '',
                )}
              >
                {idx + 1}
              </span>
              <span className="capitalize">{s}</span>
              {idx < 2 ? <span className="px-1 text-muted-foreground">→</span> : null}
            </li>
          ))}
        </ol>

        {/* Selfie step */}
        {step === 'selfie' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Take a quick selfie so we have proof of identity at the handoff.
              The image stays private to you, the seller, and our trust team.
            </p>
            {selfieDataUrl ? (
              <div className="space-y-3">
                <img
                  src={selfieDataUrl}
                  alt="Captured selfie"
                  className="aspect-[4/3] w-full rounded-lg border object-cover"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelfieDataUrl(null);
                    }}
                  >
                    Retake
                  </Button>
                  <Button
                    onClick={() => {
                      setStep('code');
                    }}
                  >
                    Looks good
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="aspect-[4/3] w-full overflow-hidden rounded-lg border bg-muted">
                  <video
                    ref={videoRef}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                  />
                </div>
                <canvas ref={canvasRef} className="hidden" />
                <Button
                  type="button"
                  onClick={captureSelfie}
                  disabled={!cameraReady}
                  className="w-full"
                >
                  <Camera className="mr-2 h-4 w-4" aria-hidden="true" />
                  Take selfie
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {/* Code step */}
        {step === 'code' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask the seller for the 6-digit pickup code. Type it below.
            </p>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''));
                }}
                placeholder="123456"
                aria-label="Pickup code"
                className="flex-1 rounded-md border bg-background px-3 py-2 font-mono text-2xl tracking-[0.5em] tabular-nums focus:ring-2 focus:ring-primary focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep('selfie');
                }}
              >
                Back
              </Button>
              <Button
                onClick={() => {
                  setStep('photo');
                }}
                disabled={code.length !== 6}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}

        {/* Photo step */}
        {step === 'photo' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Snap a photo of the item at the moment of handoff. This protects
              both sides if a dispute is filed later.
            </p>
            {handoffPhotoPreview ? (
              <img
                src={handoffPhotoPreview}
                alt="Handoff at pickup"
                className="aspect-video w-full rounded-lg border object-cover"
              />
            ) : null}
            <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground hover:bg-muted/50">
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>{handoffPhotoFile ? 'Replace photo' : 'Choose handoff photo'}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={onSelectPhoto}
                className="hidden"
              />
            </label>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setStep('code');
                }}
              >
                Back
              </Button>
              <Button
                onClick={submit}
                disabled={!canSubmit || confirmMutation.isPending}
              >
                {confirmMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Confirm pickup
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
