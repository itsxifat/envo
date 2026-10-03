import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsUpDown,
  Copy,
  Eye,
  EyeOff,
  Info,
  LoaderCircle,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

// ------------------------------------------------------------------ Button
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dark';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-xs focus-visible:ring-brand-500/30',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 hover:border-slate-400 active:bg-slate-100 shadow-xs focus-visible:ring-slate-400/25',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200/70 focus-visible:ring-slate-400/25',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 shadow-xs focus-visible:ring-rose-500/30',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-xs focus-visible:ring-emerald-500/30',
  dark: 'bg-ink-950 text-white hover:bg-ink-800 active:bg-ink-900 shadow-xs focus-visible:ring-slate-500/30',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition duration-150 focus-visible:ring-3 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9.5 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  label,
  className,
  tone = 'default',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & { label: string; tone?: 'default' | 'danger' | 'brand' }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        className={clsx(
          'inline-flex size-8 items-center justify-center rounded-lg transition focus-visible:ring-3 focus-visible:ring-slate-400/25 focus-visible:outline-none disabled:opacity-40',
          tone === 'danger' && 'text-slate-400 hover:bg-rose-50 hover:text-rose-600',
          tone === 'brand' && 'text-brand-600 hover:bg-brand-50 hover:text-brand-700',
          tone === 'default' && 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
          className,
        )}
        {...rest}
      />
    </Tooltip>
  );
}

// ------------------------------------------------------------------ Tooltip
/** Hover/focus tooltip rendered in a portal so it escapes table and card clipping. */
export function Tooltip({ label, children, side = 'top' }: { label?: ReactNode; children: ReactNode; side?: 'top' | 'bottom' }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const show = () => {
    const r = ref.current?.firstElementChild?.getBoundingClientRect();
    if (!r) return;
    setBox({ top: side === 'top' ? r.top - 8 : r.bottom + 8, left: r.left + r.width / 2 });
  };
  if (!label) return <>{children}</>;
  return (
    <>
      <span ref={ref} className="contents" onPointerEnter={show} onPointerLeave={() => setBox(null)} onFocusCapture={show} onBlurCapture={() => setBox(null)}>
        {children}
      </span>
      {box &&
        createPortal(
          <span
            role="tooltip"
            style={{ top: box.top, left: box.left }}
            className={clsx(
              'animate-fade-in pointer-events-none fixed z-[70] -translate-x-1/2 rounded-md bg-ink-950 px-2 py-1 text-[11.5px] font-medium whitespace-nowrap text-white shadow-lg',
              side === 'top' ? '-translate-y-full' : '',
            )}
          >
            {label}
          </span>,
          document.body,
        )}
    </>
  );
}

// ------------------------------------------------------------------ Form fields
export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
  required,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
  required?: boolean;
}) {
  return (
    <div className={className}>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-rose-600">
          <AlertTriangle className="size-3 shrink-0" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={clsx('input', invalid && 'input-error', className)} {...rest} />;
});

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx('input min-h-20', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx('input appearance-none bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat pr-9', className)} style={{ backgroundImage: SELECT_ARROW }} {...rest}>
      {children}
    </select>
  );
}
const SELECT_ARROW =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function NumberInput({
  value,
  onChange,
  min,
  max,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <Input
      type="number"
      inputMode="numeric"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      {...rest}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition focus-visible:ring-3 focus-visible:ring-brand-500/25 focus-visible:outline-none disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all duration-200', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
      {(label || description) && (
        <label htmlFor={id} className="cursor-pointer select-none">
          {label && <span className="block text-sm font-medium text-slate-800">{label}</span>}
          {description && <span className="block text-xs text-slate-500">{description}</span>}
        </label>
      )}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={clsx('relative w-full max-w-xs', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={clsx('pl-9', value && 'pr-9')}
        autoFocus={autoFocus}
        type="search"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Display
type Tone = 'gray' | 'green' | 'red' | 'amber' | 'blue' | 'brand' | 'violet';
const TONES: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-600 ring-slate-500/15',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone], className)}>
      {children}
    </span>
  );
}

const DOT: Record<string, string> = {
  green: 'bg-emerald-500',
  red: 'bg-rose-500',
  amber: 'bg-amber-500',
  gray: 'bg-slate-300',
  blue: 'bg-sky-500',
  violet: 'bg-violet-500',
};

export function StatusDot({ tone, pulse }: { tone: keyof typeof DOT; pulse?: boolean }) {
  return (
    <span className="relative inline-flex size-2.5">
      {pulse && <span className={clsx('absolute inline-flex size-full animate-ping rounded-full opacity-60', DOT[tone])} />}
      <span className={clsx('relative inline-flex size-2.5 rounded-full', DOT[tone])} />
    </span>
  );
}

/** Three bars that animate while a call is up. */
export function LiveBars({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex h-3.5 items-end gap-0.5', className)} aria-hidden>
      {[0, 0.15, 0.3].map((d) => (
        <span key={d} className="eq-bar w-[3px] rounded-full bg-current" style={{ height: '100%', animationDelay: `${d}s` }} />
      ))}
    </span>
  );
}

export function Card({ children, className, interactive }: { children: ReactNode; className?: string; interactive?: boolean }) {
  return <div className={clsx('card', interactive && 'transition-shadow duration-200 hover:shadow-[var(--shadow-raise)]', className)}>{children}</div>;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, icon }: { title: string; description?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3">
        {icon && <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-xs ring-1 ring-slate-200">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div className="relative mb-4">
          <div className="absolute inset-0 scale-150 rounded-full bg-slate-100/70 blur-md" />
          <div className="relative flex size-12 items-center justify-center rounded-2xl bg-white text-slate-400 ring-1 ring-slate-200">{icon}</div>
        </div>
      )}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondary}
        </div>
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={clsx('size-5 animate-spin text-slate-400', className)} />;
}

export function LoadingBlock() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner />
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="m-4 flex flex-wrap items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">{error instanceof Error ? error.message : 'Something went wrong'}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Inline message block used inside cards and forms. */
export function Notice({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'danger' | 'success'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const map = {
    info: ['bg-sky-50 text-sky-900 ring-sky-600/15', 'text-sky-600', Info],
    warn: ['bg-amber-50 text-amber-900 ring-amber-600/20', 'text-amber-600', AlertTriangle],
    danger: ['bg-rose-50 text-rose-900 ring-rose-600/15', 'text-rose-600', AlertTriangle],
    success: ['bg-emerald-50 text-emerald-900 ring-emerald-600/15', 'text-emerald-600', Check],
  } as const;
  const [box, iconColor, Icon] = map[tone];
  return (
    <div className={clsx('flex gap-2.5 rounded-xl px-3.5 py-3 text-[13px] ring-1 ring-inset', box, className)}>
      <Icon className={clsx('mt-px size-4 shrink-0', iconColor)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5', 'text-current/85')}>{children}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Skeletons
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton', className)} />;
}

/** Placeholder rows shaped like the table that is loading. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  const widths = ['w-16', 'w-40', 'w-28', 'w-20', 'w-24', 'w-32'];
  return (
    <div className="px-4 py-2" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-slate-100 py-3.5 last:border-b-0" style={{ opacity: 1 - r * 0.1 }}>
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className={clsx('h-3.5', c === 1 ? 'flex-1' : widths[c % widths.length])} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 px-5 py-3.5" style={{ opacity: 1 - r * 0.12 }}>
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/5" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4" aria-hidden>
        <div className="flex-1 space-y-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-2.5 w-28" />
        </div>
        <Skeleton className="size-10 rounded-xl" />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Copy helpers
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      label={done ? 'Copied' : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          toast.error('Could not copy');
        }
      }}
    >
      {done ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
    </IconButton>
  );
}

/** Read-only value with copy (and optional reveal for secrets). */
export function CopyField({ label, value, secret, mono = true }: { label: string; value: string; secret?: boolean; mono?: boolean }) {
  const [shown, setShown] = useState(!secret);
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{label}</div>
      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 py-1 pr-1 pl-3 transition focus-within:border-brand-400 focus-within:bg-white">
        <span className={clsx('min-w-0 flex-1 truncate text-sm text-slate-900', mono && 'font-mono')}>{shown ? value || '—' : '••••••••••••'}</span>
        {secret && (
          <IconButton label={shown ? 'Hide' : 'Show'} onClick={() => setShown(!shown)}>
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </IconButton>
        )}
        <CopyButton value={value} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Tabs & segmented
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={clsx('inline-flex rounded-lg bg-slate-100 p-0.5', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition',
            value === t.value ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className={clsx('rounded px-1 text-[11px] tabular-nums', value === t.value ? 'bg-slate-100 text-slate-600' : 'bg-slate-200/70 text-slate-500')}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Dropdown menu
export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

/** Button that opens a keyboard-navigable menu in a portal. */
export function Menu({ trigger, items, align = 'right' }: { trigger: (props: { open: boolean; onClick: () => void; ref: (el: HTMLElement | null) => void }) => ReactNode; items: MenuItem[]; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, right: 0 });
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const usable = items.filter((i) => !i.disabled);

  useLayoutEffect(() => {
    if (!open) return;
    const r = anchor.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 6, left: r.left, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setOpen(false);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, usable.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        usable[active]?.onSelect?.();
        setOpen(false);
      }
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open, active, usable]);

  return (
    <>
      {trigger({
        open,
        onClick: () => {
          setActive(0);
          setOpen((o) => !o);
        },
        ref: (el) => {
          anchor.current = el;
        },
      })}
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            style={align === 'right' ? { top: pos.top, right: pos.right } : { top: pos.top, left: pos.left }}
            className="animate-pop-in fixed z-[60] min-w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-pop)]"
          >
            {items.map((item, i) => {
              const idx = usable.indexOf(item);
              return (
                <div key={i}>
                  {item.separatorBefore && <div className="my-1.5 h-px bg-slate-100" />}
                  <button
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onMouseEnter={() => idx >= 0 && setActive(idx)}
                    onClick={() => {
                      item.onSelect?.();
                      setOpen(false);
                    }}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition disabled:opacity-40',
                      item.danger ? 'text-rose-600' : 'text-slate-700',
                      idx === active && !item.disabled && (item.danger ? 'bg-rose-50' : 'bg-slate-100'),
                    )}
                  >
                    {item.icon && <span className={clsx('shrink-0', item.danger ? 'text-rose-500' : 'text-slate-400')}>{item.icon}</span>}
                    <span className="flex-1 truncate">{item.label}</span>
                  </button>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

// ------------------------------------------------------------------ Modal
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Keep tabbing inside the dialog.
      if (e.key !== 'Tab' || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the first meaningful field rather than the close button.
    const t = window.setTimeout(() => {
      const nodes = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((n) => n.offsetParent !== null);
      const preferred = nodes.find((n) => n.dataset.autofocus === 'true') ?? nodes.find((n) => n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT') ?? nodes[0];
      preferred?.focus();
    }, 40);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 px-4 py-6 backdrop-blur-[2px] sm:py-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'animate-slide-up w-full rounded-2xl bg-white shadow-[var(--shadow-pop)] ring-1 ring-slate-900/5',
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-xl',
          size === 'lg' && 'max-w-3xl',
          size === 'xl' && 'max-w-5xl',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="sticky bottom-0 flex items-center justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/90 px-6 py-3 backdrop-blur">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ Confirm dialog
interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        size="sm"
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} data-autofocus="true">
              {state?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-slate-600">{state?.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

// ------------------------------------------------------------------ Sparkline & trend
/**
 * Compact trend line for stat tiles: a 2px line over a faint area, no axes.
 * The tile's own number carries the value, so this only needs to read as a shape.
 */
export function Sparkline({
  data,
  className,
  label,
  tone = 'brand',
}: {
  data: number[];
  className?: string;
  label?: string;
  tone?: 'brand' | 'blue' | 'violet' | 'amber';
}) {
  const w = 96;
  const h = 30;
  const stroke = { brand: '#0c8c80', blue: '#0284c7', violet: '#7c3aed', amber: '#d97706' }[tone];
  const { line, area, last } = useMemo(() => {
    if (data.length < 2) return { line: '', area: '', last: null as null | [number, number] };
    const max = Math.max(...data, 1);
    const step = w / (data.length - 1);
    const pts = data.map((v, i) => [i * step, h - 2 - (v / max) * (h - 5)] as [number, number]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return { line: d, area: `${d} L${w} ${h} L0 ${h} Z`, last: pts[pts.length - 1]! };
  }, [data]);
  if (!line) return null;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={clsx('h-7 w-24 overflow-visible', className)} role="img" aria-label={label ?? 'Trend for the last 14 days'} preserveAspectRatio="none">
      <path d={area} fill={stroke} opacity="0.1" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      {last && <circle cx={last[0]} cy={last[1]} r="2.5" fill={stroke} />}
    </svg>
  );
}

/** Day-over-day delta pill. `good` says which direction is positive. */
export function Trend({ value, previous, good = 'up', suffix = '' }: { value: number; previous: number; good?: 'up' | 'down'; suffix?: string }) {
  if (previous === 0 && value === 0) return <span className="text-xs text-slate-400">No change</span>;
  const delta = previous === 0 ? 100 : Math.round(((value - previous) / previous) * 100);
  if (delta === 0) return <span className="text-xs text-slate-400">Same as yesterday</span>;
  const up = delta > 0;
  const positive = good === 'up' ? up : !up;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-medium', positive ? 'text-emerald-600' : 'text-rose-600')}>
      <Icon className="size-3.5" />
      {Math.abs(delta)}
      {suffix || '%'}
      <span className="font-normal text-slate-400">vs yesterday</span>
    </span>
  );
}

// ------------------------------------------------------------------ Stat tile
export function Stat({
  label,
  value,
  sub,
  icon,
  tone = 'brand',
  series,
  footer,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: 'brand' | 'blue' | 'violet' | 'amber';
  series?: number[];
  footer?: ReactNode;
}) {
  const toneClass = {
    brand: 'bg-brand-50 text-brand-600',
    blue: 'bg-sky-50 text-sky-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  }[tone];
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{value}</p>
          {sub && <p className="mt-1 truncate text-xs text-slate-500">{sub}</p>}
        </div>
        {icon && <div className={clsx('flex size-10 shrink-0 items-center justify-center rounded-xl', toneClass)}>{icon}</div>}
      </div>
      {(series?.some((n) => n > 0) || footer) && (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">{footer}</div>
          {series?.some((n) => n > 0) && <Sparkline data={series} tone={tone} label={`${label}: 14-day trend`} />}
        </div>
      )}
    </Card>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h4 className={clsx('mb-3 text-[11px] font-semibold tracking-wider text-slate-500 uppercase', className)}>{children}</h4>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

// ------------------------------------------------------------------ Sortable table helpers
export type SortDir = 'asc' | 'desc';

/** Column sorting state plus a comparator-driven sort, kept in one hook. */
export function useSort<T>(initial: { key: keyof T & string; dir?: SortDir } | null = null) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(initial ? { key: initial.key, dir: initial.dir ?? 'asc' } : null);
  const toggle = useCallback(
    (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' })),
    [],
  );
  const apply = useCallback(
    (rows: T[], pick: (row: T, key: string) => string | number | boolean | null | undefined) => {
      if (!sort) return rows;
      const dir = sort.dir === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const av = pick(a, sort.key);
        const bv = pick(b, sort.key);
        if (av === bv) return 0;
        if (av === null || av === undefined || av === '') return 1;
        if (bv === null || bv === undefined || bv === '') return -1;
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
        return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
      });
    },
    [sort],
  );
  return { sort, toggle, apply };
}

/** Clickable `<th>` that shows the current sort direction. */
export function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  className,
  align = 'left',
}: {
  label: ReactNode;
  sortKey: string;
  sort: { key: string; dir: SortDir } | null;
  onSort: (key: string) => void;
  className?: string;
  align?: 'left' | 'right';
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={clsx('group/th', className)} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={clsx(
          'inline-flex items-center gap-1 rounded transition hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:outline-none',
          align === 'right' && 'flex-row-reverse',
          active && 'text-slate-800',
        )}
      >
        {label}
        {active ? (
          sort!.dir === 'asc' ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )
        ) : (
          <ChevronsUpDown className="size-3 text-slate-300 opacity-0 transition group-hover/th:opacity-100" />
        )}
      </button>
    </th>
  );
}

/** Scroll container that keeps table headers pinned. */
export function TableWrap({ children, className, maxHeight = '70vh' }: { children: ReactNode; className?: string; maxHeight?: string }) {
  return (
    <div className={clsx('overflow-auto', className)} style={{ maxHeight }}>
      {children}
    </div>
  );
}

/** Copyable code sample. */
export function CodeBlock({ code, title, className }: { code: string; title?: ReactNode; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={clsx('overflow-hidden rounded-xl bg-ink-950 ring-1 ring-white/10', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-white/5 px-3 py-1.5">
        <span className="font-mono text-[11px] text-slate-400">{title}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            } catch {
              toast.error('Could not copy');
            }
          }}
        >
          {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="dark-scroll max-h-[420px] overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-200">{code}</pre>
    </div>
  );
}
