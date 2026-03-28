import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import {
  LayoutDashboard,
  ClipboardList,
  Link2,
  Users,
  Activity,
  LogOut,
  Sparkles,
  FolderOpen,
  Briefcase,
  CheckCircle2,
  IndianRupee,
  MessageCircle,
  Hash,
  Upload,
  ReceiptText,
  UserCog,
  User,
  Settings,
  Video,
  Gamepad2,
  BarChart3,
  Wallet,
  ShoppingBag,
} from 'lucide-react';
import logo from '@/assets/logo.jpg';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

type ChatReadUpdatedDetail = {
  peerId?: string;
  scope?: 'direct' | 'general';
  lastReadAt?: string;
};

const STAFF_UUID = "00000000-0000-0000-0000-000000000001";
const GENERAL_ROOM = "general";

type ChatDirectoryRow = {
  user_id: string;
  full_name: string | null;
  reddit_username: string | null;
  avatar_url?: string | null;
  role: 'owner' | 'admin' | 'moderator' | 'worker' | 'client' | null;
};

const usernameFromProfile = (p: { reddit_username?: string | null; full_name?: string | null; email?: string | null }) => {
  const raw =
    p.reddit_username?.trim() ||
    p.full_name?.trim()?.replace(/\s+/g, '') ||
    p.email?.split('@')[0] ||
    'user';
  return raw.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
};

const hasUserMention = (content: string, username: string | null) => {
  const text = (content || '').toLowerCase();
  if (!username) return false;
  return text.includes(`@${username}`);
};

const hasRoleMention = (content: string, role: 'owner' | 'admin') => {
  const text = (content || '').toLowerCase();
  return text.includes(`@${role}`);
};

const hasEveryoneMention = (content: string) => {
  const text = (content || '').toLowerCase();
  return text.includes('@everyone');
};

const isMentionForUser = (
  content: string,
  username: string | null,
  selfRole: 'owner' | 'admin' | 'moderator' | 'worker' | 'client' | null,
  opts?: { everyoneEnabled?: boolean }
) => {
  if (opts?.everyoneEnabled && hasEveryoneMention(content)) return true;
  if (selfRole === 'owner' && hasRoleMention(content, 'owner')) return true;
  if ((selfRole === 'owner' || selfRole === 'admin' || selfRole === 'moderator') && hasRoleMention(content, 'admin')) return true;
  return hasUserMention(content, username);
};

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
}) => {
  const { signOut, user, userRole } = useAuth();
  const navigate = useNavigate();
  const [directUnreadCount, setDirectUnreadCount] = useState(0);
  const [directMentionCount, setDirectMentionCount] = useState(0);
  const [generalUnreadCount, setGeneralUnreadCount] = useState(0);
  const [generalMentionCount, setGeneralMentionCount] = useState(0);
  const [pendingWorkerVerificationCount, setPendingWorkerVerificationCount] = useState(0);
  const [pendingTaskVerificationCount, setPendingTaskVerificationCount] = useState(0);
  const [pendingPaymentsCount, setPendingPaymentsCount] = useState(0);
  const [selfChatUsername, setSelfChatUsername] = useState<string | null>(null);
  const [directReadAtOverride, setDirectReadAtOverride] = useState<string | null>(null);
  const directReadOverrideKey = user?.id ? `chat_read_override:${user.id}:${STAFF_UUID}` : null;

  useEffect(() => {
    if (!user?.id) return;
    if (!(userRole === 'admin' || userRole === 'owner' || userRole === 'moderator' || userRole === 'worker')) return;

    let cancelled = false;

    if (directReadOverrideKey && directReadAtOverride === null) {
      const stored = window.localStorage.getItem(directReadOverrideKey);
      if (stored) setDirectReadAtOverride(stored);
    }

    const refresh = async () => {
      try {
        // self username for mention detection
        if (!selfChatUsername) {
          const { data: p } = await supabase
            .from('profiles')
            .select('full_name, reddit_username, email')
            .eq('user_id', user.id)
            .maybeSingle();

          const u = p
            ? usernameFromProfile(p as unknown as { full_name?: string | null; reddit_username?: string | null; email?: string | null })
            : user.email
              ? usernameFromProfile({ email: user.email })
              : null;
          if (!cancelled) setSelfChatUsername(u);
        }

        // General chat counts (unread vs mentions)
        {
          const { data: readRowRaw, error: readsErr } = await supabase
            .from('group_chat_reads')
            .select('last_read_at')
            .eq('reader_id', user.id)
            .eq('room', GENERAL_ROOM)
            .maybeSingle();

          if (readsErr && (readsErr as any)?.code === 'PGRST205') {
            if (!cancelled) {
              setGeneralUnreadCount(0);
              setGeneralMentionCount(0);
            }
          } else {
          const readRow = (readRowRaw as unknown as { last_read_at: string | null } | null) || null;
          const lastReadAtFromDb = readRow?.last_read_at ?? undefined;
          const lastReadAt = lastReadAtFromDb;

           const q = supabase
             .from('group_messages')
             .select('sender_id, created_at, content')
             .eq('room', GENERAL_ROOM)
             .order('created_at', { ascending: false });

           const query =
             lastReadAt
               ? q.gt('created_at', lastReadAt).limit(200)
               : q.limit(200);

           const { data: recent, error: msgsErr } = await query;

          if (msgsErr && (msgsErr as any)?.code === 'PGRST205') {
            if (!cancelled) {
              setGeneralUnreadCount(0);
              setGeneralMentionCount(0);
            }
          } else {
          const mineId = user.id;
           const unreadMsgs = ((recent ?? []) as Array<{ sender_id: string; created_at: string; content: string }>).filter(
            (m) =>
              m.sender_id !== mineId &&
              (!lastReadAt || new Date(m.created_at).getTime() > new Date(lastReadAt).getTime())
          );

           const needSenderRoles = unreadMsgs.some((m) => hasEveryoneMention(m.content));
           let senderCanEveryoneById: Record<string, boolean> = {};
           if (needSenderRoles) {
             const senderIds = new Set(unreadMsgs.map((m) => m.sender_id).filter(Boolean));
             const { data: directoryRows, error: directoryError } = await supabase.rpc('list_chat_directory');
             if (!directoryError) {
               for (const row of (directoryRows ?? []) as ChatDirectoryRow[]) {
                 if (!senderIds.has(row.user_id)) continue;
                 senderCanEveryoneById[row.user_id] = row.role === 'owner' || row.role === 'admin' || row.role === 'moderator';
               }
             }
           }

           const mention = unreadMsgs.filter((m) =>
             isMentionForUser(m.content, selfChatUsername, userRole, { everyoneEnabled: !!senderCanEveryoneById[m.sender_id] })
           ).length;
           if (!cancelled) {
             setGeneralUnreadCount(unreadMsgs.length);
             setGeneralMentionCount(mention);
           }
          }
          }
        }

        if (userRole === 'worker') {
          const { data: readRowRaw } = await supabase
            .from('chat_reads')
            .select('last_read_at')
            .eq('reader_id', user.id)
            .eq('peer_id', STAFF_UUID)
            .maybeSingle();

          const readRow = (readRowRaw as unknown as { last_read_at: string | null } | null) || null;
          const lastReadAt = readRow?.last_read_at ?? undefined;

          const { data: recent } = await supabase
            .from('messages')
            .select('created_at, content')
            .eq('sender_id', STAFF_UUID)
            .eq('receiver_id', user.id)
            .order('created_at', { ascending: false })
            .limit(200);

          const unreadMsgs =
            ((recent ?? []) as Array<{ created_at: string; content: string }>).filter(
              (m) => !lastReadAt || new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()
            );

           const mention = unreadMsgs.filter((m) => isMentionForUser(m.content, selfChatUsername, userRole)).length;

          if (!cancelled) {
            setDirectUnreadCount(unreadMsgs.length || 0);
            setDirectMentionCount(mention || 0);
          }
          return;
        }

        // admin/owner: unread = worker->staff messages newer than last read per worker
        const { data: readsRaw } = await supabase
          .from('chat_reads')
          .select('peer_id, last_read_at')
          .eq('reader_id', user.id);

        const reads = (readsRaw ?? []) as Array<{ peer_id: string; last_read_at: string | null }>;
        const lastReadByPeer: Record<string, string> = {};
        for (const r of reads) {
          if (r.peer_id && r.last_read_at) lastReadByPeer[r.peer_id] = r.last_read_at;
        }

        const { data: recent } = await supabase
          .from('messages')
          .select('sender_id, created_at, content')
          .eq('receiver_id', STAFF_UUID)
          .order('created_at', { ascending: false })
          .limit(500);

        let totalUnread = 0;
        let totalMentions = 0;
        for (const m of (recent ?? []) as Array<{ sender_id: string; created_at: string; content: string }>) {
          const senderId = m.sender_id;
          const createdAt = m.created_at;
          const lastReadAt = lastReadByPeer[senderId];
          const unread = !lastReadAt || new Date(createdAt).getTime() > new Date(lastReadAt).getTime();
          if (unread) {
            totalUnread++;
            if (isMentionForUser(m.content, selfChatUsername, userRole)) totalMentions++;
          }
        }

        if (!cancelled) {
          setDirectUnreadCount(totalUnread);
          setDirectMentionCount(totalMentions);
        }
      } catch {
        if (!cancelled) {
          setDirectUnreadCount(0);
          setDirectMentionCount(0);
          setGeneralUnreadCount(0);
          setGeneralMentionCount(0);
        }
      }
    };

    refresh();
    const id = window.setInterval(refresh, 15_000);
      const onChatReadUpdated = (event: Event) => {
        const customEvent = event as CustomEvent<ChatReadUpdatedDetail>;
        const peerId = customEvent.detail?.peerId;
        const scope = customEvent.detail?.scope;
        const lastReadAt = customEvent.detail?.lastReadAt;

        if (scope === 'direct' && peerId) {
          if (userRole === 'worker' && peerId === STAFF_UUID) {
            setDirectUnreadCount(0);
            setDirectMentionCount(0);
            if (lastReadAt) {
              setDirectReadAtOverride(lastReadAt);
              if (directReadOverrideKey) {
                window.localStorage.setItem(directReadOverrideKey, lastReadAt);
              }
            }
          } else {
            refresh();
          }
          return;
        }

        if (scope === 'general') {
          setGeneralUnreadCount(0);
          setGeneralMentionCount(0);
          refresh();
          return;
        }

        refresh();
      };
    window.addEventListener('chat-read-updated', onChatReadUpdated as EventListener);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('chat-read-updated', onChatReadUpdated as EventListener);
    };
  }, [user?.id, userRole, selfChatUsername, user?.email, directReadAtOverride, directReadOverrideKey]);

  useEffect(() => {
    if (!user?.id) return;
    if (!(userRole === 'admin' || userRole === 'owner' || userRole === 'moderator')) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const { data: roles, error: rolesError } = await supabase
          .from('user_roles')
          .select('user_id')
          .eq('role', 'worker');

        if (rolesError) throw rolesError;
        const userIds = (roles ?? [])
          .map((r) => (r as unknown as { user_id?: unknown }).user_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0);
        if (!userIds.length) {
          if (!cancelled) setPendingWorkerVerificationCount(0);
          return;
        }

        // Chunk in case there are many workers (PostgREST URL length limits)
        let pending = 0;
        const chunkSize = 200;
        for (let i = 0; i < userIds.length; i += chunkSize) {
          const chunk = userIds.slice(i, i + chunkSize);
          const { data: accounts, error: accountsError } = await supabase
            .from('reddit_accounts')
            .select('id, user_id, is_verified')
            .in('user_id', chunk)
            .or('is_verified.is.null,is_verified.eq.false');

          if (accountsError) throw accountsError;
          pending += (accounts || []).length;
        }

        if (!cancelled) setPendingWorkerVerificationCount(pending);
      } catch {
        if (!cancelled) setPendingWorkerVerificationCount(0);
      }
    };

    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user?.id, userRole]);

  useEffect(() => {
    if (!user?.id) return;
    if (!(userRole === 'admin' || userRole === 'owner' || userRole === 'moderator')) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const { count, error } = await supabase
          .from('task_assignments')
          .select('id', { count: 'exact', head: true })
          .eq('payment_status', 'pending')
          .or('status.eq.completed,is_removal.eq.true');

        if (error) throw error;

        if (!cancelled) {
          setPendingPaymentsCount(count || 0);
        }
      } catch {
        if (!cancelled) {
          setPendingPaymentsCount(0);
        }
      }
    };

    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user?.id, userRole]);

  useEffect(() => {
    if (!user?.id) return;
    if (!(userRole === 'admin' || userRole === 'owner' || userRole === 'moderator')) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const { count, error } = await supabase
          .from('task_submissions')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');

        if (error) throw error;

        if (!cancelled) {
          setPendingTaskVerificationCount(count || 0);
        }
      } catch {
        if (!cancelled) {
          setPendingTaskVerificationCount(0);
        }
      }
    };

    refresh();
    const id = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user?.id, userRole]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } finally {
      navigate('/login');
    }
  };

  const adminLinks = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/admin/categories', icon: FolderOpen, label: 'Categories' },
    { to: '/admin/tasks', icon: ClipboardList, label: 'Tasks' },
    { to: '/admin/task-settings', icon: Settings, label: 'Task Settings' },
    { to: '/admin/bulk-import', icon: Upload, label: 'Bulk Import' },
    { to: '/admin/clients', icon: Users, label: 'Clients' },
    { to: '/admin/workers', icon: Briefcase, label: 'Taskers' },
    { to: '/admin/verification', icon: CheckCircle2, label: 'Verification' },
    { to: '/admin/links', icon: Link2, label: 'Links' },
    { to: '/admin/ai-generate', icon: Sparkles, label: 'AI Generate' },
    { to: '/chat/general', icon: Hash, label: 'General Chat' },
    { to: '/admin/chat', icon: MessageCircle, label: 'Chat' },
    { to: '/admin/discussion', icon: Video, label: 'Discussion' },
    { to: '/admin/activity', icon: Activity, label: 'Activity Log' },
    { to: '/admin/payments', icon: IndianRupee, label: 'Payments' },
    { to: '/admin/orders', icon: ShoppingBag, label: 'Orders' },
    { to: '/admin/payment-logs', icon: ReceiptText, label: 'Payment Logs' },
    { to: '/admin/expenses', icon: BarChart3, label: 'Expenses' },
    { to: '/admin/user-management', icon: UserCog, label: 'User Management' },
    { to: '/arcade', icon: Gamepad2, label: 'Arcade' },
    { to: '/profile', icon: User, label: 'Profile' },
  ];

  const clientLinks = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/dashboard/categories', icon: FolderOpen, label: 'My Categories' },
    { to: '/arcade', icon: Gamepad2, label: 'Arcade' },
    { to: '/chat/general', icon: Hash, label: 'General Chat' },
    { to: '/profile', icon: User, label: 'Profile' },
  ];

  const workerLinks = [
    { to: '/worker/dashboard', icon: LayoutDashboard, label: 'Dashboard', end: true },
    { to: '/worker/tasks', icon: Briefcase, label: 'Available Tasks' },
    { to: '/worker/my-tasks', icon: ClipboardList, label: 'My Tasks' },
    { to: '/arcade', icon: Gamepad2, label: 'Arcade' },
    { to: '/worker/wallet', icon: Wallet, label: 'Wallet' },
    { to: '/chat/general', icon: Hash, label: 'General Chat' },
    { to: '/worker/chat', icon: MessageCircle, label: 'Chat' },
    { to: '/worker/payments', icon: IndianRupee, label: 'Payments' },
    { to: '/profile', icon: User, label: 'Profile' },
  ];

  let links = clientLinks;
  let panelLabel = 'Client Portal';

  if (userRole === 'owner' || userRole === 'admin' || userRole === 'moderator') {
    links = userRole === 'moderator'
      ? adminLinks.filter((link) =>
          link.to !== '/admin' &&
          link.to !== '/admin/orders' &&
          link.to !== '/admin/user-management' &&
          link.to !== '/admin/payment-logs' &&
          link.to !== '/admin/activity'
        )
      : adminLinks;
    panelLabel = 'Admin Panel';
  } else if (userRole === 'worker') {
    links = workerLinks;
    panelLabel = 'Tasker Portal';
  }

  return (
    <>
      {/* Overlay (mobile only) */}
      <div
        className={cn(
          "fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300",
          isOpen ? "opacity-100 visible" : "opacity-0 invisible"
        )}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed md:static top-0 left-0 h-screen w-64 border-r border-slate-200 dark:border-white/5 flex flex-col z-50 transition-transform duration-300 ease-in-out bg-white/50 dark:bg-[#090b14]/50 backdrop-blur-2xl",
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="p-6 border-b border-slate-200 dark:border-white/5">
          <div className="flex items-center gap-3">
            <img
              src={logo}
              alt="StoicOps Logo"
              className="h-10 w-10 rounded-lg object-cover"
            />
            <div>
              <h1 className="text-xl font-semibold">StoicOps</h1>
              <p className="text-xs text-muted-foreground">
                {panelLabel}
              </p>
            </div>
          </div>
        </div>

        {/* Links */}
        <nav className="sidebar-scrollbar flex-1 space-y-1 overflow-y-auto p-4">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium text-sm",
                  isActive
                    ? "bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 shadow-[0_0_15px_rgba(168,85,247,0.15)]"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white"
                )
              }
            >
              <div className="relative">
                <link.icon size={20} />
                {(link.to === '/admin/chat' || link.to === '/worker/chat') && (directMentionCount > 0 || directUnreadCount > 0) && (
                  <span className={cn(
                    "absolute -top-1 -right-1 h-2 w-2 rounded-full",
                    directMentionCount > 0 ? "bg-red-500" : "bg-muted-foreground/80"
                  )} />
                )}
                {link.to === '/admin/workers' && pendingWorkerVerificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
                )}
                {link.to === '/admin/verification' && pendingTaskVerificationCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
                )}
                {link.to === '/admin/payments' && pendingPaymentsCount > 0 && (
                  <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
                )}
                {link.to === '/chat/general' && (generalMentionCount > 0 || generalUnreadCount > 0) && (
                  <span className={cn(
                    "absolute -top-1 -right-1 h-2 w-2 rounded-full",
                    generalMentionCount > 0 ? "bg-red-500" : "bg-muted-foreground/80"
                  )} />
                )}
              </div>
              <span className="flex-1">{link.label}</span>
              {(link.to === '/admin/chat' || link.to === '/worker/chat') && (directMentionCount > 0 || directUnreadCount > 0) && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full text-[10px] h-5 min-w-5 px-1",
                    directMentionCount > 0
                      ? "bg-red-500 text-white"
                      : "bg-background text-foreground border border-border"
                  )}
                >
                  {Math.min(99, directMentionCount > 0 ? directMentionCount : directUnreadCount)}
                </span>
              )}
              {link.to === '/admin/workers' && pendingWorkerVerificationCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] h-5 min-w-5 px-1">
                  {Math.min(99, pendingWorkerVerificationCount)}
                </span>
              )}
              {link.to === '/admin/verification' && pendingTaskVerificationCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] h-5 min-w-5 px-1">
                  {Math.min(99, pendingTaskVerificationCount)}
                </span>
              )}
              {link.to === '/admin/payments' && pendingPaymentsCount > 0 && (
                <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] h-5 min-w-5 px-1">
                  {Math.min(99, pendingPaymentsCount)}
                </span>
              )}
              {link.to === '/chat/general' && (generalMentionCount > 0 || generalUnreadCount > 0) && (
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-full text-[10px] h-5 min-w-5 px-1",
                    generalMentionCount > 0
                      ? "bg-red-500 text-white"
                      : "bg-background text-foreground border border-border"
                  )}
                >
                  {Math.min(99, generalMentionCount > 0 ? generalMentionCount : generalUnreadCount)}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-slate-200 dark:border-white/5">
          <button
            onClick={handleSignOut}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-lg text-slate-600 dark:text-slate-400 hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-all duration-200 text-sm font-medium"
          >
            <LogOut size={20} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
};
