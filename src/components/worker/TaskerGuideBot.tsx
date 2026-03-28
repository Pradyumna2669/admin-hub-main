import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, RotateCcw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';

const MENU_OPTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'find-tasks', label: 'Find tasks' },
  { id: 'claim-task', label: 'Claim a task' },
  { id: 'submit-work', label: 'Submit work' },
  { id: 'track-tasks', label: 'Track my tasks' },
  { id: 'payments', label: 'Payments' },
  { id: 'chat', label: 'Chat with staff' },
  { id: 'profile', label: 'Profile & verification' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'rules', label: 'Rules & tips' },
];

type GuideAction = {
  label: string;
  to: string;
};

type GuideNode = {
  id: string;
  message: string;
  actions?: GuideAction[];
  options?: typeof MENU_OPTIONS;
};

type ChatMessage = {
  id: string;
  role: 'bot' | 'user';
  text: string;
  actions?: GuideAction[];
  options?: typeof MENU_OPTIONS;
};

const CHAT_ACTION: GuideAction = { label: 'Open Chat', to: '/worker/chat' };

const GUIDE_NODES: Record<string, GuideNode> = {
  welcome: {
    id: 'welcome',
    message:
      "Hi! I'm your Tasker Guide. Ask me how to use any part of the Tasker portal, or pick a topic below.",
    options: MENU_OPTIONS,
  },
  overview: {
    id: 'overview',
    message:
      'Your Tasker portal has 5 main areas:\n' +
      '- Dashboard: stats + recent tasks.\n' +
      '- Available Tasks: claim new work when eligible.\n' +
      '- My Tasks: submit, track status, and see deadlines.\n' +
      '- Chat: message staff for help.\n' +
      '- Payments: see earnings and proofs.',
    actions: [
      { label: 'Go to Dashboard', to: '/worker/dashboard' },
      { label: 'Go to Tasks', to: '/worker/tasks' },
      { label: 'Go to My Tasks', to: '/worker/my-tasks' },
      { label: 'Go to Payments', to: '/worker/payments' },
    ],
    options: MENU_OPTIONS,
  },
  'find-tasks': {
    id: 'find-tasks',
    message:
      'Open Available Tasks to browse work you can claim. Use search and filters, and check eligibility notes before claiming.\n' +
      'If a task is not available, it may already be claimed or your account may not meet requirements.',
    actions: [{ label: 'Open Available Tasks', to: '/worker/tasks' }],
    options: MENU_OPTIONS,
  },
  'claim-task': {
    id: 'claim-task',
    message:
      'When you claim a task, it moves to My Tasks. Some tasks have a cooldown between claims.\n' +
      'If you see a cooldown or eligibility warning, wait or use a qualified Reddit account.',
    actions: [
      { label: 'Open Available Tasks', to: '/worker/tasks' },
      { label: 'Open My Tasks', to: '/worker/my-tasks' },
    ],
    options: MENU_OPTIONS,
  },
  'submit-work': {
    id: 'submit-work',
    message:
      'Submit from My Tasks. You must add at least one submission link and (if required) upload screenshots.\n' +
      'After submission, the task enters manual verification and may take 24-48 hours.',
    actions: [{ label: 'Open My Tasks', to: '/worker/my-tasks' }],
    options: MENU_OPTIONS,
  },
  'track-tasks': {
    id: 'track-tasks',
    message:
      'My Tasks shows your timeline: Claimed > Submit task > Manual review > Approved > Settlement successful.\n' +
      'Statuses include In Progress, Under Verification, Payment Pending, and Paid.',
    actions: [{ label: 'Open My Tasks', to: '/worker/my-tasks' }],
    options: MENU_OPTIONS,
  },
  payments: {
    id: 'payments',
    message:
      'Payments shows total earnings plus each payout with transaction ID and proof.\n' +
      'If a task is Approved but not paid yet, it will show Payment Pending in My Tasks.',
    actions: [
      { label: 'Open Payments', to: '/worker/payments' },
      { label: 'Open My Tasks', to: '/worker/my-tasks' },
    ],
    options: MENU_OPTIONS,
  },
  chat: {
    id: 'chat',
    message:
      'Use Chat to message staff. Mentions are supported and you will get unread indicators in the sidebar.\n' +
      'For urgent issues, share the task title and what you already tried.',
    actions: [{ label: 'Open Chat', to: '/worker/chat' }],
    options: MENU_OPTIONS,
  },
  profile: {
    id: 'profile',
    message:
      'Profile & verification are required for task access. Add your Reddit account, CQS proof, and UPI ID.\n' +
      'If auto-verification fails, the account goes to manual review.',
    actions: [{ label: 'Open Profile', to: '/profile' }],
    options: MENU_OPTIONS,
  },
  notifications: {
    id: 'notifications',
    message:
      'Enable browser notifications to receive new task alerts.\n' +
      'If prompts are blocked, allow notifications for this site in your browser settings.',
    actions: [{ label: 'Open Dashboard', to: '/worker/dashboard' }],
    options: MENU_OPTIONS,
  },
  rules: {
    id: 'rules',
    message:
      'Follow Reddit and platform rules. Avoid spammy behavior, use only eligible accounts, and submit clear proof.\n' +
      'If a task seems unclear, ask staff in Chat before proceeding.',
    actions: [{ label: 'Open Chat', to: '/worker/chat' }],
    options: MENU_OPTIONS,
  },
  fallback: {
    id: 'fallback',
    message:
      "I might be missing context. I can help with tasks, submissions, payments, chat, profile, or notifications. Pick a topic below or open chat so staff can help directly.",
    actions: [CHAT_ACTION],
    options: MENU_OPTIONS,
  },
};

const INTENT_KEYWORDS: Array<{ id: string; keywords: string[] }> = [
  { id: 'overview', keywords: ['overview', 'portal', 'sections', 'pages', 'dashboard'] },
  { id: 'find-tasks', keywords: ['available', 'find', 'browse', 'tasks', 'task list'] },
  { id: 'claim-task', keywords: ['claim', 'cooldown', 'grab', 'take'] },
  { id: 'submit-work', keywords: ['submit', 'submission', 'proof', 'screenshot', 'link'] },
  { id: 'track-tasks', keywords: ['status', 'progress', 'timeline', 'my tasks', 'track'] },
  { id: 'payments', keywords: ['payment', 'paid', 'payout', 'earnings', 'transaction'] },
  { id: 'chat', keywords: ['chat', 'support', 'staff', 'help', 'message'] },
  { id: 'profile', keywords: ['profile', 'verification', 'verify', 'upi', 'cqs', 'reddit'] },
  { id: 'notifications', keywords: ['notification', 'alert', 'push'] },
  { id: 'rules', keywords: ['rule', 'policy', 'guideline', 'spam'] },
];

const findIntent = (input: string) => {
  const normalized = input.toLowerCase();
  for (const intent of INTENT_KEYWORDS) {
    if (intent.keywords.some((keyword) => normalized.includes(keyword))) {
      return intent.id;
    }
  }
  return 'fallback';
};

const pick = (options: string[]) => options[Math.floor(Math.random() * options.length)];

const intentSummary: Record<string, string> = {
  overview: 'a quick overview of the portal',
  'find-tasks': 'finding available tasks',
  'claim-task': 'claiming a task',
  'submit-work': 'submitting your work',
  'track-tasks': 'tracking your task status',
  payments: 'payments and earnings',
  chat: 'chatting with staff',
  profile: 'profile and verification',
  notifications: 'notifications and alerts',
  rules: 'rules and tips',
  fallback: 'something else',
};

const buildBotMessage = (nodeId: string): ChatMessage => {
  const node = GUIDE_NODES[nodeId] || GUIDE_NODES.fallback;
  const summary = intentSummary[nodeId] || intentSummary.fallback;
  const shouldPreface = nodeId !== 'welcome';
  const preface = shouldPreface
    ? pick([
        `Sounds like you're asking about ${summary}.`,
        `I think this is about ${summary}.`,
        `Got it. Here is what to do for ${summary}.`,
      ])
    : '';
  const followUp = nodeId === 'fallback'
    ? '\n\nIf this still does not answer it, please open chat and include the task title or a screenshot.'
    : '\n\nIf something is unclear, open chat and we will help.';
  return {
    id: `${node.id}-${Date.now()}`,
    role: 'bot',
    text: `${preface ? `${preface}\n\n` : ''}${node.message}${followUp}`,
    actions: node.actions ? [...node.actions] : undefined,
    options: node.options,
  };
};

const TaskerGuideBot: React.FC = () => {
  const { userRole } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([buildBotMessage('welcome')]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const lastBotIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'bot') return i;
    }
    return -1;
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  if (userRole !== 'worker') return null;

  const addUserMessage = (text: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        role: 'user',
        text,
      },
    ]);
  };

  const addBotNode = (nodeId: string) => {
    setMessages((prev) => [...prev, buildBotMessage(nodeId)]);
  };

  const handleOption = (optionId: string, label: string) => {
    addUserMessage(label);
    addBotNode(optionId);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    addUserMessage(trimmed);
    const intent = findIntent(trimmed);
    addBotNode(intent);
    setInput('');
  };

  const handleReset = () => {
    setMessages([buildBotMessage('welcome')]);
    setInput('');
  };

  return (
    <>
      <Button
        type="button"
        className={cn(
          'fixed bottom-4 left-4 z-40 max-w-[calc(100vw-2rem)] gap-2 rounded-full px-4 py-3 shadow-lg sm:bottom-5 sm:left-auto sm:right-5',
          open ? 'hidden' : ''
        )}
        onClick={() => setOpen(true)}
      >
        <MessageCircle className="h-4 w-4" />
        Tasker Guide
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? 'bottom' : 'right'}
          className={cn(
            'flex flex-col gap-4 border-border bg-background',
            isMobile ? 'h-[85vh] rounded-t-2xl' : 'w-full sm:max-w-md'
          )}
        >
          <SheetHeader className="flex-row items-center justify-between space-y-0">
            <SheetTitle>Tasker Guide</SheetTitle>
            <Button type="button" variant="ghost" size="sm" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset
            </Button>
          </SheetHeader>

          <ScrollArea className="flex-1 rounded-lg border border-border bg-card/40 p-3">
            <div className="space-y-4">
              {messages.map((message, index) => {
                const isBot = message.role === 'bot';
                const isLastBot = index === lastBotIndex && isBot;
                return (
                  <div key={message.id} className={cn('flex', isBot ? 'justify-start' : 'justify-end')}>
                    <div className={cn('max-w-[85%] space-y-3')}
                    >
                      <div
                        className={cn(
                          'rounded-2xl px-4 py-3 text-sm shadow-sm',
                          isBot
                            ? 'bg-muted text-foreground'
                            : 'bg-primary text-primary-foreground'
                        )}
                      >
                        <div className="whitespace-pre-line">{message.text}</div>
                      </div>

                      {isLastBot && message.actions && message.actions.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {message.actions.map((action) => (
                            <Button
                              key={action.label}
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(action.to)}
                            >
                              {action.label}
                            </Button>
                          ))}
                        </div>
                      )}

                      {isLastBot && message.options && message.options.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {message.options.map((option) => (
                            <Button
                              key={option.id}
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => handleOption(option.id, option.label)}
                            >
                              {option.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <div className="flex items-center gap-2">
            <Input
              value={input}
              placeholder="Ask about tasks, payments, verification..."
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button type="button" onClick={handleSend}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default TaskerGuideBot;





