import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Link2, ExternalLink, Trash2, Check } from 'lucide-react';

const AdminLinks: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [newLink, setNewLink] = useState({
    url: '',
    website_name: '',
    promotion_content: '',
  });

  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: links, isLoading } = useQuery({
    queryKey: ['admin-links'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('links')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const createLinkMutation = useMutation({
    mutationFn: async (link: typeof newLink) => {
      const { data, error } = await supabase
        .from('links')
        .insert({
          ...link,
          created_by: user?.id,
        })
        .select()
        .single();

      if (error) throw error;

      // Log activity for link creation
      if (data) {
        await supabase.from('activity_logs').insert({
          user_id: user?.id,
          action: 'link_created',
          entity_type: 'link',
          entity_id: data.id,
          details: {
            url: data.url,
            website_name: data.website_name,
            promotion_content: data.promotion_content,
            created_by: user?.email || user?.id,
            created_at: data.created_at,
          },
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-links'] });
      setIsOpen(false);
      setNewLink({ url: '', website_name: '', promotion_content: '' });
      toast({
        title: 'Link added',
        description: 'The link has been added successfully.',
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

  const deleteLinkMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('links').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-links'] });
      toast({
        title: 'Link deleted',
        description: 'The link has been removed.',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createLinkMutation.mutate(newLink);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-3xl font-bold text-foreground">
              Links
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage promotion links for AI task generation
            </p>
          </div>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="stoic-button-primary">
                <Plus className="h-4 w-4 mr-2" />
                Add Link
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-heading">Add New Link</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>URL</Label>
                  <Input
                    value={newLink.url}
                    onChange={(e) => setNewLink({ ...newLink, url: e.target.value })}
                    placeholder="https://example.com"
                    type="url"
                    required
                    className="bg-input border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Website Name</Label>
                  <Input
                    value={newLink.website_name}
                    onChange={(e) => setNewLink({ ...newLink, website_name: e.target.value })}
                    placeholder="My Website"
                    className="bg-input border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Promotion Content</Label>
                  <Textarea
                    value={newLink.promotion_content}
                    onChange={(e) => setNewLink({ ...newLink, promotion_content: e.target.value })}
                    placeholder="What needs to be promoted?"
                    className="bg-input border-border min-h-[100px]"
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full stoic-button-primary"
                  disabled={createLinkMutation.isPending}
                >
                  {createLinkMutation.isPending ? 'Adding...' : 'Add Link'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Links Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : links && links.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {links.map((link) => (
              <div
                key={link.id}
                className="stoic-card p-6 hover:border-primary/30 transition-all duration-200"
              >
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Link2 className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex items-center gap-2">
                    {link.processed && (
                      <Badge variant="outline" className="border-green-500/30 text-green-400">
                        <Check className="h-3 w-3 mr-1" />
                        Processed
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteLinkMutation.mutate(link.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <h3 className="font-heading font-medium text-foreground mb-1">
                  {link.website_name || 'Unnamed Link'}
                </h3>

                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 transition-colors mb-3 truncate"
                >
                  <ExternalLink className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{link.url}</span>
                </a>

                {link.promotion_content && (
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {link.promotion_content}
                  </p>
                )}

                <p className="text-xs text-muted-foreground mt-4">
                  Added {new Date(link.created_at).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="stoic-card p-12 text-center">
            <Link2 className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-xl font-semibold text-foreground mb-2">
              No links yet
            </h3>
            <p className="text-muted-foreground">
              Add links to generate AI-powered tasks
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminLinks;
