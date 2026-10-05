import type { ComponentType } from 'react';
import {
  Activity,
  BadgeDollarSign,
  Briefcase,
  CreditCard,
  Mail,
  Receipt,
  Building2,
  Gem,
  Clock,
  Code2,
  FileAudio,
  Gauge,
  Hash,
  History,
  LayoutDashboard,
  ListTree,
  Network,
  Presentation,
  Route,
  Server,
  Settings,
  ShieldBan,
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
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, keywords: 'home overview stats' },
      { to: '/live', label: 'Live calls', icon: Activity, roles: ['superadmin', 'admin'], feature: 'call_monitoring', keywords: 'active channels monitor spy whisper barge' },
      { to: '/calls', label: 'Call logs', icon: History, keywords: 'cdr history recordings' },
      { to: '/voicemail', label: 'Voicemail', icon: Voicemail, keywords: 'messages inbox' },
    ],
  },
  {
    title: 'PBX',
    items: [
      { to: '/extensions', label: 'Extensions', icon: Users, roles: ['superadmin', 'admin'], keywords: 'sip accounts users phones desk softphone credentials' },
      { to: '/numbers', label: 'Phone numbers', icon: Hash, roles: ['superadmin', 'admin'], keywords: 'did inbound routing msisdn' },
      { to: '/ivrs', label: 'IVR menus', icon: ListTree, roles: ['superadmin', 'admin'], keywords: 'auto attendant press 1 menu greeting' },
      { to: '/ring-groups', label: 'Ring groups', icon: Network, roles: ['superadmin', 'admin'], keywords: 'hunt group ring all' },
      { to: '/queues', label: 'Queues', icon: Gauge, roles: ['superadmin', 'admin'], keywords: 'call center agents hold music' },
      { to: '/conferences', label: 'Conference rooms', icon: Presentation, roles: ['superadmin', 'admin'], keywords: 'meeting bridge room pin' },
      { to: '/time-conditions', label: 'Time conditions', icon: Clock, roles: ['superadmin', 'admin'], keywords: 'office hours schedule holiday open closed' },
      { to: '/sounds', label: 'Sounds', icon: FileAudio, roles: ['superadmin', 'admin'], keywords: 'prompts greetings music on hold tts upload' },
      { to: '/blocked', label: 'Blocked callers', icon: ShieldBan, roles: ['superadmin', 'admin'], keywords: 'blacklist spam reject' },
    ],
  },
  {
    title: 'Connectivity',
    items: [
      { to: '/trunks', label: 'SIP trunks', icon: Server, roles: ['superadmin', 'admin'], keywords: 'provider iptsp carrier register gateway' },
      { to: '/routes', label: 'Outbound routes', icon: Route, roles: ['superadmin', 'admin'], keywords: 'dial patterns prefix least cost' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/servers', label: 'SIP servers', icon: Building2, roles: ['superadmin', 'admin'], keywords: 'tenants multi tenant pbx instance' },
      { to: '/users', label: 'Team', icon: UserRound, roles: ['superadmin', 'admin'], keywords: 'users people logins roles admin agent password invite' },
      { to: '/developers', label: 'Developers', icon: Code2, roles: ['superadmin', 'admin'], feature: 'api_access', keywords: 'api keys webhooks embed widget integration commerce' },
      { to: '/account', label: 'Plan & usage', icon: Gem, roles: ['admin'], customer: true, keywords: 'package subscription limits upgrade' },
      { to: '/billing', label: 'Billing', icon: CreditCard, roles: ['admin'], customer: true, owner: true, keywords: 'invoice pay payment bkash card renew upgrade package' },
      { to: '/system', label: 'System', icon: Settings, roles: ['superadmin'], keywords: 'health asterisk modules audit backup settings' },
    ],
  },
  {
    title: 'Business',
    items: [
      { to: '/admin/customers', label: 'Customers', icon: Briefcase, roles: ['superadmin'], keywords: 'accounts clients subscribers tenants companies suspend' },
      { to: '/admin/sales', label: 'Sales', icon: Receipt, roles: ['superadmin'], keywords: 'revenue invoices payments mrr approve bkash sslcommerz' },
      { to: '/admin/packages', label: 'Packages', icon: BadgeDollarSign, roles: ['superadmin'], keywords: 'plans pricing limits price tiers' },
      { to: '/admin/email', label: 'Email', icon: Mail, roles: ['superadmin'], keywords: 'smtp mail notifications verification sender' },
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
