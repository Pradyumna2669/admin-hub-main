import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { playNotificationSound } from '@/lib/notificationSound';
import { findBlockedChatTerm, getDeletedMessageLabel } from '@/lib/chatModeration';
import { useToast } from '@/hooks/use-toast';
import { sendChatPush } from '@/lib/chatPush';
import { ArrowLeft, Bell, Menu, Trash2 } from 'lucide-react';
import { DiscordMessageRow } from '@/components/chat/DiscordMessageRow';
import { LeagueBadge } from '@/components/badges/LeagueBadge';
import { computeLeagueFromProfile, normalizeLeague } from '@/lib/workerLeagues';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { DashboardLayout } from '@/components/layout/DashboardLayout';

// Use a constant UUID for staff (must match the one in your DB)
const STAFF_UUID = "00000000-0000-0000-0000-000000000001";

const usernameFromEmail = (email: string | null | undefined) => {
  const raw = (email || '').split('@')[0] || 'user';
  return raw.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
};

const hasMention = (content: string, username: string | null) => {
  const text = (content || '').toLowerCase();
  if (!username) return false;
  return text.includes(`@${username}`);
};

interface ChatUser {
  user_id: string;
  full_name: string;
  reddit_username: string;
  is_banned?: boolean | null;
  karma?: number | null;
  karma_range?: string | null;
  cqs?: string | null;
  league?: string | null;
  avatar_url?: string | null;
}

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
}

const mergeMessages = (prev: Message[], next: Message) => {
  if (prev.some((message) => message.id === next.id)) {
    return prev;
  }

  return [...prev, next].sort(
    (a, b) =>
      new Date(a.created_at).getTime() -
      new Date(b.created_at).getTime()
  );
};

const AdminChatPage: React.FC = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<ChatUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [unreadByUserId, setUnreadByUserId] = useState<Record<string, number>>({});
  const [mentionsByUserId, setMentionsByUserId] = useState<Record<string, number>>({});
  const [lastMessageAtByUserId, setLastMessageAtByUserId] = useState<Record<string, string>>({});
  const [chatListOpen, setChatListOpen] = useState(false);
  const { user, userRole } = useAuth();
  const { toast } = useToast();
  const adminId = user?.id || '';
  const adminName = user?.user_metadata?.full_name || user?.email || 'Admin';
  const adminUsername = usernameFromEmail(user?.email);
  const selectedUserId = selectedUser?.user_id || '';
  const [previewUser, setPreviewUser] = useState<ChatUser | null>(null);
  const backPath = userRole === 'moderator' ? '/admin/tasks' : '/admin';

  const totalUnread = Object.values(unreadByUserId).reduce((a, b) => a + (b || 0), 0);
  const totalMentions = Object.values(mentionsByUserId).reduce((a, b) => a + (b || 0), 0);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredUsers = users.filter((chatUser) => {
    if (!normalizedSearchQuery) return true;

    return [chatUser.full_name, chatUser.reddit_username]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedSearchQuery));
  });
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const mentionDiff = (mentionsByUserId[b.user_id] || 0) - (mentionsByUserId[a.user_id] || 0);
    if (mentionDiff !== 0) return mentionDiff;

    const unreadDiff = (unreadByUserId[b.user_id] || 0) - (unreadByUserId[a.user_id] || 0);
    if (unreadDiff !== 0) return unreadDiff;

    const lastMessageDiff =
      new Date(lastMessageAtByUserId[b.user_id] || 0).getTime() -
      new Date(lastMessageAtByUserId[a.user_id] || 0).getTime();
    if (lastMessageDiff !== 0) return lastMessageDiff;

    return (a.full_name || a.reddit_username || '').localeCompare(
      b.full_name || b.reddit_username || '',
      undefined,
      { sensitivity: 'base' }
    );
  });

  useEffect(() => {
    // Fetch all workers except staff
    supabase
      .from('profiles')
      .select('user_id, full_name, reddit_username, is_banned, karma, karma_range, cqs, league, avatar_url')
      .then(({ data }) => {
        // Filter out the staff user by UUID
        const filtered = (data || []).filter(u => u.user_id !== STAFF_UUID);
        setUsers(filtered);
      });
  }, []);

  useEffect(() => {
    if (!selectedUser) return;

    const markSelectedConversationRead = async () => {
      if (!adminId) return;
      const lastReadAt = new Date().toISOString();
      await supabase
        .from('chat_reads')
        .upsert({
          reader_id: adminId,
          peer_id: selectedUser.user_id,
          last_read_at: lastReadAt,
          updated_at: new Date().toISOString(),
        });
      window.dispatchEvent(
        new CustomEvent('chat-read-updated', {
          detail: {
            scope: 'direct',
            peerId: selectedUser.user_id,
            lastReadAt,
          },
        })
      );

      setUnreadByUserId((s) => ({ ...s, [selectedUser.user_id]: 0 }));
      setMentionsByUserId((s) => ({ ...s, [selectedUser.user_id]: 0 }));
    };

    void markSelectedConversationRead();

    // Fetch all messages where the selected user is either sender or receiver, and the other party is STAFF_UUID
    supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${STAFF_UUID},receiver_id.eq.${selectedUser.user_id}),and(sender_id.eq.${selectedUser.user_id},receiver_id.eq.${STAFF_UUID})`)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages((data || []) as Message[]));
  }, [selectedUser]);

  useEffect(() => {
    if (!adminId) return;

    // Load existing read markers for this admin
    supabase
      .from('chat_reads')
      .select('peer_id, last_read_at')
      .eq('reader_id', adminId)
      .then(async ({ data }) => {
        const lastReadByPeer: Record<string, string> = {};
        for (const r of data || []) lastReadByPeer[(r as any).peer_id] = (r as any).last_read_at;

        // Load recent worker->staff messages to compute unread dots
        const { data: recent } = await supabase
          .from('messages')
          .select('sender_id, receiver_id, created_at, content')
          .or(`sender_id.eq.${STAFF_UUID},receiver_id.eq.${STAFF_UUID}`)
          .order('created_at', { ascending: false })
          .limit(2000);

        const unread: Record<string, number> = {};
        const mentions: Record<string, number> = {};
        const lastMessageAt: Record<string, string> = {};
        for (const m of recent || []) {
          const senderId = (m as any).sender_id as string;
          const receiverId = (m as any).receiver_id as string;
          const createdAt = (m as any).created_at as string;
          const content = (m as any).content as string;
          const peerId = senderId === STAFF_UUID ? receiverId : senderId;

          if (peerId && !lastMessageAt[peerId]) {
            lastMessageAt[peerId] = createdAt;
          }

          if (receiverId !== STAFF_UUID || senderId === STAFF_UUID) continue;

          const lastRead = lastReadByPeer[senderId];
          if (!lastRead || new Date(createdAt).getTime() > new Date(lastRead).getTime()) {
            unread[senderId] = (unread[senderId] || 0) + 1;
            if (hasMention(content, adminUsername)) mentions[senderId] = (mentions[senderId] || 0) + 1;
          }
        }

        setUnreadByUserId(unread);
        setMentionsByUserId(mentions);
        setLastMessageAtByUserId(lastMessageAt);
      });
  }, [adminId, adminUsername]);

  useEffect(() => {
    // Subscribe once to new messages for unread + live updates
    const channel = supabase
      .channel('realtime:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const msg = payload.new as Message;

        const peerId =
          msg.sender_id === STAFF_UUID ? msg.receiver_id :
          msg.receiver_id === STAFF_UUID ? msg.sender_id :
          null;

        if (!peerId) return;

        const isForSelected =
          selectedUserId &&
          ((msg.sender_id === STAFF_UUID && msg.receiver_id === selectedUserId) ||
            (msg.sender_id === selectedUserId && msg.receiver_id === STAFF_UUID));

        if (isForSelected) {
          setMessages((prev) => mergeMessages(prev, msg));
          setLastMessageAtByUserId((state) => ({ ...state, [peerId]: msg.created_at }));

          // Mark as read when viewing this conversation
          if (adminId) {
            await supabase.from('chat_reads').upsert({
              reader_id: adminId,
              peer_id: selectedUserId,
              last_read_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            window.dispatchEvent(
              new CustomEvent('chat-read-updated', {
                detail: {
                  scope: 'direct',
                  peerId: selectedUserId,
                },
              })
            );
          }

          // Play sound only for inbound messages from worker
          if (msg.sender_id !== STAFF_UUID && document.visibilityState === 'visible') {
            playNotificationSound();
          }

          return;
        }

        // Not currently open: count as unread if worker -> staff
        setLastMessageAtByUserId((state) => ({ ...state, [peerId]: msg.created_at }));
        if (msg.receiver_id === STAFF_UUID && msg.sender_id !== STAFF_UUID) {
          setUnreadByUserId((s) => ({ ...s, [msg.sender_id]: (s[msg.sender_id] || 0) + 1 }));
          if (hasMention(msg.content, adminUsername)) {
            setMentionsByUserId((s) => ({ ...s, [msg.sender_id]: (s[msg.sender_id] || 0) + 1 }));
          }
          if (document.visibilityState === 'visible') playNotificationSound();
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, async (payload) => {
        const msg = payload.new as Message;
        const isForSelected =
          selectedUserId &&
          ((msg.sender_id === STAFF_UUID && msg.receiver_id === selectedUserId) ||
            (msg.sender_id === selectedUserId && msg.receiver_id === STAFF_UUID));

        if (!isForSelected) return;

        setMessages((prev) =>
          prev.map((message) => (message.id === msg.id ? { ...message, ...msg } : message))
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [adminId, selectedUserId, adminUsername]);

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedUser || !adminId) return;
    const blockedTerm = findBlockedChatTerm(newMessage);
    if (blockedTerm) {
      toast({
        title: 'Message blocked',
        description: `The message contains restricted content: "${blockedTerm}".`,
        variant: 'destructive',
      });
      return;
    }
    // Prefix message with admin name for audit (could use a new column if schema allows)
    const contentWithAdmin = `[${adminName}] ${newMessage}`;
    const { data, error } = await supabase
      .from('messages')
      .insert({
        sender_id: STAFF_UUID,
        receiver_id: selectedUser.user_id,
        content: contentWithAdmin,
      })
      .select('*')
      .single();

    if (error) {
      console.error('Send message error:', error);
      return;
    }

    if (data) {
      setMessages((prev) => mergeMessages(prev, data as Message));
      setLastMessageAtByUserId((state) => ({
        ...state,
        [selectedUser.user_id]: (data as Message).created_at,
      }));
      await sendChatPush((data as Message).id, 'direct');
    }

    setNewMessage('');
  };

  const deleteMessage = async (messageId: string) => {
    const reason = window.prompt('Reason for deleting this message?') || '';
    const { data, error } = await supabase.rpc('delete_direct_message', {
      p_message_id: messageId,
      p_reason: reason.trim() || null,
    });

    if (error) {
      toast({
        title: 'Delete failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    if (data) {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === (data as Message).id ? { ...message, ...(data as Message) } : message
        )
      );
    }
  };

  const chatList = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-muted px-4 py-3">
        <h2 className="font-bold text-lg">Chats</h2>
        <div className="relative">
          <Bell className="h-5 w-5 text-muted-foreground" />
          {totalMentions > 0 ? (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />
          ) : totalUnread > 0 ? (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-muted-foreground/80" />
          ) : null}
        </div>
      </div>
      <div className="border-b bg-muted px-4 py-3">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search people..."
          aria-label="Search chats"
          className="bg-background"
        />
      </div>
      <div className="flex-1 overflow-y-auto bg-muted p-4">
        {sortedUsers.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 bg-background/40 p-4 text-sm text-muted-foreground">
            No people match your search.
          </div>
        ) : sortedUsers.map((chatUser) => (
          <button
            key={chatUser.user_id}
            type="button"
            className={`mb-2 w-full rounded p-3 text-left ${selectedUser?.user_id === chatUser.user_id ? 'bg-primary/10' : 'bg-background/50'}`}
            onClick={() => {
              setSelectedUser(chatUser);
              setChatListOpen(false);
            }}
          >
            <div className="font-semibold flex items-center justify-between gap-2">
              <span className="truncate">{chatUser.full_name}</span>
              {(mentionsByUserId[chatUser.user_id] || 0) > 0 ? (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] h-5 min-w-5 px-1">
                  {Math.min(99, mentionsByUserId[chatUser.user_id] || 0)}
                </span>
              ) : (unreadByUserId[chatUser.user_id] || 0) > 0 ? (
                <span className="ml-2 inline-flex items-center justify-center rounded-full bg-background text-foreground border border-border text-[10px] h-5 min-w-5 px-1">
                  {Math.min(99, unreadByUserId[chatUser.user_id] || 0)}
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <LeagueBadge
                league={
                  normalizeLeague(chatUser.league) ||
                  computeLeagueFromProfile({
                    karma: chatUser.karma ?? null,
                    karmaRange: chatUser.karma_range ?? null,
                    cqs: chatUser.cqs ?? null,
                  })
                }
                showLabel
                className="bg-background/60"
              />
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Avatar className="h-6 w-6 border border-border/60 bg-muted/30">
                {chatUser.avatar_url ? <AvatarImage src={chatUser.avatar_url} alt={chatUser.full_name} /> : null}
                <AvatarFallback className="text-[10px] font-semibold">
                  {(chatUser.full_name?.charAt(0)?.toUpperCase() || 'U') + '.'}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{chatUser.reddit_username}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
    <DashboardLayout mainClassName="p-0">
    <div className="flex h-full min-h-[calc(100dvh-2rem)] flex-col">
      <div className="border-b p-3 bg-card flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(backPath)}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="font-semibold">Direct Messages</div>
        {isMobile ? (
          <Button variant="outline" size="sm" onClick={() => setChatListOpen(true)}>
            <Menu className="h-4 w-4 mr-2" />
            Chats
          </Button>
        ) : (
          <div />
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {!isMobile ? <div className="w-80 border-r min-h-0">{chatList}</div> : null}
        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="border-b p-4 font-bold text-lg bg-card">
            {selectedUser ? (
              <>
                {selectedUser.full_name}
                <div className="text-xs text-muted-foreground">{selectedUser.reddit_username}</div>
              </>
            ) : (
              'Select a chat'
            )}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="p-3 space-y-0.5">
              {!selectedUser ? (
                <div className="flex min-h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                  {isMobile ? 'Open Chats to pick a conversation.' : 'Select a chat to start messaging.'}
                </div>
              ) : null}
              {messages.map((msg, idx) => {
              // Extract admin name if present
              let displayContent: React.ReactNode = msg.deleted_at
                ? getDeletedMessageLabel(msg.deleted_reason)
                : msg.content;
              let senderLabel = selectedUser?.full_name || 'Tasker';
              let role: 'staff' | 'worker' = 'worker';
              const adminNameMatch = msg.deleted_at ? null : msg.content.match(/^\[(.*?)\]\s/);
              if (adminNameMatch) {
                senderLabel = adminNameMatch[1];
                displayContent = msg.content.replace(/^\[.*?\]\s/, '');
                role = 'staff';
              }
              if (msg.sender_id === STAFF_UUID) role = 'staff';

              const mentioned =
                !msg.deleted_at &&
                msg.sender_id !== STAFF_UUID &&
                typeof displayContent === 'string' &&
                hasMention(displayContent, adminUsername);
              const prev = idx > 0 ? messages[idx - 1] : null;
              const compact =
                !!prev &&
                prev.sender_id === msg.sender_id &&
                new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;
              return (
                <DiscordMessageRow
                  key={msg.id}
                  avatarText={senderLabel}
                  displayName={senderLabel}
                  role={role}
                  league={
                    role === 'worker' && selectedUser
                      ? normalizeLeague(selectedUser.league) ||
                        computeLeagueFromProfile({
                          karma: selectedUser.karma ?? null,
                          karmaRange: selectedUser.karma_range ?? null,
                          cqs: selectedUser.cqs ?? null,
                        })
                      : null
                  }
                  avatarUrl={
                    role === 'worker' && selectedUser
                      ? selectedUser.avatar_url || null
                      : null
                  }
                  onContextProfile={() => role === 'worker' && selectedUser && setPreviewUser(selectedUser)}
                  timestamp={new Date(msg.created_at).toLocaleTimeString()}
                  highlighted={mentioned}
                  compact={compact}
                  content={displayContent}
                  actions={
                    !msg.deleted_at ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        onClick={() => deleteMessage(msg.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null
                  }
                />
              );
            })}
            </div>
          </div>
          {selectedUser && (
            <div className="p-4 border-t flex gap-2">
              <Input
                className="flex-1"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              />
              <Button onClick={sendMessage}>Send</Button>
            </div>
          )}
        </div>
      </div>
    </div>
    </DashboardLayout>
    <Sheet open={chatListOpen} onOpenChange={setChatListOpen}>
      <SheetContent side="left" className="w-[88vw] max-w-sm p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Chat list</SheetTitle>
        </SheetHeader>
        {chatList}
      </SheetContent>
    </Sheet>
    <Dialog open={!!previewUser} onOpenChange={(o) => !o && setPreviewUser(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>User Profile</DialogTitle>
          <DialogDescription className="sr-only">
            View the selected worker profile summary.
          </DialogDescription>
        </DialogHeader>
        {previewUser && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border border-border/60 bg-muted/20">
                {previewUser.avatar_url ? (
                  <AvatarImage src={previewUser.avatar_url} alt={previewUser.full_name} />
                ) : null}
                <AvatarFallback className="font-semibold">
                  {(previewUser.full_name?.charAt(0)?.toUpperCase() || 'U') + '.'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{previewUser.full_name}</div>
                <div className="text-xs text-muted-foreground truncate">@{previewUser.reddit_username}</div>
                <div className="flex items-center gap-2 mt-1">
                  <LeagueBadge
                    league={
                      normalizeLeague(previewUser.league) ||
                      computeLeagueFromProfile({
                        karma: previewUser.karma ?? null,
                        karmaRange: previewUser.karma_range ?? null,
                        cqs: previewUser.cqs ?? null,
                      })
                    }
                    showLabel
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>Karma: {previewUser.karma ?? '-'}</div>
              <div>CQS: {previewUser.cqs ?? '-'}</div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
};

export default AdminChatPage;

// Profile preview dialog
// Placed after export default in same file for simplicity
// (Not using extra component file to keep context local)

