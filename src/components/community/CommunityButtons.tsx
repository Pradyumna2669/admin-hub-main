import React from 'react';
import { Button } from '@/components/ui/button';
import { FaDiscord, FaTelegramPlane } from 'react-icons/fa';
import { DISCORD_INVITE_URL, TELEGRAM_URL } from '@/lib/communityLinks';

interface CommunityButtonsProps {
  compact?: boolean;
  className?: string;
}

export const CommunityButtons: React.FC<CommunityButtonsProps> = ({ compact = false, className }) => {
  const sizeClass = compact ? 'sm' : 'default';

  return (
    <div className={`flex flex-wrap gap-3 ${className || ''}`.trim()}>
      <Button
        asChild
        size={sizeClass as 'sm' | 'default'}
        className="bg-[#5865F2] hover:bg-[#4752C4] text-white shadow-[0_14px_30px_rgba(88,101,242,0.28)]"
      >
        <a href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
          <FaDiscord className="mr-2 h-4 w-4" />
          Join Discord
        </a>
      </Button>
      <Button
        asChild
        size={sizeClass as 'sm' | 'default'}
        className="bg-[#229ED9] hover:bg-[#1B8FC4] text-white shadow-[0_14px_30px_rgba(34,158,217,0.26)]"
      >
        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer">
          <FaTelegramPlane className="mr-2 h-4 w-4" />
          Join Telegram
        </a>
      </Button>
    </div>
  );
};
