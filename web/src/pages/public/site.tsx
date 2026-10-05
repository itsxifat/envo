import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../../state/auth';
import clsx from 'clsx';
import { ArrowUpRight, Menu, X } from 'lucide-react';

/**
 * The public website's own type: Funnel Display for headlines, Geist for text, Geist Mono for
 * numbers and labels, Anek Bangla for Bangla. Loaded only on public pages, so the dashboard stays lean.
 */
export function useSiteFonts(): void {
  useEffect(() => {
    if (document.getElementById('site-fonts')) return;
    const link = document.createElement('link');
    link.id = 'site-fonts';
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Funnel+Display:wght@400;500;600;700&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Anek+Bangla:wght@500;600&display=swap';
    document.head.appendChild(link);
  }, []);
}

/** The Envo wordmark: a small signal glyph and the name. */
export function Wordmark({ className, dark }: { className?: string; dark?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden>
        <rect width="24" height="24" rx="7" className={dark ? 'fill-white' : 'fill-[#0b0d12]'} />
        <path d="M7 9.5v5M10.3 7v10M13.7 9v6M17 11v2" strokeWidth="2" strokeLinecap="round" className="stroke-[#3b6df6]" />
      </svg>
      <span className={clsx('font-display text-[19px] leading-none font-semibold tracking-[-0.02em]', dark ? 'text-white' : 'text-[#0b0d12]')}>envo</span>
    </span>
  );
}

/** Section links: scroll in place on the home page, otherwise go to it. */
function useSectionHref(): (id: string) => string {
  const { pathname } = useLocation();
  const onHome = pathname === '/' || pathname === '/home';
  return (id) => (onHome ? `#${id}` : `/#${id}`);
}

export function SiteHeader() {
  const { user } = useAuth();
  const section = useSectionHref();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const links = [
    { href: section('product'), label: 'Product' },
    { href: section('pricing'), label: 'Pricing' },
    { href: section('faq'), label: 'FAQ' },
  ];
  return (
    <header className={clsx('sticky top-0 z-40 border-b transition-colors', scrolled ? 'border-[#e7e8ec] bg-white/90 backdrop-blur-md' : 'border-transparent bg-white')}>
      <div className="mx-auto flex h-[60px] max-w-[1200px] items-center gap-8 px-5 sm:px-8">
        <Link to="/" aria-label="Envo home">
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="Website">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="font-geist text-[14px] text-[#5b616e] transition hover:text-[#0b0d12]">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-5 md:flex">
          {user ? (
            <Link to="/" className="site-btn">
              Open dashboard
            </Link>
          ) : (
            <>
              <Link to="/login" className="font-geist text-[14px] text-[#0b0d12] hover:text-[#1f57eb]">
                Sign in
              </Link>
              <Link to="/signup" className="site-btn">
                Get started
              </Link>
            </>
          )}
        </div>
        <button type="button" className="ml-auto -mr-2 p-2 text-[#0b0d12] md:hidden" onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>
      {open && (
        <div className="border-t border-[#e7e8ec] bg-white px-5 pt-3 pb-6 md:hidden">
          {links.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="font-display block border-b border-[#f0f1f3] py-4 text-[22px] font-medium text-[#0b0d12]">
              {l.label}
            </a>
          ))}
          {user ? (
            <Link to="/" onClick={() => setOpen(false)} className="site-btn mt-5 w-full justify-center">
              Open dashboard
            </Link>
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Link to="/login" onClick={() => setOpen(false)} className="site-btn-ghost justify-center">
                Sign in
              </Link>
              <Link to="/signup" onClick={() => setOpen(false)} className="site-btn justify-center">
                Get started
              </Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  const section = useSectionHref();
  return (
    <footer className="border-t border-[#e7e8ec] bg-white">
      <div className="mx-auto max-w-[1200px] px-5 pt-14 pb-10 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="font-geist mt-4 max-w-xs text-[14px] leading-relaxed text-[#5b616e]">A cloud phone system for businesses in Bangladesh, made by Enfinito.</p>
          </div>
          <div className="font-geist space-y-2.5 text-[14px]">
            <div className="site-label mb-3">Envo</div>
            <a href={section('product')} className="block text-[#2a2e37] hover:text-[#1f57eb]">
              Product
            </a>
            <a href={section('pricing')} className="block text-[#2a2e37] hover:text-[#1f57eb]">
              Pricing
            </a>
            <a href={section('faq')} className="block text-[#2a2e37] hover:text-[#1f57eb]">
              FAQ
            </a>
          </div>
          <div className="font-geist space-y-2.5 text-[14px]">
            <div className="site-label mb-3">Account</div>
            <Link to="/signup" className="flex items-center gap-1 text-[#2a2e37] hover:text-[#1f57eb]">
              Create an account <ArrowUpRight className="size-3.5" />
            </Link>
            <Link to="/login" className="block text-[#2a2e37] hover:text-[#1f57eb]">
              Sign in
            </Link>
          </div>
        </div>
        <div className="font-geist mt-14 flex flex-col justify-between gap-3 border-t border-[#f0f1f3] pt-6 text-[13px] text-[#8a8f9a] sm:flex-row">
          <span>© {new Date().getFullYear()} Enfinito</span>
          <span className="font-gmono">envo.enfinito.cloud</span>
        </div>
      </div>
    </footer>
  );
}

export function SitePage({ children }: { children: ReactNode }) {
  useSiteFonts();
  return (
    <div className="site min-h-full bg-white">
      <SiteHeader />
      <main>{children}</main>
      <SiteFooter />
    </div>
  );
}
