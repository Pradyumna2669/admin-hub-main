import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { playNotificationSound } from '@/lib/notificationSound';
import { findBlockedChatTerm, getDeletedMessageLabel } from '@/lib/chatModeration';
import { useToast } from '@/hooks/use-toast';
import { sendChatPush } from '@/lib/chatPush';
import { ArrowLeft } from 'lucide-react';
import { DiscordMessageRow } from '@/components/chat/DiscordMessageRow';
import { computeLeagueFromProfile, normalizeLeague } from '@/lib/workerLeagues';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LeagueBadge } from '@/components/badges/LeagueBadge';

// Use a constant UUID for staff (must match the one in your DB)
const STAFF_UUID = "00000000-0000-0000-0000-000000000001";

interface Message {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  deleted_at?: string | null;
  deleted_reason?: string | null;
}

type ChatReadRow = {
  last_read_at: string | null;
};

const usernameFromProfile = (p: { reddit_username?: string | null; full_name?: string | null; email?: string | null }) => {
  const raw =
    p.reddit_username?.trim() ||
    p.full_name?.trim()?.replace(/\s+/g, '') ||
    p.email?.split('@')[0] ||
    'user';
  return raw.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
};

const hasMention = (content: string, username: string | null) => {
  const text = (content || '').toLowerCase();
  if (!username) return false;
  return text.includes(`@${username}`);
};

const WorkerChatPage: React.FC = () => {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [workerId, setWorkerId] = useState<string>('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [mentionCount, setMentionCount] = useState(0);
  const [workerUsername, setWorkerUsername] = useState<string | null>(null);
  const [workerLeague, setWorkerLeague] = useState<string | null>(null);
  const [workerAvatar, setWorkerAvatar] = useState<string | null>(null);
  const { toast } = useToast();
  const [previewOpen, setPreviewOpen] = useState(false);
  // No need for adminId, use 'staff' as the receiver

  useEffect(() => {
    // Fetch worker id (current user)
    supabase.auth.getSession().then(({ data }) => setWorkerId(data.session?.user.id || ''));
  }, []);

  useEffect(() => {
    if (!workerId) return;
    supabase
      .from('profiles')
      .select('full_name, reddit_username, email, league, karma, karma_range, cqs, avatar_url')
      .eq('user_id', workerId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setWorkerUsername(usernameFromProfile(data as unknown as { full_name?: string | null; reddit_username?: string | null; email?: string | null }));
        const computed = computeLeagueFromProfile({
          karma: (data as any).karma ?? null,
          karmaRange: (data as any).karma_range ?? null,
          cqs: (data as any).cqs ?? null,
        });
        setWorkerLeague(normalizeLeague((data as any).league) || computed);
        setWorkerAvatar((data as any).avatar_url || null);
      });
  }, [workerId]);

  useEffect(() => {
    if (!workerId) return;
    // Fetch messages between worker and staff
    supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${workerId},receiver_id.eq.${STAFF_UUID}),and(sender_id.eq.${STAFF_UUID},receiver_id.eq.${workerId})`)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data || []));
  }, [workerId]);

  useEffect(() => {
    if (!workerId) return;

    const run = async () => {
      const { data: readRowRaw } = await supabase
        .from('chat_reads')
        .select('last_read_at')
        .eq('reader_id', workerId)
        .eq('peer_id', STAFF_UUID)
        .maybeSingle();

      const readRow = (readRowRaw as unknown as ChatReadRow | null) || null;
      const lastReadAt = readRow?.last_read_at ?? undefined;

      const { data: recent } = await supabase
        .from('messages')
        .select('created_at, content')
        .eq('sender_id', STAFF_UUID)
        .eq('receiver_id', workerId)
        .order('created_at', { ascending: false })
        .limit(1000);

      const recentMessages = (recent ?? []) as Array<{ created_at: string; content: string }>;
      const unreadMsgs = recentMessages.filter(
        (m) => !lastReadAt || new Date(m.created_at).getTime() > new Date(lastReadAt).getTime()
      );

      setUnreadCount(unreadMsgs.length || 0);
      setMentionCount(unreadMsgs.filter((m) => hasMention(m.content, workerUsername)).length || 0);

      // Mark as read when opening the chat page
      const latestReadAt =
        recentMessages.length > 0
          ? recentMessages
              .map((m) => m.created_at)
              .sort()
              .slice(-1)[0]
          : new Date().toISOString();
      await supabase.from('chat_reads').upsert({
        reader_id: workerId,
        peer_id: STAFF_UUID,
        last_read_at: latestReadAt,
        updated_at: new Date().toISOString(),
      });
      window.dispatchEvent(
        new CustomEvent('chat-read-updated', {
          detail: {
            scope: 'direct',
            peerId: STAFF_UUID,
            lastReadAt: latestReadAt,
          },
        })
      );
      setUnreadCount(0);
      setMentionCount(0);
    };

    run();
  }, [workerId, workerUsername]);

  useEffect(() => {
    if (!workerId) return;

    const channel = supabase
      .channel('realtime:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const msg = payload.new as Message;
        if (
          (msg.sender_id === workerId && msg.receiver_id === STAFF_UUID) ||
          (msg.sender_id === STAFF_UUID && msg.receiver_id === workerId)
        ) {
          setMessages((prev) => [...prev, msg]);
        }

        if (msg.sender_id === STAFF_UUID && msg.receiver_id === workerId) {
          if (document.visibilityState === 'visible') {
            playNotificationSound();
            await supabase.from('chat_reads').upsert({
              reader_id: workerId,
              peer_id: STAFF_UUID,
              last_read_at: msg.created_at || new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
            window.dispatchEvent(
              new CustomEvent('chat-read-updated', {
                detail: {
                  scope: 'direct',
                  peerId: STAFF_UUID,
                  lastReadAt: msg.created_at || new Date().toISOString(),
                },
              })
            );
            setUnreadCount(0);
            setMentionCount(0);
          } else {
            setUnreadCount((c) => c + 1);
            if (hasMention(msg.content, workerUsername)) setMentionCount((c) => c + 1);
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, async (payload) => {
        const msg = payload.new as Message;
        if (
          (msg.sender_id === workerId && msg.receiver_id === STAFF_UUID) ||
          (msg.sender_id === STAFF_UUID && msg.receiver_id === workerId)
        ) {
          setMessages((prev) =>
            prev.map((message) => (message.id === msg.id ? { ...message, ...msg } : message))
          );
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workerId, workerUsername]);

  const sendMessage = async () => {
    const content = newMessage.trim();
    if (!content) return;
    const blockedTerm = findBlockedChatTerm(content);
    if (blockedTerm) {
      toast({
        title: 'Message blocked',
        description: `The message contains restricted content: "${blockedTerm}".`,
        variant: 'destructive',
      });
      return;
    }
    const { error, data } = await supabase
      .from('messages')
      .insert({
      sender_id: workerId,
      receiver_id: STAFF_UUID,
      content,
    })
      .select('id')
      .single();
    if (error) {
      alert('Failed to send message: ' + error.message);
      console.error('Send message error:', error);
    } else {
      if (data?.id) {
        await sendChatPush(data.id, 'direct');
      }
      setNewMessage('');
    }
  };

  const clearUnread = async () => {
    if (!workerId) return;
    const { data: latest } = await supabase
      .from('messages')
      .select('created_at')
      .eq('sender_id', STAFF_UUID)
      .eq('receiver_id', workerId)
      .order('created_at', { ascending: false })
      .limit(1);

    const latestReadAt =
      (latest && latest[0] && (latest[0] as { created_at?: string }).created_at) ||
      new Date().toISOString();

    await supabase.from('chat_reads').upsert({
      reader_id: workerId,
      peer_id: STAFF_UUID,
      last_read_at: latestReadAt,
      updated_at: new Date().toISOString(),
    });

    setUnreadCount(0);
    setMentionCount(0);

    window.dispatchEvent(
      new CustomEvent('chat-read-updated', {
        detail: {
          scope: 'direct',
          peerId: STAFF_UUID,
          lastReadAt: latestReadAt,
        },
      })
    );
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="border-b p-3 bg-card flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate('/worker/dashboard')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="font-semibold">Support Chat</div>
        <div />
      </div>
      <div className="border-b p-4 font-bold text-lg bg-card flex items-center justify-between">
        <span>Staff</span>
        <div className="flex items-center gap-2">
          {(mentionCount > 0 || unreadCount > 0) && (
            mentionCount > 0 ? (
              <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] h-5 min-w-5 px-1">
                {Math.min(99, mentionCount)}
              </span>
            ) : (
              <span className="inline-flex items-center justify-center rounded-full bg-background text-foreground border border-border text-[10px] h-5 min-w-5 px-1">
                {Math.min(99, unreadCount)}
              </span>
            )
          )}
          <Button variant="ghost" size="sm" onClick={clearUnread}>
            Clear unread
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-0.5">
          {messages.map((msg, idx) => {
            const mine = msg.sender_id === workerId;
            const mentioned = msg.sender_id === STAFF_UUID && hasMention(msg.content, workerUsername);
            const prev = idx > 0 ? messages[idx - 1] : null;
            const compact =
              !!prev &&
              prev.sender_id === msg.sender_id &&
              new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;

            return (
              <DiscordMessageRow
                key={msg.id}
                avatarText={mine ? 'You' : 'Staff'}
                avatarUrl={mine ? workerAvatar : null}
                displayName={mine ? 'You' : 'Staff'}
                username={mine ? workerUsername : null}
                role={mine ? 'worker' : 'staff'}
                league={mine ? workerLeague : null}
                timestamp={new Date(msg.created_at).toLocaleTimeString()}
                highlighted={!msg.deleted_at && mentioned}
                compact={compact}
                content={msg.deleted_at ? getDeletedMessageLabel(msg.deleted_reason) : msg.content}
                onContextProfile={() => mine && setPreviewOpen(true)}
              />
            );
          })}
        </div>
      </div>
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
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Your Profile</DialogTitle>
            <DialogDescription className="sr-only">
              View your worker profile summary.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border border-border/60 bg-muted/20">
                {workerAvatar ? <AvatarImage src={workerAvatar} alt={workerUsername || 'You'} /> : null}
                <AvatarFallback className="font-semibold">{(workerUsername?.charAt(0)?.toUpperCase() || 'Y') + '.'}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">You</div>
                <div className="text-xs text-muted-foreground truncate">@{workerUsername}</div>
                <div className="flex items-center gap-2 mt-1">
                  <LeagueBadge league={workerLeague} showLabel />
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WorkerChatPage;

