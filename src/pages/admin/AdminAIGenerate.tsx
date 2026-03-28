import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Wand2, Link2 } from 'lucide-react';
import { useTaskTypeRates } from '@/hooks/useTaskTypeRates';
import { getTaskTypeLabel, TaskType } from '@/lib/taskTypes';
import { sendNewTaskPushes } from '@/lib/taskPush';
import { sendNewTaskDiscord } from '@/lib/taskDiscord';
import { createTaskIdentifiers } from '@/lib/taskIdentifiers';

type GeneratedItem = {
  type?: 'comment' | 'linked_comment' | 'linked_post' | 'normal_post' | string;
  title?: string | null;
  body?: string | null;
  tone?: string | null;
  relevance_score?: number | null;
};

const AdminAIGenerate: React.FC = () => {
  const [selectedLink, setSelectedLink] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generatedItems, setGeneratedItems] = useState<GeneratedItem[]>([]);

  const [createMetaOpen, setCreateMetaOpen] = useState(false);
  const [taskMeta, setTaskMeta] = useState({
    category_id: '',
    task_type: 'normal_comment' as TaskType,
    instruction: '',
    subreddit_flair: '',
    task_completion_time: '60',
    minimum_karma: '',
    cqs_levels: [] as string[],
  });

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: taskTypeRates } = useTaskTypeRates();

  const { data: categories } = useQuery({
    queryKey: ['admin-categories-list'],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name').order('name');
      return data || [];
    },
  });

  // ---- Load links ----
  const { data: links } = useQuery({
    queryKey: ['admin-links-for-ai'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('links')
        .select('*')
        .eq('processed', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  // ==================================================
  //   GENERATE CONTENT
  // ==================================================
  const generateMutation = useMutation({
    mutationFn: async () => {
      const link = links?.find((l) => l.id === selectedLink);

      if (!link) {
        throw new Error("Please select a website entry");
      }

      const payload = {
        website_name: link.website_name || "Brand",
        promotion_content: link.promotion_content || "",
        custom_prompt: customPrompt || "",
      };

      const ENDPOINT =
        "https://n8n.stoic-ops.com/webhook/admin/content/ai-generate";

      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let raw = await response.text();

      if (!raw) {
        throw new Error("AI workflow returned empty response");
      }

      let data: any;

      try {
        data = JSON.parse(raw);
      } catch {
        console.error("Invalid JSON:", raw);
        throw new Error("Workflow returned invalid JSON");
      }

      // ---- unwrap n8n array response ----
      if (Array.isArray(data) && data.length > 0) {
        data = data[0];
      }

      if (data.success && data.items) {
        return data.items;
      }

      throw new Error("Unexpected AI response format");
    },

    onSuccess: (items) => {
      setGeneratedItems(items);

      toast({
        title: "Content generated",
        description: `Received ${items.length} items`,
      });
    },

    onError: (error: any) => {
      toast({
        title: "Generation failed",
        description: error.message || "Unknown error",
        variant: "destructive",
      });
    },
  });

  // ==================================================
  //   CREATE TASKS (BULK)
  // ==================================================
  const createTasksMutation = useMutation({
    mutationFn: async () => {
      if (!generatedItems.length) {
        throw new Error("No content to create");
      }

      if (!taskMeta.category_id) {
        throw new Error('Category is required');
      }

      if (!taskMeta.task_type) {
        throw new Error('Task type is required');
      }

      if (!taskMeta.instruction?.trim()) {
        throw new Error('Task instruction is required');
      }

      if (!taskMeta.task_completion_time || parseInt(taskMeta.task_completion_time, 10) <= 0) {
        throw new Error('Task completion time must be greater than 0');
      }

      if (!user?.id) {
        throw new Error('Not logged in');
      }

      const link = links?.find((l) => l.id === selectedLink);
      const taskTitle = link?.website_name || link?.url || 'AI Generated';

      const tasks = generatedItems.map((item) => {
        const identifiers = createTaskIdentifiers();
        return {
          id: identifiers.id,
          public_order_code: identifiers.publicOrderCode,
          title: taskTitle,
          content: item.body || "",
          instruction: taskMeta.instruction,
          task_type: taskMeta.task_type,
          subreddit_flair: taskMeta.subreddit_flair || null,
          target_link: link?.url,
          ai_generated: true,
          category_id: taskMeta.category_id,
          amount: taskTypeRates?.[taskMeta.task_type] ?? 0,
          task_completion_time: parseInt(taskMeta.task_completion_time, 10) || 60,
          minimum_karma: taskMeta.minimum_karma ? parseInt(taskMeta.minimum_karma, 10) : null,
          cqs_levels: taskMeta.cqs_levels,
          created_by: user.id,
        };
      });

      const { data: createdTasks, error } = await supabase.from('tasks').insert(tasks).select('id');
      if (error) throw error;

      const createdIds = (createdTasks || []).map((task) => task.id);
      await sendNewTaskPushes(createdIds);
      await sendNewTaskDiscord(createdIds);

      if (selectedLink) {
        await supabase
          .from('links')
          .update({ processed: true })
          .eq('id', selectedLink);
      }
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['admin-links-for-ai'] });

      setGeneratedItems([]);
      setSelectedLink('');
      setCustomPrompt('');
      setCreateMetaOpen(false);
      setTaskMeta({
        category_id: '',
        task_type: 'normal_comment',
        instruction: '',
        subreddit_flair: '',
        task_completion_time: '60',
        minimum_karma: '',
        cqs_levels: [],
      });

      toast({
        title: 'Tasks created',
        description: 'All AI-generated tasks saved',
      });
    },

    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // ==================================================
  //   UI
  // ==================================================
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="font-heading text-3xl font-bold">
            AI Task Generator
          </h1>
          <p className="text-muted-foreground mt-1">
            Generate Reddit-ready content using AI
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* GENERATOR */}
          <div className="stoic-card p-6 space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <Wand2 className="h-6 w-6 text-accent" />
              <h2 className="font-heading text-xl font-semibold">
                Generate Content
              </h2>
            </div>

            <div className="space-y-4">
              <Label>Select Link</Label>
              <Select value={selectedLink} onValueChange={setSelectedLink}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a link..." />
                </SelectTrigger>

                <SelectContent>
                  {links?.map((link) => (
                    <SelectItem key={link.id} value={link.id}>
                      <Link2 className="h-3 w-3 inline mr-2" />
                      {link.website_name || link.url}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Label>Custom Prompt</Label>
              <Textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g. generate 10 supportive comments"
              />

              <Button
                onClick={() => generateMutation.mutate()}
                disabled={!selectedLink || generateMutation.isPending}
                className="w-full"
              >
                {generateMutation.isPending
                  ? "Generating..."
                  : "Generate Content"}
              </Button>
            </div>
          </div>

          {/* OUTPUT */}
          <div className="stoic-card p-6 space-y-4">
            {generatedItems.length > 0 ? (
              <>
                <Label>Generated Comments</Label>

                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {generatedItems.map((item, index) => (
                    <div
                      key={index}
                      className="border p-3 rounded-md text-sm"
                    >
                      {item.body}
                    </div>
                  ))}
                </div>

                <Button
                  onClick={() => setCreateMetaOpen(true)}
                  disabled={createTasksMutation.isPending}
                  className="w-full"
                >
                  Create All Tasks
                </Button>
              </>
            ) : (
              <p className="text-muted-foreground text-center">
                Generated content will appear here
              </p>
            )}
          </div>
        </div>
      </div>

      <Dialog open={createMetaOpen} onOpenChange={setCreateMetaOpen}>
        <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader className="sticky top-0 bg-card z-10">
            <DialogTitle className="font-heading">Task Details</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pb-2">
            <p className="text-sm text-muted-foreground">
              Task title will be the selected linkâ€™s website name (or URL). Task type and instruction apply to all tasks created from this batch.
            </p>

            <div className="space-y-2">
              <Label>Category *</Label>
              <Select
                value={taskMeta.category_id}
                onValueChange={(value) => setTaskMeta((s) => ({ ...s, category_id: value }))}
              >
                <SelectTrigger className="bg-input border-border">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {(categories || []).map((cat: any) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Task Type *</Label>
                <Select
                  value={taskMeta.task_type}
                  onValueChange={(value) => setTaskMeta((s) => ({ ...s, task_type: value as TaskType }))}
                >
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="normal_comment">{getTaskTypeLabel('normal_comment')}</SelectItem>
                    <SelectItem value="support_comment">{getTaskTypeLabel('support_comment')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Subreddit Flair (optional)</Label>
                <Input
                  value={taskMeta.subreddit_flair}
                  onChange={(e) => setTaskMeta((s) => ({ ...s, subreddit_flair: e.target.value }))}
                  placeholder="e.g. stoicism"
                  className="bg-input border-border"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Instruction *</Label>
              <Textarea
                value={taskMeta.instruction}
                onChange={(e) => setTaskMeta((s) => ({ ...s, instruction: e.target.value }))}
                placeholder="Instructions shown to workers (common for all tasks in this batch)"
                className="bg-input border-border min-h-[90px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payout (₹)</Label>
                <Input
                  type="number"
                  value={taskTypeRates?.[taskMeta.task_type] ?? 0}
                  readOnly
                  className="bg-input border-border"
                />
                <p className="text-xs text-muted-foreground">
                  Payout is set from Task Settings.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Task Completion Time (minutes) *</Label>
                <Input
                  type="number"
                  min="1"
                  value={taskMeta.task_completion_time}
                  onChange={(e) => setTaskMeta((s) => ({ ...s, task_completion_time: e.target.value }))}
                  placeholder="60"
                  required
                  className="bg-input border-border"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Minimum Karma</Label>
                <Select
                  value={taskMeta.minimum_karma}
                  onValueChange={(value) => setTaskMeta((s) => ({ ...s, minimum_karma: value }))}
                >
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue placeholder="Select minimum karma" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="0">No Minimum</SelectItem>
                    <SelectItem value="1">&lt;1K</SelectItem>
                    <SelectItem value="1000">1K+</SelectItem>
                    <SelectItem value="5000">5K+</SelectItem>
                    <SelectItem value="10000">10K+</SelectItem>
                    <SelectItem value="50000">50K+</SelectItem>
                    <SelectItem value="100000">100K+</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>CQS Level(s)</Label>
                <Select
                  value={taskMeta.cqs_levels[0] || ''}
                  onValueChange={(value) => setTaskMeta((s) => ({ ...s, cqs_levels: value ? [value] : [] }))}
                >
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue placeholder="Select CQS level(s)" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="Highest">Highest</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Moderate">Moderate</SelectItem>
                    <SelectItem value="Low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

              <Button
                onClick={() => createTasksMutation.mutate()}
                disabled={createTasksMutation.isPending || !taskMeta.category_id || !taskMeta.instruction.trim()}
                className="w-full"
              >
              {createTasksMutation.isPending ? 'Creating...' : `Create ${generatedItems.length} Tasks`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminAIGenerate;
