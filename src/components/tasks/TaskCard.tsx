import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import {
  MessageSquare,
  Link2,
  FileText,
  ExternalLink,
  Sparkles,
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Send,
  Edit2,
  Trash,
  Lock,
  Copy,
} from 'lucide-react';
import { getTaskTypeLabel, normalizeTaskType } from '@/lib/taskTypes';

interface Task {
  id: string;
  public_order_code?: string | null;
  title: string;
  instruction?: string | null;
  content: string | null;
  task_type: string;
  status: 'pending' | 'in_progress' | 'submitted' | 'completed' | 'cancelled';
  subreddit_flair: string | null;
  target_link: string | null;
  ai_generated: boolean | null;
  created_at: string;
  task_assignments?: Array<{
    user_id?: string | null;
    status?: string | null;
    started_at?: string | null;
    reddit_accounts?: {
      reddit_username?: string | null;
    } | null;
    profiles?: {
      full_name?: string | null;
      email?: string | null;
      reddit_username?: string | null;
      cqs?: string | null;
      league?: string | null;
      karma?: number | null;
    } | null;
  }>;
}

interface TaskCardProps {
  task: Task;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
  onSubmit?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  showActions?: boolean;
  onDelete?: (taskId: string) => void;
  locked?: boolean;
  lockReasons?: string[];
  onStart?: () => void;
  showDetails?: boolean;
  startLabel?: string;
  highlighted?: boolean;
  containerId?: string;
  onCopyLink?: () => void;
}

const taskTypeIcons: Record<string, any> = {
  normal_comment: MessageSquare,
  support_comment: MessageSquare,
  linked_comments: Link2,
  non_linked_crosspost: ExternalLink,
  linked_post_crosspost: ExternalLink,
  non_linked_post: FileText,
  linked_post: ExternalLink,

  // Legacy
  comment: MessageSquare,
  linked_comment: Link2,
  normal_post: FileText,
};

const statusColors = {
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  in_progress: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  submitted: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  completed: 'bg-green-500/20 text-green-500 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-500 border-red-500/30',
};

const statusIcons = {
  pending: Clock,
  in_progress: PlayCircle,
  submitted: Send,
  completed: CheckCircle2,
  cancelled: XCircle,
};

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onEdit,
  showActions = true,
  onDelete,
  locked = false,
  lockReasons = [],
  onStart,
  showDetails = true,
  startLabel = 'Start',
  highlighted = false,
  containerId,
  onCopyLink,
}) => {
  const normalizedType = normalizeTaskType(task.task_type) || task.task_type;
  const TypeIcon = taskTypeIcons[normalizedType] || FileText;
  const StatusIcon = statusIcons[task.status];
  const isAlreadyClaimed = lockReasons.some((reason) =>
    reason.toLowerCase().includes('already claimed')
  );

  const MagneticButton = ({ children, className, onClick, disabled }: any) => {
    const ref = useRef<HTMLButtonElement>(null);
    const [position, setPosition] = useState({ x: 0, y: 0 });

    const handleMouse = (e: React.MouseEvent<HTMLButtonElement>) => {
      const { clientX, clientY } = e;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const { height, width, left, top } = rect;
      const middleX = clientX - (left + width / 2);
      const middleY = clientY - (top + height / 2);
      setPosition({ x: middleX * 0.25, y: middleY * 0.25 });
    };

    const reset = () => setPosition({ x: 0, y: 0 });

    return (
      <motion.button
        type="button"
        ref={ref}
        onMouseMove={handleMouse}
        onMouseLeave={reset}
        animate={{ x: position.x, y: position.y }}
        transition={{ type: "spring", stiffness: 150, damping: 15, mass: 0.1 }}
        className={cn("inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 shadow-lg", className)}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </motion.button>
    );
  };
  const claimedAssignment =
    task.task_assignments?.find((assignment) => assignment.status && assignment.status !== 'cancelled') ||
    null;
  const claimedProfile = claimedAssignment?.profiles;
  const claimedAccount = claimedAssignment?.reddit_accounts;
  const claimedName =
    claimedProfile?.full_name ||
    claimedProfile?.email ||
    claimedProfile?.reddit_username ||
    claimedAssignment?.user_id;

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  return (
    <div
      id={containerId}
      className={cn(
        'stoic-card p-6 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_24px_60px_hsl(var(--primary)/0.12)] transition-all duration-200 overflow-hidden w-full min-w-0',
        highlighted && 'border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.6),0_24px_60px_hsl(var(--primary)/0.18)]'
      )}
    >

      {/* MAIN CONTAINER */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4 w-full min-w-0">

        {/* LEFT CONTENT */}
        <div className="flex-1 w-full min-w-0">

          {/* TITLE */}
          <div className="flex items-start gap-3 mb-2 w-full min-w-0">
            <div className="p-2 rounded-lg bg-primary/10 shrink-0">
              <TypeIcon className="h-4 w-4 text-primary" />
            </div>

            <div className="flex-1 w-full min-w-0">
              <h3 className="font-heading text-base sm:text-lg font-medium text-foreground break-words">
                {task.title}
              </h3>
            </div>

            {task.ai_generated && (
              <Badge variant="outline" className="border-accent text-accent shrink-0">
                <Sparkles className="h-3 w-3 mr-1" />
                AI
              </Badge>
            )}
          </div>

          {/* FLAIRS */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <Badge className={cn('border', statusColors[task.status])}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {task.status.replace('_', ' ')}
            </Badge>

            <Badge variant="outline">Task ID: {task.id}</Badge>

            {task.public_order_code && (
              <Badge variant="outline">Order: {task.public_order_code}</Badge>
            )}

            <Badge variant="secondary" className="capitalize">
              {getTaskTypeLabel(task.task_type)}
            </Badge>

            {task.subreddit_flair && (
              <Badge variant="outline" className="break-words">
                r/{task.subreddit_flair}
              </Badge>
            )}

            {onCopyLink && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={onCopyLink}
              >
                <Link2 className="h-3 w-3 mr-1" />
                Copy Link
              </Button>
            )}
          </div>

          {showDetails && task.instruction && (
            <div className="bg-muted/40 p-4 rounded-md mb-4">
              <p className="text-sm font-medium mb-2">Instruction</p>
              <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">
                {task.instruction}
              </p>
            </div>
          )}

          {showDetails && task.content && (
            <div className="bg-muted/40 p-4 rounded-md mb-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-medium">Content</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2"
                  onClick={() => copyToClipboard(task.content || '')}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground break-words whitespace-pre-wrap">
                {task.content}
              </p>
            </div>
          )}

          {claimedAssignment && claimedName && (
            <div className="bg-muted/40 p-4 rounded-md mb-4">
              <p className="text-sm font-medium mb-2">Claimed By</p>
              <div className="space-y-1 text-sm text-muted-foreground">
                <p className="text-foreground font-medium">{claimedName}</p>
                {claimedAccount?.reddit_username && (
                  <p>Account: u/{claimedAccount.reddit_username}</p>
                )}
                {claimedProfile?.reddit_username && (
                  <p>Reddit: u/{claimedProfile.reddit_username}</p>
                )}
                {claimedProfile?.email && claimedProfile?.email !== claimedName && (
                  <p>Email: {claimedProfile.email}</p>
                )}
                {claimedProfile?.cqs && <p>CQS: {claimedProfile.cqs}</p>}
                {claimedProfile?.league && <p>League: {claimedProfile.league}</p>}
                {typeof claimedProfile?.karma === 'number' && <p>Karma: {claimedProfile.karma}</p>}
                {claimedAssignment.started_at && (
                  <p>Claimed at: {new Date(claimedAssignment.started_at).toLocaleString()}</p>
                )}
              </div>
            </div>
          )}

          {!showDetails && (
            <div className="mb-4 rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Task details unlock after you claim this task. Full instructions and content will appear in My Tasks.
            </div>
          )}
        </div>

        {/* RIGHT ACTIONS */}
        {showActions && (
          <div className="flex flex-row sm:flex-col gap-2 w-full sm:w-auto">

            {onStart && !locked && (
              <MagneticButton
                size="sm"
                onClick={onStart}
                className="stoic-button-primary text-xs w-full sm:w-auto hover:scale-105 shadow-purple-500/20"
              >
                <PlayCircle className="h-3 w-3 mr-1" />
                {startLabel}
              </MagneticButton>
            )}

            {locked && (
              <div
                className={cn(
                  'text-xs flex items-start gap-2 w-full',
                  isAlreadyClaimed ? 'text-amber-600' : 'text-red-500'
                )}
              >
                <Lock className="h-4 w-4 shrink-0 mt-1" />
                <div className="break-words">
                  <div className="font-semibold">
                    {isAlreadyClaimed ? 'Already Claimed' : 'Unavailable'}
                  </div>
                  {lockReasons.map((r, i) => (
                    <div key={i}>{r}</div>
                  ))}
                </div>
              </div>
            )}

            {onEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(task)}
                className="text-xs w-full sm:w-auto"
              >
                <Edit2 className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}

            {onDelete && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs text-red-500 w-full sm:w-auto"
                onClick={() => {
                  if (confirm('Delete this task?')) {
                    onDelete(task.id);
                  }
                }}
              >
                <Trash className="h-3 w-3 mr-1" />
                Delete
              </Button>
            )}
          </div>
        )}
      </div>

      {/* TARGET LINK FULLY VISIBLE */}
      {showDetails && task.target_link && (
        <a
          href={task.target_link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 flex items-start gap-2 text-sm text-primary hover:text-primary/80 w-full min-w-0"
        >
          <ExternalLink className="h-4 w-4 shrink-0 mt-1" />
          <span className="break-all whitespace-pre-wrap w-full">
            {task.target_link}
          </span>
        </a>
      )}

      {/* DATE */}
      <p className="text-xs text-muted-foreground mt-5 break-words">
        Created {new Date(task.created_at).toLocaleDateString()}
      </p>
    </div>
  );
};
