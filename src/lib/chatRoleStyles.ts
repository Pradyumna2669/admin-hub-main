export type ChatRole = 'owner' | 'admin' | 'moderator' | 'worker' | 'client' | 'staff' | null;

export type ChatRoleStyle = {
  label: string;
  badgeClassName: string;
  nameClassName: string;
};

const STYLES: Record<Exclude<ChatRole, null>, ChatRoleStyle> = {
  owner: {
    label: 'Owner',
    badgeClassName:
      'border-transparent bg-gradient-to-r from-amber-400 via-orange-500 to-fuchsia-500 text-white shadow-sm',
    nameClassName: 'bg-gradient-to-r from-amber-300 via-orange-400 to-fuchsia-400 bg-clip-text text-transparent',
  },
  admin: {
    label: 'Admin',
    badgeClassName: 'border-transparent bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-sm',
    nameClassName: 'text-rose-400',
  },
  moderator: {
    label: 'Moderator',
    badgeClassName: 'border-transparent bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-sm',
    nameClassName: 'text-amber-300',
  },
  staff: {
    label: 'Staff',
    badgeClassName: 'border-transparent bg-gradient-to-r from-violet-500 to-indigo-600 text-white shadow-sm',
    nameClassName: 'text-violet-300',
  },
  worker: {
    label: 'Tasker',
    badgeClassName: 'border-transparent bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-sm',
    nameClassName: 'text-cyan-300',
  },
  client: {
    label: 'Client',
    badgeClassName: 'border-transparent bg-gradient-to-r from-emerald-500 to-green-600 text-white shadow-sm',
    nameClassName: 'text-emerald-300',
  },
};

export const getChatRoleStyle = (role: ChatRole): ChatRoleStyle => {
  if (!role) {
    return {
      label: 'Member',
      badgeClassName: 'border-border bg-muted text-muted-foreground',
      nameClassName: 'text-foreground',
    };
  }
  return STYLES[role];
};
