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
  feature?: 'call_monitoring' | 'api_access';
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
  title: string;
  items: NavItem[];
}

const ADMINS: Role[] = ['superadmin', 'admin'];

/** The customer portal. Names say what a thing does for the caller, not what it is called in SIP. */
export const NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview stats' },
      { to: '/get-started', label: 'Get started', icon: Rocket, roles: ADMINS, keywords: 'setup guide wizard onboarding first steps connect number' },
      { to: '/live', label: 'Live calls', icon: Activity, roles: ADMINS, feature: 'call_monitoring', keywords: 'active channels monitor spy whisper barge' },
      { to: '/calls', label: 'Call history', icon: History, keywords: 'cdr call logs history' },
      { to: '/recordings', label: 'Recordings', icon: AudioLines, keywords: 'call recordings audio listen play download retention days left storage' },
      { to: '/voicemail', label: 'Voicemail', icon: Voicemail, keywords: 'messages inbox' },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/extensions', label: 'Extensions & phones', icon: Users, roles: ADMINS, keywords: 'extensions sip accounts users phones desk softphone credentials' },
      { to: '/users', label: 'Team logins', icon: UserRound, roles: ADMINS, keywords: 'team users people logins roles admin agent password invite' },
    ],
  },
  {
    title: 'Incoming calls',
    items: [
      { to: '/numbers', label: 'Phone numbers', icon: Hash, roles: ADMINS, keywords: 'did inbound routing msisdn connect number' },
      { to: '/ivrs', label: 'IVR menus', icon: ListTree, roles: ADMINS, keywords: 'auto attendant press 1 menu greeting' },
      { to: '/ring-groups', label: 'Ring groups', icon: Network, roles: ADMINS, keywords: 'hunt group ring all team everyone' },
      { to: '/queues', label: 'Call queues', icon: Gauge, roles: ADMINS, keywords: 'call center agents hold music queues' },
      { to: '/time-conditions', label: 'Business hours', icon: Clock, roles: ADMINS, keywords: 'time conditions office hours schedule holiday open closed' },
      { to: '/conferences', label: 'Conference rooms', icon: Presentation, roles: ADMINS, keywords: 'meeting bridge room pin' },
      { to: '/sounds', label: 'Greetings & sounds', icon: FileAudio, roles: ADMINS, keywords: 'prompts greetings music on hold tts upload sounds' },
      { to: '/blocked', label: 'Blocked callers', icon: ShieldBan, roles: ADMINS, keywords: 'blacklist spam reject' },
    ],
  },
  {
    title: 'Outgoing calls',
    items: [
      { to: '/trunks', label: 'Phone lines', icon: Server, roles: ADMINS, keywords: 'sip trunks provider iptsp carrier register gateway lines' },
      { to: '/routes', label: 'Calling rules', icon: PhoneOutgoing, roles: ADMINS, keywords: 'outbound routes dial patterns prefix least cost' },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/servers', label: 'SIP servers', icon: Building2, roles: ADMINS, keywords: 'tenants multi tenant pbx instance phone system settings timezone' },
      { to: '/developers', label: 'Developers', icon: Code2, roles: ADMINS, feature: 'api_access', keywords: 'api keys webhooks embed widget integration commerce' },
      { to: '/account', label: 'Plan & usage', icon: Gem, roles: ['admin'], customer: true, keywords: 'package subscription limits upgrade' },
      { to: '/billing', label: 'Billing', icon: CreditCard, roles: ['admin'], customer: true, owner: true, keywords: 'invoice pay payment bkash card renew upgrade package' },
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

/** Navigation groups this user may see: role, package features and customer-only pages applied. */
export function visibleNav(user: User, plan: Plan | null): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i, user, plan)) })).filter((g) => g.items.length > 0);
}

/** Flat list of the pages this user may open. */
export function navFor(user: User, plan: Plan | null): NavItem[] {
  return visibleNav(user, plan).flatMap((g) => g.items);
}
