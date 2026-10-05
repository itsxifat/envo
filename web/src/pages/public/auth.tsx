import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import clsx from 'clsx';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useSiteFonts, Wordmark, WRAP } from './site';

/**
 * The frame of sign-in, sign-up and the email pages: wordmark, one large headline, the form.
 * `aside` adds a second column on wide screens (sign-up's live preview).
 */
export function AuthShell({
  title,
  lede,
  top,
  aside,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  top?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  useSiteFonts();
  return (
    <div className="site flex min-h-full flex-col bg-white">
      <header className={clsx(WRAP, 'flex h-[68px] items-center justify-between gap-4')}>
        <Link to="/" aria-label="Envo home">
          <Wordmark />
        </Link>
        {top && <div className="text-right text-[14px] text-[#5b616e]">{top}</div>}
      </header>
      <main className={clsx('mx-auto w-full flex-1 px-5 pt-[6vh] pb-20 sm:px-8', aside ? 'max-w-[1360px] xl:px-12' : 'max-w-[464px]')}>
        <div className={clsx(aside && 'grid gap-16 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-20 xl:gap-28')}>
          <div className={clsx(aside && 'w-full max-w-[440px]')}>
            <h1 className="font-display text-[40px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance sm:text-[48px]">{title}</h1>
            {lede && <div className="mt-4 text-[16px] leading-relaxed text-[#5b616e]">{lede}</div>}
            <div className="mt-10">{children}</div>
          </div>
          {aside && <div className="hidden lg:block">{aside}</div>}
        </div>
      </main>
      <footer className={clsx(WRAP, 'flex justify-between gap-4 py-6 text-[12.5px] text-[#8a8f9a]')}>
        <span>© {new Date().getFullYear()} Enfinito</span>
        <span className="font-gmono">envo.enfinito.cloud</span>
      </footer>
    </div>
  );
}

export function SiteField({ label, hint, aside, children }: { label: ReactNode; hint?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 flex items-baseline justify-between gap-3 text-[14px] font-medium text-[#0b0d12]">
        {label}
        {aside}
      </span>
      {children}
      {hint && <span className="mt-1.5 block text-[13px] text-[#8a8f9a]">{hint}</span>}
    </label>
  );
}

export function SiteInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx('site-input', className)} />;
}

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative block">
      <SiteInput {...props} type={show ? 'text' : 'password'} className="pr-12" />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-[#8a8f9a] transition hover:text-[#0b0d12]"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
      </button>
    </span>
  );
}

export function SubmitButton({ busy, children, className }: { busy?: boolean; children: ReactNode; className?: string }) {
  return (
    <button type="submit" disabled={busy} className={clsx('site-btn site-btn-lg w-full justify-center disabled:opacity-70', className)}>
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="rounded-xl bg-[#fdf1f0] px-4 py-3 text-[14px] leading-relaxed text-[#b42318]">
      {children}
    </div>
  );
}

export function FormNote({ children }: { children: ReactNode }) {
  return <div className="rounded-xl bg-[#f3f5fa] px-4 py-3.5 text-[14.5px] leading-relaxed text-[#2a2e37]">{children}</div>;
}

export function Spinner() {
  return <Loader2 className="size-6 animate-spin text-[#8a8f9a]" aria-label="Loading" />;
}

/** Inline link in the site's style. */
export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-medium text-[#0b0d12] underline decoration-[#c6cad2] underline-offset-4 transition hover:decoration-[#0b0d12]">
      {children}
    </Link>
  );
}
