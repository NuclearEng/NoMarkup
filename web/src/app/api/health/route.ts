import { NextResponse } from 'next/server';

/**
 * Liveness/readiness endpoint for the web pod.
 *
 * The k8s manifests (`deploy/k8s/base/web/deployment.yaml`) previously probed
 * `/health`, which is not a route in the App Router — Next.js answered 404,
 * the pod never went Ready, and the rollout would have hung until timeout.
 *
 * Deliberately dependency-free. This process serves server-rendered pages and
 * proxies API calls to the gateway; the gateway has its own `/readyz` that
 * checks Postgres and Redis. Making the web probe depend on the gateway would
 * turn a backend blip into a frontend restart storm, so this only reports "the
 * Next.js server is up and routing".
 *
 * `force-dynamic` keeps this out of the static export — a cached 200 would
 * report healthy from a dead process.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'web' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
