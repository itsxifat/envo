import { NavLink } from 'react-router';
import clsx from 'clsx';
import { AudioLines, History } from 'lucide-react';

const TABS = [
  { to: '/calls', label: 'Call history', icon: History },
  { to: '/recordings', label: 'Recordings', icon: AudioLines },
];

/** Switches between the two views of past calls. */
export function CallsNav() {
  return (
    <nav aria-label="Call history" className="inline-flex rounded-full bg-slate-100 p-1 max-sm:[&>a]:flex-1 max-sm:[&>a]:justify-center">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition',
              isActive ? 'bg-white text-slate-950 shadow-[0_1px_3px_rgb(0_0_0/0.1)] ring-1 ring-black/[0.04]' : 'text-slate-500 hover:text-slate-900',
            )
          }
        >
          <t.icon className="size-3.5" />
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
