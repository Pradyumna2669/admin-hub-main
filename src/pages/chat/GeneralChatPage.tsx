import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { playNotificationSound } from '@/lib/notificationSound';
import { findBlockedChatTerm, getDeletedMessageLabel } from '@/lib/chatModeration';
import { useToast } from '@/hooks/use-toast';
import { sendChatPush } from '@/lib/chatPush';
import { CornerUpLeft, Film, Hash, SmilePlus, Trash2, Users, X } from 'lucide-react';
import { DiscordMessageRow } from '@/components/chat/DiscordMessageRow';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { RoleBadge } from '@/components/chat/RoleBadge';
import { type ChatRole } from '@/lib/chatRoleStyles';
import { LeagueBadge } from '@/components/badges/LeagueBadge';
import { computeLeagueFromProfile, normalizeLeague } from '@/lib/workerLeagues';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';

const GENERAL_ROOM = 'general';
const PAGE_SIZE = 100;
const MAX_MESSAGES = 800;
const GIF_MARKER = '[gif]';
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY as string | undefined;
const GIF_SEARCH_MIN_LENGTH = 2;

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  reddit_username: string | null;
  avatar_url?: string | null;
  role?: ChatRole;
  karma?: number | null;
  karma_range?: string | null;
  cqs?: string | null;
  league?: string | null;
};

type MessageRow = {
  id: string;
  sender_id: string;
  room: string;
  content: string;
  created_at: string;
  replied_to_id?: string | null;
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
};

type ReactionRow = {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
};

type GifResult = {
  id: string;
  title: string;
  previewUrl: string;
  mediaUrl: string;
};

type MentionCandidate =
  | { kind: 'everyone'; user_id: 'everyone'; username: 'everyone'; display: 'Everyone' }
  | { kind: 'role'; user_id: 'role:owner' | 'role:admin'; username: 'owner' | 'admin'; display: 'Owner' | 'Admin' }
  | { kind: 'user'; user_id: string; username: string; display: string };

const usernameFromProfile = (p: ProfileRow) => {
  const raw =
    p.reddit_username?.trim() ||
    p.full_name?.trim()?.replace(/\s+/g, '') ||
    p.email?.split('@')[0] ||
    'user';
  return raw.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
};

const displayNameFromProfile = (p: ProfileRow) =>
  p.full_name?.trim() || p.reddit_username?.trim() || p.email;

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

const normalizeGifUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return null;
    }

    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    const knownGifHost =
      host.includes('media.tenor.com') ||
      host.includes('media.giphy.com') ||
      host.includes('i.giphy.com') ||
      host.includes('i.imgur.com');
    const knownAnimatedExt = path.endsWith('.gif') || path.endsWith('.webp');

    if (!knownGifHost && !knownAnimatedExt) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

const buildMessageContent = (text: string, gifUrl?: string | null) => {
  if (!gifUrl) return text;
  return text ? `${text}\n${GIF_MARKER}${gifUrl}` : `${GIF_MARKER}${gifUrl}`;
};

const parseMessageContent = (content: string) => {
  const lines = (content || '').split('\n');
  const textLines: string[] = [];
  let gifUrl: string | null = null;

  for (const line of lines) {
    if (!gifUrl && line.startsWith(GIF_MARKER)) {
      gifUrl = normalizeGifUrl(line.slice(GIF_MARKER.length)) || null;
      continue;
    }
    textLines.push(line);
  }

  return {
    text: textLines.join('\n').trim(),
    gifUrl,
  };
};

const buildReactionMap = (rows: ReactionRow[]) => {
  const next = new Map<string, ReactionRow[]>();
  for (const row of rows) {
    const existing = next.get(row.message_id) || [];
    existing.push(row);
    next.set(row.message_id, existing);
  }
  return next;
};

const buildMessagePreviewText = (content: string) => {
  const parsed = parseMessageContent(content);
  const base = parsed.text || (parsed.gifUrl ? 'GIF' : '');
  return base.length > 90 ? `${base.slice(0, 90)}...` : base;
};

const GeneralChatPage: React.FC = () => {
  const isMobile = useIsMobile();
  const { user, userRole } = useAuth();
  const { toast } = useToast();

  const [members, setMembers] = useState<ProfileRow[]>([]);
  const [roleByUserId, setRoleByUserId] = useState<Map<string, ChatRole>>(new Map());
  const [leagueByUserId, setLeagueByUserId] = useState<Map<string, string>>(new Map());
  const [avatarByUserId, setAvatarByUserId] = useState<Map<string, string | null>>(new Map());
  const [rolesAvailable, setRolesAvailable] = useState(true);
  const [previewProfile, setPreviewProfile] = useState<ProfileRow | null>(null);
  const [membersQuery, setMembersQuery] = useState('');
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [reactionsByMessage, setReactionsByMessage] = useState<Map<string, ReactionRow[]>>(new Map());
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [gifDialogOpen, setGifDialogOpen] = useState(false);
  const [gifSearchQuery, setGifSearchQuery] = useState('');
  const [gifResults, setGifResults] = useState<GifResult[]>([]);
  const [gifLoading, setGifLoading] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);
  const [selectedGif, setSelectedGif] = useState<GifResult | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const oldestCreatedAtRef = useRef<string | null>(null);
  const scrollActionRef = useRef<'initial' | 'append' | 'prepend'>('initial');

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const pendingPrependRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const gifCacheRef = useRef<Map<string, GifResult[]>>(new Map());
  const selfId = user?.id || '';

  const memberById = useMemo(() => {
    const map = new Map<string, ProfileRow>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  const previewMember = useMemo(() => {
    if (!previewProfile) return null;
    return memberById.get(previewProfile.user_id) ?? previewProfile;
  }, [memberById, previewProfile]);

  const selfUsername = useMemo(() => {
    const p = memberById.get(selfId);
    return p ? usernameFromProfile(p) : null;
  }, [memberById, selfId]);

  const canEveryone = userRole === 'owner' || userRole === 'admin' || userRole === 'moderator';
  const canModerateMessages = userRole === 'owner' || userRole === 'admin' || userRole === 'moderator';
  const canSearchMembers = userRole === 'owner' || userRole === 'admin' || userRole === 'moderator';
  const messageById = useMemo(() => {
    const map = new Map<string, MessageRow>();
    for (const message of messages) {
      map.set(message.id, message);
    }
    return map;
  }, [messages]);

  const senderCanEveryone = (senderId: string) => {
    if (!rolesAvailable) return false;
    const r = roleByUserId.get(senderId);
    return r === 'owner' || r === 'admin' || r === 'moderator';
  };

  const isMentioningMe = (content: string, senderId: string) => {
    if (hasUserMention(content, selfUsername)) return true;
    if (hasEveryoneMention(content) && senderCanEveryone(senderId)) return true;
    if (userRole === 'owner' && hasRoleMention(content, 'owner')) return true;
    if ((userRole === 'admin' || userRole === 'owner' || userRole === 'moderator') && hasRoleMention(content, 'admin')) return true;
    return false;
  };

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();

    const roleCandidates: MentionCandidate[] = [
      { kind: 'role', user_id: 'role:owner', username: 'owner', display: 'Owner' },
      { kind: 'role', user_id: 'role:admin', username: 'admin', display: 'Admin' },
    ].filter((r) => (!q ? true : r.username.startsWith(q)));

    const list: MentionCandidate[] = members
      .map((m) => ({
        kind: 'user' as const,
        user_id: m.user_id,
        username: usernameFromProfile(m),
        display: displayNameFromProfile(m),
      }))
      .filter((m) => m.username && (q ? m.username.startsWith(q) : true))
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, 8);

    const includeEveryone = canEveryone && (!q || 'everyone'.startsWith(q));
    const everyone: MentionCandidate[] = includeEveryone
      ? [{ kind: 'everyone', user_id: 'everyone', username: 'everyone', display: 'Everyone' }]
      : [];

    return ([...everyone, ...roleCandidates, ...list].slice(0, 8));
  }, [members, mentionQuery, canEveryone]);

  const filteredMembers = useMemo(() => {
    const q = membersQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      const username = usernameFromProfile(m);
      const display = displayNameFromProfile(m).toLowerCase();
      return display.includes(q) || username.includes(q);
    });
  }, [members, membersQuery]);

  useEffect(() => {
    if (!gifDialogOpen) {
      setGifSearchQuery('');
      setGifResults([]);
      setGifError(null);
      setSelectedGif(null);
      return;
    }

    if (!GIPHY_API_KEY) {
      setGifResults([]);
      setGifError('Add VITE_GIPHY_API_KEY to .env to enable the GIF picker.');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const searchTerm = gifSearchQuery.trim();
    const cacheKey = searchTerm ? `search:${searchTerm.toLowerCase()}` : 'trending';

    if (searchTerm && searchTerm.length < GIF_SEARCH_MIN_LENGTH) {
      setGifResults([]);
      setGifError(`Type at least ${GIF_SEARCH_MIN_LENGTH} characters to search GIFs.`);
      return;
    }

    const cached = gifCacheRef.current.get(cacheKey);
    if (cached) {
      setGifResults(cached);
      setGifError(null);
      setGifLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        setGifLoading(true);
        setGifError(null);

        const endpoint = searchTerm
          ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(GIPHY_API_KEY)}&q=${encodeURIComponent(searchTerm)}&limit=24&offset=0&rating=pg-13&lang=en`
          : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(GIPHY_API_KEY)}&limit=24&rating=pg-13`;

        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Failed to load GIFs from Giphy.');
        }

        const payload = await response.json();
        const nextResults: GifResult[] = (payload?.data || [])
          .map((item: any) => {
            const previewUrl =
              item?.images?.fixed_height_small?.webp ||
              item?.images?.fixed_height_small?.url ||
              item?.images?.downsized_small?.mp4 ||
              item?.images?.preview_gif?.url ||
              null;
            const mediaUrl =
              item?.images?.original?.url ||
              item?.images?.downsized_large?.url ||
              item?.images?.fixed_height?.url ||
              null;

            if (!previewUrl || !mediaUrl) {
              return null;
            }

            return {
              id: item.id,
              title: item.title || 'GIF',
              previewUrl,
              mediaUrl,
            };
          })
          .filter(Boolean);

        if (!cancelled) {
          gifCacheRef.current.set(cacheKey, nextResults);
          setGifResults(nextResults);
          setSelectedGif((current) =>
            current ? nextResults.find((gif) => gif.id === current.id) || null : null
          );
        }
      } catch (error) {
        if (controller.signal.aborted || cancelled) return;
        setGifError(error instanceof Error ? error.message : 'Failed to load GIFs.');
        setGifResults([]);
      } finally {
        if (!cancelled) {
          setGifLoading(false);
        }
      }
    }, searchTerm ? 450 : 0);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [gifDialogOpen, gifSearchQuery]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setLoadError(null);

        const [
          { data: chatDirectory, error: chatDirectoryError },
          { data: msgs, error: msgsError },
        ] =
          await Promise.all([
            supabase.rpc('list_chat_directory'),
            supabase
              .from('group_messages')
              .select('*')
              .eq('room', GENERAL_ROOM)
              .order('created_at', { ascending: false })
              .limit(PAGE_SIZE),
          ]);

        if (chatDirectoryError) throw chatDirectoryError;
        if (msgsError) throw msgsError;

        if (!cancelled) setMembers(((chatDirectory ?? []) as unknown as ProfileRow[]) || []);
        if (!cancelled) {
          const map = new Map<string, ChatRole>();
          setRolesAvailable(true);
          for (const row of (chatDirectory ?? []) as Array<{ user_id: string; role: ChatRole }>) {
            map.set(row.user_id, (row.role || null) as ChatRole);
          }
          setRoleByUserId(map);

          // Fetch profile fields for league computation
          const ids = (chatDirectory ?? []).map((r: any) => r.user_id).filter(Boolean);
          if (ids.length) {
            const leagueMap = new Map<string, string>();
            const avatarMap = new Map<string, string | null>();
            for (const p of (chatDirectory ?? []) as ProfileRow[]) {
              const computed = computeLeagueFromProfile({
                karma: p.karma ?? null,
                karmaRange: p.karma_range ?? null,
                cqs: p.cqs ?? null,
              });
              const league = normalizeLeague(p.league) || computed;
              leagueMap.set(p.user_id, league);
              avatarMap.set(p.user_id, p.avatar_url || null);
            }
            if (!cancelled) {
              setLeagueByUserId(leagueMap);
              setAvatarByUserId(avatarMap);
            }
          }
        }
        if (!cancelled) {
          const page = (((msgs ?? []) as unknown as MessageRow[]) || []).slice().reverse();
          const messageIds = page.map((message) => message.id);
          if (messageIds.length) {
            const { data: reactionRows, error: reactionsError } = await supabase
              .from('group_message_reactions')
              .select('*')
              .in('message_id', messageIds);
            if (reactionsError) throw reactionsError;
            if (!cancelled) {
              setReactionsByMessage(buildReactionMap(((reactionRows ?? []) as unknown as ReactionRow[]) || []));
            }
          } else if (!cancelled) {
            setReactionsByMessage(new Map());
          }
          setMessages(page);
          oldestCreatedAtRef.current = page.length ? page[0].created_at : null;
          setHasMore(((msgs ?? []) as unknown as MessageRow[])?.length === PAGE_SIZE);
          scrollActionRef.current = 'initial';
        }
      } catch (e: unknown) {
        const err = e as any;
        const isMissingTable =
          err?.code === 'PGRST205' ||
          err?.status === 404 ||
          (typeof err?.message === 'string' && err.message.toLowerCase().includes('could not find the table'));

        const msg = isMissingTable
          ? 'General chat is not enabled in the database yet. Apply the latest Supabase migrations (group_messages / group_chat_reads).'
          : e instanceof Error
            ? e.message
            : 'Failed to load chat';

        if (!cancelled) setLoadError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const action = scrollActionRef.current;
    if (action === 'prepend') return;
    bottomRef.current?.scrollIntoView({ behavior: action === 'initial' ? 'auto' : 'smooth' });
  }, [messages.length]);

  useLayoutEffect(() => {
    if (scrollActionRef.current !== 'prepend') return;
    const pending = pendingPrependRef.current;
    if (!pending) return;

    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
    if (!viewport) return;

    const nextScrollHeight = viewport.scrollHeight;
    const delta = nextScrollHeight - pending.prevScrollHeight;
    viewport.scrollTop = pending.prevScrollTop + delta;
    pendingPrependRef.current = null;
  }, [messages.length]);

  useEffect(() => {
    if (!selfId) return;

    const markRead = async (lastReadAt = new Date().toISOString()) => {
      const { error } = await supabase.from('group_chat_reads').upsert({
        reader_id: selfId,
        room: GENERAL_ROOM,
        last_read_at: lastReadAt,
        updated_at: new Date().toISOString(),
      });
      if (error && (error as any)?.code !== 'PGRST205') {
        // ignore: handled via UI load error
        return;
      }
      window.dispatchEvent(
        new CustomEvent('chat-read-updated', {
          detail: {
            scope: 'general',
            lastReadAt,
          },
        })
      );
    };

    if (document.visibilityState === 'visible') {
      void markRead();
    }

    const onVis = () => {
      if (document.visibilityState === 'visible') void markRead();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [selfId]);

  useEffect(() => {
    if (!selfId) return;

    const channel = supabase
      .channel('realtime:general-chat')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages' },
        async (payload) => {
          const msg = payload.new as MessageRow;
          if (msg.room !== GENERAL_ROOM) return;

          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            scrollActionRef.current = 'append';
            const next = [...prev, msg];
            if (next.length > MAX_MESSAGES) return next.slice(next.length - MAX_MESSAGES);
            return next;
          });

          const mentionedMe = msg.sender_id !== selfId && isMentioningMe(msg.content, msg.sender_id);

          if (msg.sender_id !== selfId && (document.visibilityState === 'visible' || mentionedMe)) {
            playNotificationSound();
          }

          if (msg.sender_id !== selfId && document.visibilityState === 'visible') {
            const lastReadAt = msg.created_at || new Date().toISOString();
            const { error } = await supabase.from('group_chat_reads').upsert({
              reader_id: selfId,
              room: GENERAL_ROOM,
              last_read_at: lastReadAt,
              updated_at: new Date().toISOString(),
            });
            if (!error || (error as any)?.code === 'PGRST205') {
              window.dispatchEvent(
                new CustomEvent('chat-read-updated', {
                  detail: {
                    scope: 'general',
                    lastReadAt,
                  },
                })
              );
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'group_messages' },
        async (payload) => {
          const msg = payload.new as MessageRow;
          if (msg.room !== GENERAL_ROOM) return;

          setMessages((prev) =>
            prev.map((message) => (message.id === msg.id ? { ...message, ...msg } : message))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selfId, selfUsername]);

  useEffect(() => {
    if (!selfId) return;

    const channel = supabase
      .channel('realtime:general-chat-reactions')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_message_reactions' },
        (payload) => {
          const reaction = payload.new as ReactionRow;
          setReactionsByMessage((prev) => {
            const next = new Map(prev);
            const existing = next.get(reaction.message_id) || [];
            if (existing.some((row) => row.id === reaction.id)) {
              return prev;
            }
            next.set(reaction.message_id, [...existing, reaction]);
            return next;
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'group_message_reactions' },
        (payload) => {
          const reaction = payload.old as ReactionRow;
          setReactionsByMessage((prev) => {
            const next = new Map(prev);
            const existing = next.get(reaction.message_id) || [];
            const filtered = existing.filter((row) => row.id !== reaction.id);
            if (filtered.length) {
              next.set(reaction.message_id, filtered);
            } else {
              next.delete(reaction.message_id);
            }
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selfId]);

  const sendMessage = async () => {
    const content = newMessage.trim();
    if (!content || !selfId || isSending) return;
    const blockedTerm = findBlockedChatTerm(content);
    if (blockedTerm) {
      setLoadError(`Message blocked because it contains restricted content: "${blockedTerm}".`);
      toast({
        title: 'Message blocked',
        description: `The message contains restricted content: "${blockedTerm}".`,
        variant: 'destructive',
      });
      return;
    }

    const replyId = replyingToId;
    setIsSending(true);
    setNewMessage('');
    setMentionOpen(false);
    setMentionQuery('');
    setMentionStart(null);
    setMentionIndex(0);
    setReplyingToId(null);
    setLoadError(null);

    const { data, error } = await supabase
      .from('group_messages')
      .insert({
        room: GENERAL_ROOM,
        sender_id: selfId,
        content,
        replied_to_id: replyId,
      })
      .select('id')
      .single();

    if (error) {
      setNewMessage(content);
      setReplyingToId(replyId);
      setLoadError(error.message);
      setIsSending(false);
      return;
    }

    if (data?.id) {
      await sendChatPush(data.id, 'group');
    }

    setIsSending(false);
  };

  const sendGifMessage = async () => {
    if (!selfId || isSending) return;

    const gifUrl = normalizeGifUrl(selectedGif?.mediaUrl || '');
    if (!gifUrl) {
      toast({
        title: 'Select a GIF',
        description: 'Choose a GIF before sending.',
        variant: 'destructive',
      });
      return;
    }

    const caption = newMessage.trim();
    const content = buildMessageContent(caption, gifUrl);
    const blockedTerm = caption ? findBlockedChatTerm(caption) : null;

    if (blockedTerm) {
      toast({
        title: 'Caption blocked',
        description: `The caption contains restricted content: "${blockedTerm}".`,
        variant: 'destructive',
      });
      return;
    }

    const replyId = replyingToId;
    setIsSending(true);
    setNewMessage('');
    setGifDialogOpen(false);
    setMentionOpen(false);
    setMentionQuery('');
    setMentionStart(null);
    setMentionIndex(0);
    setReplyingToId(null);
    setLoadError(null);

    const { data, error } = await supabase
      .from('group_messages')
      .insert({
        room: GENERAL_ROOM,
        sender_id: selfId,
        content,
        replied_to_id: replyId,
      })
      .select('id')
      .single();

    if (error) {
      setNewMessage(caption);
      setReplyingToId(replyId);
      setSelectedGif((current) => current ?? selectedGif);
      setLoadError(error.message);
      setIsSending(false);
      return;
    }

    if (data?.id) {
      await sendChatPush(data.id, 'group');
    }

    setIsSending(false);
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!selfId) return;

    const existing = reactionsByMessage.get(messageId) || [];
    const mine = existing.find((reaction) => reaction.user_id === selfId && reaction.emoji === emoji);

    if (mine) {
      const { error } = await supabase
        .from('group_message_reactions')
        .delete()
        .eq('id', mine.id);

      if (error) {
        toast({
          title: 'Reaction failed',
          description: error.message,
          variant: 'destructive',
        });
        return;
      }

      setReactionsByMessage((prev) => {
        const next = new Map(prev);
        const filtered = (next.get(messageId) || []).filter((reaction) => reaction.id !== mine.id);
        if (filtered.length) {
          next.set(messageId, filtered);
        } else {
          next.delete(messageId);
        }
        return next;
      });
      return;
    }

    const { data, error } = await supabase
      .from('group_message_reactions')
      .insert({
        message_id: messageId,
        user_id: selfId,
        emoji,
      })
      .select('*')
      .single();

    if (error) {
      toast({
        title: 'Reaction failed',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const inserted = data as unknown as ReactionRow;
    setReactionsByMessage((prev) => {
      const next = new Map(prev);
      const existingRows = next.get(messageId) || [];
      if (!existingRows.some((reaction) => reaction.id === inserted.id)) {
        next.set(messageId, [...existingRows, inserted]);
      }
      return next;
    });
  };

  const deleteMessage = async (messageId: string) => {
    const reason = window.prompt('Reason for deleting this message?') || '';
    const { data, error } = await supabase.rpc('delete_group_message', {
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
          message.id === (data as MessageRow).id
            ? { ...message, ...(data as MessageRow) }
            : message
        )
      );
    }
  };

  const loadOlder = async () => {
    if (!hasMore || loadingOlder) return;
    const oldest = oldestCreatedAtRef.current;
    if (!oldest) return;

    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
    if (viewport) {
      pendingPrependRef.current = { prevScrollHeight: viewport.scrollHeight, prevScrollTop: viewport.scrollTop };
    }

    try {
      setLoadingOlder(true);
      const { data, error } = await supabase
        .from('group_messages')
        .select('*')
        .eq('room', GENERAL_ROOM)
        .lt('created_at', oldest)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (error) throw error;

      const page = (((data ?? []) as unknown as MessageRow[]) || []).slice().reverse();
      if (!page.length) {
        setHasMore(false);
        return;
      }

      const messageIds = page.map((message) => message.id);
      if (messageIds.length) {
        const { data: reactionRows, error: reactionsError } = await supabase
          .from('group_message_reactions')
          .select('*')
          .in('message_id', messageIds);
        if (reactionsError) throw reactionsError;
        const nextReactions = ((reactionRows ?? []) as unknown as ReactionRow[]) || [];
        setReactionsByMessage((prev) => {
          const next = new Map(prev);
          for (const reaction of nextReactions) {
            const existing = next.get(reaction.message_id) || [];
            existing.push(reaction);
            next.set(reaction.message_id, existing);
          }
          return next;
        });
      }

      scrollActionRef.current = 'prepend';
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id));
        const merged = [...page.filter((m) => !existing.has(m.id)), ...prev];
        if (merged.length > MAX_MESSAGES) return merged.slice(0, MAX_MESSAGES);
        return merged;
      });

      oldestCreatedAtRef.current = page[0].created_at;
      setHasMore(((data ?? []) as unknown as MessageRow[])?.length === PAGE_SIZE);
    } catch (e: unknown) {
      const err = e as any;
      setLoadError(typeof err?.message === 'string' ? err.message : 'Failed to load older messages');
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
    if (!viewport) return;

    const onScroll = () => {
      if (!hasMore || loadingOlder || loading) return;
      if (viewport.scrollTop <= 24) loadOlder();
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [hasMore, loadingOlder, loading]);

  const updateMentionState = (nextValue: string, cursor: number) => {
    const uptoCursor = nextValue.slice(0, cursor);
    const at = uptoCursor.lastIndexOf('@');
    if (at === -1) {
      setMentionOpen(false);
      setMentionQuery('');
      setMentionStart(null);
      return;
    }

    const prevChar = at === 0 ? ' ' : uptoCursor[at - 1];
    const boundaryOk = /\s|\(|\[|\{|"|'|>|<|,|\./.test(prevChar);
    if (!boundaryOk) {
      setMentionOpen(false);
      setMentionQuery('');
      setMentionStart(null);
      return;
    }

    const fragment = uptoCursor.slice(at + 1);
    if (!/^[a-zA-Z0-9_]*$/.test(fragment)) {
      setMentionOpen(false);
      setMentionQuery('');
      setMentionStart(null);
      return;
    }

    setMentionStart(at);
    setMentionQuery(fragment);
    setMentionIndex(0);
    setMentionOpen(true);
  };

  const insertMention = (username: string) => {
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? newMessage.length;
    const start = mentionStart ?? newMessage.lastIndexOf('@');
    if (start < 0) return;

    const before = newMessage.slice(0, start);
    const after = newMessage.slice(cursor);
    const next = `${before}@${username} ${after}`;
    setNewMessage(next);
    setMentionOpen(false);
    setMentionQuery('');
    setMentionStart(null);
    setMentionIndex(0);

    window.setTimeout(() => {
      const pos = (before + `@${username} `).length;
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    const cursorStart = el?.selectionStart ?? newMessage.length;
    const cursorEnd = el?.selectionEnd ?? cursorStart;
    const before = newMessage.slice(0, cursorStart);
    const after = newMessage.slice(cursorEnd);
    const next = `${before}${emoji}${after}`;
    const nextCursor = before.length + emoji.length;

    setNewMessage(next);
    updateMentionState(next, nextCursor);

    window.setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(nextCursor, nextCursor);
      }
    }, 0);
  };

  const renderMessageWithMentions = (text: string, opts?: { onPrimary?: boolean; enableEveryone?: boolean }) => {
    const onPrimary = !!opts?.onPrimary;
    const enableEveryone = !!opts?.enableEveryone;
    const parts: Array<{ t: string; mention?: string }> = [];
    const re = /@([a-zA-Z0-9_]+)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push({ t: text.slice(last, m.index) });
      parts.push({ t: `@${m[1]}`, mention: m[1].toLowerCase() });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ t: text.slice(last) });

    const knownUsernames = new Set(members.map((p) => usernameFromProfile(p)));
    if (enableEveryone) knownUsernames.add('everyone');
    knownUsernames.add('admin');
    knownUsernames.add('owner');

    return (
      <span className="block min-w-0 max-w-full break-all [overflow-wrap:anywhere]">
        {parts.map((p, idx) => {
          if (!p.mention) {
            return (
              <span key={idx} className="break-all [overflow-wrap:anywhere]">
                {p.t}
              </span>
            );
          }
          const uname = p.mention;
          const known = knownUsernames.has(uname);
          const mine = !!selfUsername && uname === selfUsername;
          return (
            <span
              key={idx}
              className={cn(
                'break-all [overflow-wrap:anywhere]',
                onPrimary
                  ? known
                    ? 'text-primary-foreground font-semibold underline underline-offset-2 decoration-primary-foreground/60'
                    : 'text-primary-foreground/70'
                  : known
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground',
                mine && (onPrimary ? 'bg-primary-foreground/20 rounded px-1' : 'bg-primary/15 rounded px-1')
              )}
            >
              {p.t}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <DashboardLayout mainClassName="h-full overflow-hidden p-0">
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
        <div className="shrink-0 border-b bg-background/80 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Hash className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold truncate">general</h1>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>{members.length} members</span>
            </div>
          </div>
        </div>

        <div className="min-h-0 min-w-0 flex-1 p-3 sm:p-4">
          <div className="flex h-full min-h-0 min-w-0 w-full rounded-xl border bg-card overflow-hidden">
            <div className="flex h-full min-h-0 min-w-0 w-full flex-col lg:min-h-[520px] lg:flex-row">
            {/* Channels (Discord-ish) */}
            <div className="hidden lg:flex w-64 border-r bg-muted/20 flex-col">
              <div className="p-4 border-b">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Channels
                </div>
              </div>

              <div className="p-2 space-y-1">
                <button
                  className={cn(
                    'w-full flex items-center gap-2 rounded-md px-3 py-2 text-sm',
                    'bg-primary/10 text-primary'
                  )}
                >
                  <Hash className="h-4 w-4" />
                  <span className="truncate">general</span>
                </button>

              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 flex min-h-0 flex-col min-w-0">
              <div className="border-b bg-card p-3 flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">
                  Talk with everyone here. Use <span className="font-mono">@username</span> to tag.
                </div>
              </div>

              <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0 overflow-x-hidden touch-pan-y">
                <div className="relative min-w-0 max-w-full overflow-x-hidden p-3 space-y-1.5 sm:p-4 sm:space-y-2">
                  {loadingOlder && (
                    <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 px-4 pt-4">
                      <div className="rounded-xl border bg-background/40 p-4 backdrop-blur-md animate-pulse">
                        <div className="flex gap-3">
                          <div className="h-9 w-9 rounded-full bg-muted" />
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="h-3 w-48 rounded bg-muted" />
                            <div className="h-3 w-4/5 rounded bg-muted" />
                            <div className="h-3 w-2/3 rounded bg-muted" />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {loading ? (
                    <div className="text-sm text-muted-foreground">Loading chat...</div>
                  ) : loadError ? (
                    <div className="text-sm text-destructive">{loadError}</div>
                  ) : messages.length === 0 ? (
                    <div className="text-sm text-muted-foreground">
                      No messages yet. Say hi!
                    </div>
                  ) : (
                    messages.map((msg, idx) => {
                      const sender = memberById.get(msg.sender_id);
                      const senderName = sender ? displayNameFromProfile(sender) : 'Unknown';
                      const senderUsername = sender ? usernameFromProfile(sender) : 'user';
                      const mine = msg.sender_id === selfId;
                      const mentioned = !mine && !msg.deleted_at && isMentioningMe(msg.content, msg.sender_id);
                      const role = roleByUserId.get(msg.sender_id) ?? null;
                      const league = leagueByUserId.get(msg.sender_id) ?? null;
                      const avatarUrl = avatarByUserId.get(msg.sender_id) ?? sender?.avatar_url ?? null;

                      const prev = idx > 0 ? messages[idx - 1] : null;
                      const compact =
                        !!prev &&
                        prev.sender_id === msg.sender_id &&
                        new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60 * 1000;
                      const parsedContent = parseMessageContent(msg.content);
                      const replyTarget = msg.replied_to_id ? messageById.get(msg.replied_to_id) : null;
                      const replySender = replyTarget ? memberById.get(replyTarget.sender_id) : null;
                      const messageReactions = reactionsByMessage.get(msg.id) || [];
                      const reactionGroups = Array.from(
                        messageReactions.reduce((map, reaction) => {
                          const existing = map.get(reaction.emoji) || [];
                          existing.push(reaction);
                          map.set(reaction.emoji, existing);
                          return map;
                        }, new Map<string, ReactionRow[]>())
                      );
                      const messageContent = msg.deleted_at ? (
                        getDeletedMessageLabel(msg.deleted_reason)
                      ) : (
                        <div className="min-w-0 max-w-full space-y-2">
                          {parsedContent.text ? (
                            <div className="min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
                              {renderMessageWithMentions(parsedContent.text, {
                                enableEveryone: senderCanEveryone(msg.sender_id),
                              })}
                            </div>
                          ) : null}
                          {parsedContent.gifUrl ? (
                            <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
                              <img
                                src={parsedContent.gifUrl}
                                alt={parsedContent.text || 'GIF'}
                                loading="lazy"
                                className="block h-auto max-h-[240px] w-full max-w-full object-contain sm:max-h-[360px]"
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                      const replyPreview = replyTarget ? (
                        <button
                          type="button"
                          onClick={() => {
                            const element = document.getElementById(`chat-message-${replyTarget.id}`);
                            if (element) {
                              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                          }}
                          className="flex max-w-full items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/35"
                        >
                          <CornerUpLeft className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            <span className="font-medium text-foreground/85">
                              {replySender ? displayNameFromProfile(replySender) : 'Original message'}
                            </span>
                            {': '}
                            {buildMessagePreviewText(replyTarget.content) || 'Message unavailable'}
                          </span>
                        </button>
                      ) : null;
                      const footer = !msg.deleted_at && reactionGroups.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {reactionGroups.map(([emoji, rows]) => {
                            const reacted = rows.some((row) => row.user_id === selfId);
                            return (
                              <button
                                key={`${msg.id}-${emoji}`}
                                type="button"
                                onClick={() => toggleReaction(msg.id, emoji)}
                                className={cn(
                                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                                  reacted
                                    ? 'border-primary/50 bg-primary/15 text-primary'
                                    : 'border-border/70 bg-muted/20 hover:bg-muted/40'
                                )}
                              >
                                <span>{emoji}</span>
                                <span>{rows.length}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null;

                      return (
                        <div key={msg.id} id={`chat-message-${msg.id}`} className="min-w-0 max-w-full overflow-hidden">
                          <DiscordMessageRow
                          replyPreview={replyPreview}
                          footer={footer}
                          avatarText={senderName}
                          displayName={mine ? 'You' : senderName}
                          username={senderUsername}
                          role={role}
                          league={league}
                          avatarUrl={avatarUrl}
                          onContextProfile={() => sender && setPreviewProfile(sender)}
                          timestamp={new Date(msg.created_at).toLocaleTimeString()}
                          highlighted={mentioned}
                          compact={compact}
                          content={messageContent}
                          actions={
                            <div className="flex items-center gap-1">
                              {!msg.deleted_at ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2"
                                    onClick={() => setReplyingToId(msg.id)}
                                  >
                                    <CornerUpLeft className="h-3.5 w-3.5" />
                                  </Button>
                                  <EmojiPicker
                                    disabled={loading}
                                    onSelect={(emoji) => toggleReaction(msg.id, emoji)}
                                    align="end"
                                    side="top"
                                    trigger={
                                      <span className="inline-flex h-7 items-center justify-center rounded-md px-2 hover:bg-muted">
                                        <SmilePlus className="h-3.5 w-3.5" />
                                      </span>
                                    }
                                  />
                                </>
                              ) : null}
                              {canModerateMessages && !msg.deleted_at ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => deleteMessage(msg.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          }
                        />
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>

              <div className="shrink-0 border-t p-3 bg-card min-w-0">
                <div className="relative flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="relative min-w-0 flex-1">
                    {replyingToId && messageById.get(replyingToId) ? (
                      <div className="mb-2 flex items-start justify-between gap-3 rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
                        <div className="min-w-0 text-sm">
                          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                            <CornerUpLeft className="h-3.5 w-3.5" />
                            Replying to
                          </div>
                          <div className="mt-1 truncate font-medium">
                            {(() => {
                              const target = messageById.get(replyingToId);
                              const sender = target ? memberById.get(target.sender_id) : null;
                              return sender ? displayNameFromProfile(sender) : 'Original message';
                            })()}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {buildMessagePreviewText(messageById.get(replyingToId)?.content || '') || 'Message unavailable'}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => setReplyingToId(null)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : null}
                    <Textarea
                      ref={inputRef}
                      disabled={isSending}
                      value={newMessage}
                      onChange={(e) => {
                        const next = e.target.value;
                        setNewMessage(next);
                        updateMentionState(next, e.target.selectionStart ?? next.length);
                      }}
                      placeholder="Message #general"
                      className="min-h-[44px] max-h-36 w-full min-w-0 resize-none pr-10 text-base"
                      onKeyDown={(e) => {
                        if (mentionOpen && mentionCandidates.length > 0) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setMentionIndex((i) => Math.min(i + 1, mentionCandidates.length - 1));
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setMentionIndex((i) => Math.max(i - 1, 0));
                            return;
                          }
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            const u = mentionCandidates[mentionIndex]?.username;
                            if (u) insertMention(u);
                            return;
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setMentionOpen(false);
                            return;
                          }
                        }

                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      onClick={(e) => {
                        const el = e.target as HTMLTextAreaElement;
                        updateMentionState(el.value, el.selectionStart ?? el.value.length);
                      }}
                      onBlur={() => {
                        window.setTimeout(() => setMentionOpen(false), 150);
                      }}
                    />

                    {mentionOpen && mentionCandidates.length > 0 && (
                      <div className="absolute bottom-[52px] left-0 right-0 z-10 rounded-lg border bg-popover shadow-md overflow-hidden">
                        <div className="px-3 py-2 text-xs text-muted-foreground border-b">
                          Mention someone
                        </div>
                        <div className="max-h-64 overflow-auto">
                          {mentionCandidates.map((m, idx) => (
                            <button
                              key={m.user_id}
                              className={cn(
                                'w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-muted',
                                idx === mentionIndex && 'bg-muted'
                              )}
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => insertMention(m.username)}
                            >
                              <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-semibold">
                                  {m.display?.charAt(0)?.toUpperCase() || 'U'}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{m.display}</div>
                                <div className="text-xs text-muted-foreground truncate">@{m.username}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="grid w-full min-w-0 grid-cols-3 gap-2 sm:w-auto sm:grid-cols-none sm:flex sm:items-center sm:gap-2 sm:shrink-0">
                    <EmojiPicker
                      disabled={loading || isSending}
                      onSelect={insertEmoji}
                      triggerClassName="w-full sm:w-auto"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSending}
                      onClick={() => setGifDialogOpen(true)}
                      className="w-full sm:w-auto"
                    >
                      <Film className="h-4 w-4" />
                      GIF
                    </Button>
                    <Button className="w-full sm:w-auto" onClick={sendMessage} disabled={!newMessage.trim() || isSending}>
                      {isSending ? 'Sending...' : 'Send'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Members */}
             <div className="hidden xl:flex w-72 border-l bg-muted/10 flex-col">
               <div className="p-4 border-b">
                 <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                   Members
                 </div>
                 {canSearchMembers ? (
                   <div className="mt-2">
                     <Input
                       value={membersQuery}
                       onChange={(e) => setMembersQuery(e.target.value)}
                       placeholder="Search"
                     />
                   </div>
                 ) : null}
               </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="p-2 space-y-1">
                  {filteredMembers.map((m) => {
                    const name = displayNameFromProfile(m);
                    const username = usernameFromProfile(m);
                    const role = roleByUserId.get(m.user_id) ?? m.role ?? null;
                    const league = leagueByUserId.get(m.user_id) ?? null;
                    const avatarUrl = avatarByUserId.get(m.user_id) ?? m.avatar_url ?? null;
                    return (
                      <div
                        key={m.user_id}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm',
                          m.user_id === selfId && 'bg-primary/10'
                        )}
                      >
                        <Avatar className="h-8 w-8 border border-border/70 bg-muted/40">
                          {avatarUrl ? <AvatarImage src={avatarUrl} alt={name || username} /> : null}
                          <AvatarFallback className="text-[11px] font-semibold">
                            {(name?.charAt(0)?.toUpperCase() || 'U') + '.'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="font-medium truncate">{name}</div>
                            <RoleBadge role={role} className="shrink-0" />
                            <LeagueBadge league={league} className="shrink-0" />
                            </div>
                            <div className="text-xs text-muted-foreground truncate">@{username}</div>
                          </div>
                        </div>
                      );
                  })}
                </div>
              </ScrollArea>
            </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={!!previewProfile} onOpenChange={(o) => !o && setPreviewProfile(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>User Profile</DialogTitle>
            <DialogDescription className="sr-only">
              View the selected general chat member profile summary.
            </DialogDescription>
          </DialogHeader>
          {previewMember && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12 border border-border/60 bg-muted/20">
                  {(avatarByUserId.get(previewMember.user_id) ?? previewMember.avatar_url) ? (
                    <AvatarImage
                      src={(avatarByUserId.get(previewMember.user_id) ?? previewMember.avatar_url) || undefined}
                      alt={displayNameFromProfile(previewMember) || 'user'}
                    />
                  ) : null}
                  <AvatarFallback className="font-semibold">
                    {(displayNameFromProfile(previewMember)?.charAt(0)?.toUpperCase() || 'U') + '.'}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{displayNameFromProfile(previewMember)}</div>
                  <div className="text-xs text-muted-foreground truncate">@{usernameFromProfile(previewMember)}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <LeagueBadge league={previewMember.league || leagueByUserId.get(previewMember.user_id)} showLabel />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>Karma: {previewMember.karma ?? previewMember.karma_range ?? '-'}</div>
                <div>CQS: {previewMember.cqs ?? '-'}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={gifDialogOpen} onOpenChange={setGifDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Send GIF</DialogTitle>
            <DialogDescription>
              Search Giphy and pick a GIF. The current message box text will be sent as the caption.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Search GIFs</div>
                  <Input
                    value={gifSearchQuery}
                    onChange={(e) => setGifSearchQuery(e.target.value)}
                    placeholder="Search Giphy"
                  />
                </div>
                <div className="rounded-2xl border border-border/60 bg-muted/10">
                  <ScrollArea className="h-[22rem]">
                    <div className="grid grid-cols-2 gap-3 p-3 md:grid-cols-3">
                      {gifLoading ? (
                        Array.from({ length: 9 }).map((_, index) => (
                          <div
                            key={index}
                            className="aspect-[4/3] animate-pulse rounded-xl bg-muted"
                          />
                        ))
                      ) : gifError ? (
                        <div className="col-span-full rounded-xl border border-dashed border-border/70 bg-background/40 p-6 text-sm text-muted-foreground">
                          {gifError}
                        </div>
                      ) : gifResults.length === 0 ? (
                        <div className="col-span-full rounded-xl border border-dashed border-border/70 bg-background/40 p-6 text-sm text-muted-foreground">
                          No GIFs found.
                        </div>
                      ) : (
                        gifResults.map((gif) => (
                          <button
                            key={gif.id}
                            type="button"
                            onClick={() => setSelectedGif(gif)}
                            className={cn(
                              'overflow-hidden rounded-xl border bg-background/50 text-left transition-all',
                              selectedGif?.id === gif.id
                                ? 'border-primary ring-2 ring-primary/40'
                                : 'border-border/60 hover:border-primary/40'
                            )}
                          >
                            <img
                              src={gif.previewUrl}
                              alt={gif.title}
                              loading="lazy"
                              className="block aspect-[4/3] h-full w-full object-cover"
                            />
                          </button>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
              <div className="w-full space-y-3 lg:w-80">
                <div className="text-sm font-medium">Preview</div>
                <div className="overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
                  {selectedGif ? (
                    <img
                      src={selectedGif.mediaUrl}
                      alt={selectedGif.title}
                      className="block max-h-[320px] w-full object-contain"
                    />
                  ) : (
                    <div className="flex min-h-[220px] items-center justify-center p-6 text-center text-sm text-muted-foreground">
                      Pick a GIF from the results.
                    </div>
                  )}
                </div>
                {newMessage.trim() ? (
                  <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                    Caption: {newMessage.trim()}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/60 bg-background/40 px-3 py-2 text-sm text-muted-foreground">
                    No caption. You can type a message first, then attach a GIF.
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setGifDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={sendGifMessage} disabled={!selectedGif || isSending}>
              {isSending ? 'Sending...' : 'Send GIF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default GeneralChatPage;

