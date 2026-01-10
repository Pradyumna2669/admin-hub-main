import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
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
  PlayCircle
} from 'lucide-react';

interface Task {
  id: string;
  title: string;
  content: string | null;
  task_type: 'comment' | 'linked_comment' | 'linked_post' | 'normal_post';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  subreddit_flair: string | null;
  target_link: string | null;
  ai_generated: boolean | null;
  created_at: string;
}

interface TaskCardProps {
  task: Task;
  onStatusChange?: (taskId: string, newStatus: Task['status']) => void;
  showActions?: boolean;
}

const taskTypeIcons = {
  comment: MessageSquare,
  linked_comment: Link2,
  linked_post: ExternalLink,
  normal_post: FileText,
};

const statusColors = {
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  in_progress: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const statusIcons = {
  pending: Clock,
  in_progress: PlayCircle,
  completed: CheckCircle2,
  cancelled: XCircle,
};

export const TaskCard: React.FC<TaskCardProps> = ({ task, onStatusChange, showActions = true }) => {
  const TypeIcon = taskTypeIcons[task.task_type];
  const StatusIcon = statusIcons[task.status];

  return (
    <div className="stoic-card p-6 hover:border-primary/30 transition-all duration-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <TypeIcon className="h-4 w-4 text-primary" />
            </div>
            <h3 className="font-heading text-lg font-medium text-foreground truncate">
              {task.title}
            </h3>
            {task.ai_generated && (
              <Badge variant="outline" className="border-accent text-accent">
                <Sparkles className="h-3 w-3 mr-1" />
                AI
              </Badge>
            )}
          </div>

          {task.content && (
            <p className="text-muted-foreground text-sm mb-3 line-clamp-2">
              {task.content}
            </p>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <Badge className={cn('border', statusColors[task.status])}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {task.status.replace('_', ' ')}
            </Badge>

            <Badge variant="secondary" className="capitalize">
              {task.task_type.replace('_', ' ')}
            </Badge>

            {task.subreddit_flair && (
              <Badge variant="outline">
                r/{task.subreddit_flair}
              </Badge>
            )}
          </div>
        </div>

        {showActions && onStatusChange && (
          <div className="flex flex-col gap-2">
            {task.status === 'pending' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onStatusChange(task.id, 'in_progress')}
                className="text-xs"
              >
                Start
              </Button>
            )}
            {task.status === 'in_progress' && (
              <Button
                size="sm"
                onClick={() => onStatusChange(task.id, 'completed')}
                className="text-xs stoic-button-primary"
              >
                Complete
              </Button>
            )}
          </div>
        )}
      </div>

      {task.target_link && (
        <a
          href={task.target_link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="truncate">{task.target_link}</span>
        </a>
      )}

      <p className="text-xs text-muted-foreground mt-4">
        Created {new Date(task.created_at).toLocaleDateString()}
      </p>
    </div>
  );
};
