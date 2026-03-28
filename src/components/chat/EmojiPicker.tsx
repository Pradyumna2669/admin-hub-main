import React, { useMemo, useState } from 'react';
import Picker, { EmojiClickData, Theme } from 'emoji-picker-react';
import { useTheme } from 'next-themes';
import { SmilePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type EmojiPickerProps = {
  disabled?: boolean;
  onSelect: (emoji: string) => void;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  triggerClassName?: string;
  trigger?: React.ReactNode;
};

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  disabled,
  onSelect,
  align = 'end',
  side = 'top',
  triggerClassName,
  trigger,
}) => {
  const [open, setOpen] = useState(false);
  const { resolvedTheme } = useTheme();

  const pickerTheme = useMemo(
    () => (resolvedTheme === 'dark' ? Theme.DARK : Theme.LIGHT),
    [resolvedTheme]
  );

  const handleEmojiClick = (emojiData: EmojiClickData) => {
    onSelect(emojiData.emoji);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ? (
          <button
            type="button"
            disabled={disabled}
            className={cn('shrink-0', triggerClassName)}
            aria-label="Open emoji picker"
          >
            {trigger}
          </button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={disabled}
            className={cn('shrink-0 border-border/70 bg-background/80 backdrop-blur-sm', triggerClassName)}
            aria-label="Open emoji picker"
          >
            <SmilePlus className="h-4 w-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={10}
        className="w-auto rounded-2xl border-border/70 bg-popover/95 p-2 shadow-2xl backdrop-blur-xl"
      >
        <Picker
          onEmojiClick={handleEmojiClick}
          theme={pickerTheme}
          lazyLoadEmojis
          searchDisabled={false}
          skinTonesDisabled={false}
          width={352}
          height={420}
          previewConfig={{ showPreview: false }}
        />
      </PopoverContent>
    </Popover>
  );
};
