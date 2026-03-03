import Link from 'next/link';

import { APP_NAME } from '@/lib/constants';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <Link
        href="/"
        className="mb-8 text-3xl font-bold tracking-tight text-foreground"
      >
        {APP_NAME}
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
