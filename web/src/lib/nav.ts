import type { ComponentType } from 'react';
import {
  Activity,
  Building2,
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
import type { Role } from './types';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  roles?: Role[];
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
      { to: '/live', label: 'Live calls', icon: Activity, roles: ['superadmin', 'admin'], keywords: 'active channels monitor spy whisper barge' },
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
      { to: '/servers', label: 'SIP servers', icon: Building2, roles: ['superadmin'], keywords: 'tenants multi tenant pbx instance' },
      { to: '/users', label: 'Users', icon: UserRound, roles: ['superadmin', 'admin'], keywords: 'logins roles admin agent password' },
      { to: '/developers', label: 'Developers', icon: Code2, roles: ['superadmin', 'admin'], keywords: 'api keys webhooks embed widget integration commerce' },
      { to: '/system', label: 'System', icon: Settings, roles: ['superadmin'], keywords: 'health asterisk modules audit backup settings' },
    ],
  },
];

/** Flat, role-filtered list of navigable pages. */
export function navFor(role: Role): NavItem[] {
  return NAV.flatMap((g) => g.items).filter((i) => !i.roles || i.roles.includes(role));
}
