import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import clsx from 'clsx';
import { Menu, X } from 'lucide-react';
import { LogoMark } from '../../components/Layout';
import { Button } from '../../components/ui';

/** Header and footer of the public website (signed-out visitors). */
export function PublicLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const links = [
    { href: '/#features', label: 'Features' },
    { href: '/#pricing', label: 'Pricing' },
    { href: '/#faq', label: 'Questions' },
  ];
  return (
    <div className="min-h-full bg-white">
      <header className={clsx('sticky top-0 z-40 transition', scrolled ? 'border-b border-slate-200/70 bg-white/85 backdrop-blur-xl' : 'bg-transparent')}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Envo home">
            <LogoMark className="size-8 rounded-[10px] [&>svg]:size-[18px]" />
            <span className="text-[17px] font-semibold tracking-tight text-slate-900">Envo</span>
          </Link>
          <nav className="hidden items-center gap-8 md:flex" aria-label="Website">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <NavLink to="/login">
              <Button variant="ghost">Sign in</Button>
            </NavLink>
            <NavLink to="/signup">
              <Button variant="primary">Get started</Button>
            </NavLink>
          </div>
          <button type="button" className="rounded-xl p-2 text-slate-600 md:hidden" onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            {open ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>
        {open && (
          <div className="animate-fade-in border-t border-slate-100 bg-white px-4 pt-2 pb-5 md:hidden">
            {links.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-base font-medium text-slate-700 active:bg-slate-50">
                {l.label}
              </a>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link to="/login" onClick={() => setOpen(false)}>
                <Button className="w-full" size="lg">
                  Sign in
                </Button>
              </Link>
              <Link to="/signup" onClick={() => setOpen(false)}>
                <Button className="w-full" size="lg" variant="primary">
                  Get started
                </Button>
              </Link>
            </div>
          </div>
        )}
      </header>
      <main>{children}</main>
      <footer className="border-t border-slate-100 bg-slate-50/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-7 rounded-lg [&>svg]:size-4" />
            <span className="text-sm text-slate-600">Envo Cloud PBX by Enfinito</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
            <a href="/#pricing" className="hover:text-slate-800">
              Pricing
            </a>
            <Link to="/login" className="hover:text-slate-800">
              Sign in
            </Link>
            <Link to="/signup" className="hover:text-slate-800">
              Create an account
            </Link>
            <span>© {new Date().getFullYear()} Enfinito</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Centered card for sign-up, sign-in helpers and email confirmation pages. */
export function AuthCard({ title, description, children, footer }: { title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="app-surface flex min-h-[calc(100dvh-4rem)] items-start justify-center px-4 pt-8 pb-16 sm:pt-16">
      <div className="w-full max-w-[440px]">
        <div className="rounded-3xl border border-slate-200/70 bg-white p-6 shadow-[var(--shadow-raise)] sm:p-8">
          <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <div className="mt-2 text-[15px] text-slate-500">{description}</div>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-5 text-center text-sm text-slate-500">{footer}</div>}
      </div>
    </div>
  );
}
