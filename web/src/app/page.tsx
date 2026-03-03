import { ArrowRight, DollarSign, Shield, Star } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Header } from '@/components/layout/Header';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto flex max-w-4xl flex-col items-center px-4 py-20 text-center sm:py-32">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Home services at <span className="text-primary">fair prices</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Post your job and let verified providers compete for your business.
            Reverse-auction bidding means you always get the best price.
          </p>
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Button size="lg" className="min-h-[44px]" asChild>
              <Link href="/register">
                Get started
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="min-h-[44px]" asChild>
              <Link href="/jobs">Browse jobs</Link>
            </Button>
          </div>
        </section>

        {/* Value props */}
        <section className="border-t bg-muted/50 px-4 py-16">
          <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-3">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <DollarSign className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Reverse Auction</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Providers bid down, not up. You pick the best price and provider for your job.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Shield className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Verified Providers</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Every provider is identity-verified with trust scores and reviews you can rely on.
              </p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                <Star className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Secure Payments</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Funds held in escrow until the job is done. Pay only when you're satisfied.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} NoMarkup. All rights reserved.
      </footer>
    </div>
  );
}

