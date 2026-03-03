export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b px-6 py-4">
        <nav aria-label="Main navigation">{/* Header navigation placeholder */}</nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t px-6 py-4">{/* Footer placeholder */}</footer>
    </div>
  );
}
