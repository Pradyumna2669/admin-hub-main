import * as React from 'react';
import { cn } from '@/lib/utils';
import { type ChatRole, getChatRoleStyle } from '@/lib/chatRoleStyles';
import { RoleBadge } from '@/components/chat/RoleBadge';
import { LeagueBadge } from '@/components/badges/LeagueBadge';
import { League } from '@/lib/workerLeagues';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type DiscordMessageRowProps = {
  avatarText?: string;
  displayName: string;
  username?: string | null;
  role: ChatRole;
  timestamp: string;
  highlighted?: boolean;
  content: React.ReactNode;
  replyPreview?: React.ReactNode;
  footer?: React.ReactNode;
  compact?: boolean;
  actions?: React.ReactNode;
  league?: League | string | null;
  avatarUrl?: string | null;
  onContextProfile?: () => void;
};

export function DiscordMessageRow({
  avatarText,
  displayName,
  username,
  role,
  timestamp,
  highlighted,
  content,
  replyPreview,
  footer,
  compact,
  actions,
  league,
  avatarUrl,
  onContextProfile,
}: DiscordMessageRowProps) {
  const style = getChatRoleStyle(role);
  const showHeader = !compact;
  const fallbackInitial = `${(avatarText || displayName || 'U').trim().charAt(0).toUpperCase() || 'U'}.`;

  return (
    <div
      className={cn(
        'group grid min-w-0 max-w-full grid-cols-[2rem_minmax(0,1fr)] gap-x-2 overflow-hidden rounded-md px-2 py-2 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-x-3 sm:px-3 hover:bg-muted/40',
        compact && 'py-0.5',
        highlighted && 'bg-red-500/5 ring-1 ring-red-500/20 hover:bg-red-500/5'
      )}
    >
      <div className="w-8 sm:w-10">
        {showHeader ? (
          <Avatar className="h-8 w-8 border border-border/70 bg-muted/40 sm:h-9 sm:w-9">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
            <AvatarFallback className="bg-muted text-xs font-semibold">{fallbackInitial}</AvatarFallback>
          </Avatar>
        ) : (
          <div className="h-0 w-8 sm:w-10" />
        )}
      </div>

      <div className="min-w-0 w-full max-w-full">
        {showHeader && (
          <div
            className="min-w-0 w-full max-w-full"
            onContextMenu={(e) => {
              if (onContextProfile) {
                e.preventDefault();
                onContextProfile();
              }
            }}
          >
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
              <RoleBadge role={role} className="shrink-0" />
              <LeagueBadge league={league} className="shrink-0" />
              <span className={cn('min-w-0 max-w-full break-words text-sm font-semibold [overflow-wrap:anywhere]', style.nameClassName)}>
                {displayName}
              </span>
              {username ? (
                <span className="min-w-0 max-w-full break-all text-xs text-muted-foreground">
                  @{username}
                </span>
              ) : null}
            </div>

            <div className="mt-1 flex min-w-0 max-w-full items-center justify-between gap-2">
              <span className="min-w-0 text-[10px] text-muted-foreground break-words [overflow-wrap:anywhere]">
                {timestamp}
              </span>
            {actions ? (
                <div className="flex shrink-0 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                {actions}
                </div>
            ) : null}
            </div>
          </div>
        )}

        {replyPreview ? <div className={cn('min-w-0 w-full max-w-full', showHeader ? 'mt-1' : 'mt-0.5')}>{replyPreview}</div> : null}

        <div
          className={cn(
            'chat-message-content emoji-render min-w-0 w-full max-w-full overflow-hidden text-sm whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]',
            showHeader ? 'mt-0.5' : 'leading-5'
          )}
        >
          {content}
        </div>

        {footer ? <div className={cn(showHeader ? 'mt-2' : 'mt-1')}>{footer}</div> : null}
      </div>
    </div>
  );
}
