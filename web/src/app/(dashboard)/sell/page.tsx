import { redirect } from 'next/navigation';

// The /sell section has no index of its own — its canonical entry point is the
// listing-creation flow at /sell/new (which the "Sell an Item" nav links to).
// A bare /sell visit (typed URL, bookmark, or back-nav to the section root)
// should land on that flow rather than 404.
export default function SellIndexPage() {
  redirect('/sell/new');
}
