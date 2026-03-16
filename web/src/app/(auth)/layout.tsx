import { Logo } from '@/components/layout/Logo';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-8">
      <div className="mb-8">
        <Logo size="lg" />
      </div>
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
