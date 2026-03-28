import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { type ChatRole, getChatRoleStyle } from '@/lib/chatRoleStyles';

type RoleBadgeProps = {
  role: ChatRole;
  className?: string;
};

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const style = getChatRoleStyle(role);
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-5 px-2 text-[11px] font-semibold leading-none tracking-wide',
        style.badgeClassName,
        className
      )}
    >
      {style.label}
    </Badge>
  );
}

