import type { ComponentType } from 'react';
import {
  Activity,
  AudioLines,
  BadgeDollarSign,
  Briefcase,
  Building2,
  Clock,
  Code2,
  CreditCard,
  FileAudio,
  Gauge,
  Gem,
  Hash,
  History,
  Inbox,
  LayoutDashboard,
  ListTree,
  Mail,
  Network,
  PhoneOutgoing,
  Presentation,
  Receipt,
  Rocket,
  ScrollText,
  Server,
  Settings,
  ShieldBan,
  ShieldCheck,
  UserRound,
  Users,
  Voicemail,
} from 'lucide-react';
import type { Plan, Role, User } from './types';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  roles?: Role[];
  /** Shown only when the customer's package includes it. */
  feature?: 'call_monitoring' | 'api_access' | 'recording_days';
  /** Customers only (platform admins have no account of their own). */
  customer?: boolean;
  /** The account owner only. */
  owner?: boolean;
  /** Extra words the command palette should match on. */
  keywords?: string;
  /** Active only on this exact path (index pages). */
  end?: boolean;
}

export interface NavGroup {
  /** '' for the everyday pages at the top, which have no heading. */
  title: string;
  /** Folded away at the bottom of the menu until opened (it opens by itself on one of its pages). */
  collapsible?: boolean;
  items: NavItem[];
}

const ADMINS: Role[] = ['superadmin', 'admin'];

const GET_STARTED = '/get-started';

/**
 * The customer portal. Names say what a thing does for the caller, not what it is called in SIP. The
 * everyday pages come first; everything else is folded into two groups at the bottom.
 */
export const NAV: NavGroup[] = [
  {
    title: '',
    items: [
      { to: GET_STARTED, label: 'Get started', icon: Rocket, roles: ADMINS, keywords: 'setup guide wizard onboarding first steps connect number team' },
      { to: '/', label: 'Home', icon: LayoutDashboard, keywords: 'dashboard overview stats' },
      { to: '/calls', label: 'Call history', icon: History, keywords: 'call history cdr call logs' },
      { to: '/recordings', label: 'Recordings', icon: AudioLines, feature: 'recording_days', keywords: 'call recordings audio listen play download retention days left storage' },
      { to: '/voicemail', label: 'Voicemail', icon: Voicemail, keywords: 'messages inbox' },
      { to: '/numbers', label: 'Phone numbers', icon: Hash, roles: ADMINS, keywords: 'did inbound connect number get a new number buy special number top up recharge balance' },
      { to: '/extensions', label: 'Team & phones', icon: Users, roles: ADMINS, keywords: 'extensions people sip accounts phones desk softphone credentials add a person' },
      { to: '/billing', label: 'Billing', icon: CreditCard, roles: ['admin'], customer: true, owner: true, keywords: 'invoice pay payment bkash card renew upgrade package top-up' },
    ],
  },
  {
    title: 'Call handling',
    collapsible: true,
    items: [
      { to: '/ivrs', label: 'IVR menus', icon: ListTree, roles: ADMINS, keywords: 'call menu auto attendant press 1 greeting' },
      { to: '/ring-groups', label: 'Ring groups', icon: Network, roles: ADMINS, keywords: 'hunt group ring all team everyone' },
      { to: '/queues', label: 'Call queues', icon: Gauge, roles: ADMINS, keywords: 'call center agents hold music queues' },
      { to: '/time-conditions', label: 'Business hours', icon: Clock, roles: ADMINS, keywords: 'time conditions office hours schedule holiday open closed' },
      { to: '/sounds', label: 'Greetings & sounds', icon: FileAudio, roles: ADMINS, keywords: 'prompts greetings music on hold tts upload sounds' },
      { to: '/conferences', label: 'Conference rooms', icon: Presentation, roles: ADMINS, keywords: 'meeting bridge room pin' },
      { to: '/blocked', label: 'Blocked callers', icon: ShieldBan, roles: ADMINS, keywords: 'blacklist spam reject' },
      { to: '/live', label: 'Live calls', icon: Activity, roles: ADMINS, feature: 'call_monitoring', keywords: 'active channels monitor spy whisper barge' },
    ],
  },
  {
    title: 'Settings',
    collapsible: true,
    items: [
      { to: '/users', label: 'Team logins', icon: UserRound, roles: ADMINS, keywords: 'team users people logins roles admin agent password invite' },
      { to: '/trunks', label: 'Phone lines', icon: Server, roles: ADMINS, keywords: 'sip trunks provider iptsp carrier register gateway lines' },
      { to: '/routes', label: 'Calling rules', icon: PhoneOutgoing, roles: ADMINS, keywords: 'outbound routes dial patterns prefix least cost' },
      { to: '/servers', label: 'SIP servers', icon: Building2, roles: ADMINS, keywords: 'tenants multi tenant pbx instance phone system settings timezone' },
      { to: '/account', label: 'Plan & usage', icon: Gem, roles: ['admin'], customer: true, keywords: 'package subscription limits upgrade' },
      { to: '/developers', label: 'Developers', icon: Code2, roles: ADMINS, feature: 'api_access', keywords: 'api keys webhooks embed widget integration commerce' },
    ],
  },
];

/** The support console at /admin (platform admins only). */
export const ADMIN_NAV: NavGroup[] = [
  {
    title: 'Support',
    items: [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, keywords: 'home dashboard attention' },
      { to: '/admin/customers', label: 'Customers', icon: Briefcase, keywords: 'accounts clients subscribers companies suspend open portal' },
      { to: '/admin/number-requests', label: 'Number requests', icon: Inbox, keywords: 'new numbers registration kyc nid icc pool top-up recharge balance' },
      { to: '/admin/live', label: 'Live monitor', icon: Activity, keywords: 'calls now channels hang up' },
      { to: '/admin/lines', label: 'Lines & numbers', icon: Server, keywords: 'trunks registrations provider dids' },
      { to: '/admin/activity', label: 'Activity log', icon: ScrollText, keywords: 'audit history who changed' },
    ],
  },
  {
    title: 'Business',
    items: [
      { to: '/admin/sales', label: 'Sales & invoices', icon: Receipt, keywords: 'revenue invoices payments mrr approve bkash sslcommerz' },
      { to: '/admin/packages', label: 'Packages', icon: BadgeDollarSign, keywords: 'plans pricing limits price tiers' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { to: '/admin/system', label: 'System health', icon: Settings, keywords: 'asterisk modules cli logs settings sip domain' },
      { to: '/admin/billing-settings', label: 'Payments', icon: CreditCard, keywords: 'sslcommerz manual payment settings grace' },
      { to: '/admin/email', label: 'Email', icon: Mail, keywords: 'smtp mail notifications verification sender' },
      { to: '/admin/staff', label: 'Staff', icon: ShieldCheck, keywords: 'platform admins team support' },
    ],
  },
];

function allowed(item: NavItem, user: User, plan: Plan | null): boolean {
  if (item.roles && !item.roles.includes(user.role)) return false;
  if (item.customer && user.accountId === null) return false;
  if (item.owner && !user.isOwner) return false;
  if (item.feature && plan && !plan.limits[item.feature]) return false;
  return true;
}

/**
 * Navigation groups this user may see: role, package features and customer-only pages applied. Once
 * the setup is done, "Get started" leaves the top and waits under Settings as the setup guide.
 */
export function visibleNav(user: User, plan: Plan | null, setupDone = false): NavGroup[] {
  const guide = NAV[0]!.items.find((i) => i.to === GET_STARTED)!;
  const groups = NAV.map((g) => ({
    ...g,
    items: setupDone ? g.items.filter((i) => i !== guide) : g.items,
  }));
  if (setupDone) groups[groups.length - 1]!.items = [...groups[groups.length - 1]!.items, { ...guide, label: 'Setup guide' }];
  return groups.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i, user, plan)) })).filter((g) => g.items.length > 0);
}

/** Flat list of the pages this user may open. */
export function navFor(user: User, plan: Plan | null): NavItem[] {
  return visibleNav(user, plan).flatMap((g) => g.items);
}
