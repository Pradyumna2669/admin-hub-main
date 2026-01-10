import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Sparkles, Wand2, Link2 } from 'lucide-react';

const AdminAIGenerate: React.FC = () => {
  const [selectedLink, setSelectedLink] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [generatedContent, setGeneratedContent] = useState<{
    title: string;
    content: string;
    task_type: string;
    subreddit_flair: string;
  } | null>(null);

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const generateMutation = useMutation({
    mutationFn: async () => {
      const link = links?.find((l) => l.id === selectedLink);
      
      // Simulated AI generation - in production, this would call an AI API
      const taskTypes = ['comment', 'linked_comment', 'linked_post', 'normal_post'];
      const subreddits = ['stoicism', 'philosophy', 'selfimprovement', 'productivity', 'motivation'];
      
      return {
        title: `Promote ${link?.website_name || 'Website'} - ${new Date().toLocaleDateString()}`,
        content: customPrompt || `Check out this amazing resource on ${link?.website_name || 'our website'}. ${link?.promotion_content || 'Great content for self-improvement!'}`,
        task_type: taskTypes[Math.floor(Math.random() * taskTypes.length)],
        subreddit_flair: subreddits[Math.floor(Math.random() * subreddits.length)],
      };
    },
    onSuccess: (data) => {
      setGeneratedContent(data);
      toast({
        title: 'Content generated',
        description: 'AI has generated task content. Review and create the task.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Generation failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async () => {
      if (!generatedContent) throw new Error('No content to create');
      
      const link = links?.find((l) => l.id === selectedLink);
      
      const { error } = await supabase.from('tasks').insert({
        title: generatedContent.title,
        content: generatedContent.content,
        task_type: generatedContent.task_type as 'comment' | 'linked_comment' | 'linked_post' | 'normal_post',
        subreddit_flair: generatedContent.subreddit_flair,
        target_link: link?.url,
        ai_generated: true,
        created_by: user?.id,
      });

      if (error) throw error;

      // Mark link as processed
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
      setGeneratedContent(null);
      setSelectedLink('');
      setCustomPrompt('');
      toast({
        title: 'Task created',
        description: 'AI-generated task has been created successfully.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  return (
    <DashboardLayout isAdmin>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            AI Task Generator
          </h1>
          <p className="text-muted-foreground mt-1">
            Generate Reddit-ready content using AI
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Input Section */}
          <div className="stoic-card p-6 space-y-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-lg bg-accent/20">
                <Wand2 className="h-6 w-6 text-accent" />
              </div>
              <div>
                <h2 className="font-heading text-xl font-semibold text-foreground">
                  Generate Content
                </h2>
                <p className="text-sm text-muted-foreground">
                  Select a link and let AI create task content
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Select Link to Promote</Label>
                <Select value={selectedLink} onValueChange={setSelectedLink}>
                  <SelectTrigger className="bg-input border-border">
                    <SelectValue placeholder="Choose a link..." />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    {links?.map((link) => (
                      <SelectItem key={link.id} value={link.id}>
                        <span className="flex items-center gap-2">
                          <Link2 className="h-3 w-3" />
                          {link.website_name || link.url}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Custom Instructions (Optional)</Label>
                <Textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Add any specific instructions for the AI..."
                  className="bg-input border-border min-h-[100px]"
                />
              </div>

              <Button
                onClick={() => generateMutation.mutate()}
                disabled={!selectedLink || generateMutation.isPending}
                className="w-full stoic-button-primary"
              >
                {generateMutation.isPending ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Generating...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    Generate Content
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Output Section */}
          <div className="stoic-card p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-lg bg-primary/20">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h2 className="font-heading text-xl font-semibold text-foreground">
                  Generated Content
                </h2>
                <p className="text-sm text-muted-foreground">
                  Review and create the task
                </p>
              </div>
            </div>

            {generatedContent ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Title</Label>
                  <p className="text-foreground font-medium">{generatedContent.title}</p>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Content</Label>
                  <p className="text-foreground">{generatedContent.content}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Task Type</Label>
                    <p className="text-foreground capitalize">
                      {generatedContent.task_type.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground">Subreddit</Label>
                    <p className="text-foreground">r/{generatedContent.subreddit_flair}</p>
                  </div>
                </div>

                <Button
                  onClick={() => createTaskMutation.mutate()}
                  disabled={createTaskMutation.isPending}
                  className="w-full stoic-button-primary"
                >
                  {createTaskMutation.isPending ? 'Creating...' : 'Create Task'}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Sparkles className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">
                  Generated content will appear here
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="stoic-card p-6">
          <h3 className="font-heading text-lg font-semibold text-foreground mb-3">
            How it works
          </h3>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Add links in the Links section with promotion details</li>
            <li>Select a link to promote from the dropdown</li>
            <li>Optionally add custom instructions for the AI</li>
            <li>Click "Generate Content" to create AI-powered task content</li>
            <li>Review the generated content and create the task</li>
          </ol>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AdminAIGenerate;
