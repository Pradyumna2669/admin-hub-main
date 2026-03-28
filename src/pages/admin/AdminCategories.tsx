import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES, useTaskClaimSettings } from '@/hooks/useTaskClaimSettings';
import { Plus, Trash2, Edit2, FolderPlus, Copy } from 'lucide-react';

interface Category {
  id: string;
  name: string;
  description: string | null;
  claim_cooldown_minutes: number | null;
  created_at: string;
  task_count?: number;
}

const AdminCategories: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { data: taskClaimSettings } = useTaskClaimSettings();
  const defaultCooldownMinutes = taskClaimSettings?.claim_cooldown_minutes ?? DEFAULT_TASK_CLAIM_COOLDOWN_MINUTES;
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    claim_cooldown_minutes: String(defaultCooldownMinutes),
  });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const navigate = useNavigate();

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: categories, isLoading } = useQuery({
    queryKey: ['admin-categories'],
    queryFn: async () => {
      const { data: cats } = await supabase
        .from('categories')
        .select('*')
        .order('name');

      // Get task counts for each category
      const withCounts = await Promise.all(
        (cats || []).map(async (cat) => {
          const { count } = await supabase
            .from('tasks')
            .select('id', { count: 'exact', head: true })
            .eq('category_id', cat.id);

          return {
            ...cat,
            task_count: count || 0
          };
        })
      );

      return withCounts as Category[];
    },
  });

  const { user } = useAuth();
  const createMutation = useMutation({
    mutationFn: async () => {
      const parsedCooldown = Number(formData.claim_cooldown_minutes);
      if (!Number.isFinite(parsedCooldown) || parsedCooldown < 0) {
        throw new Error('Category cooldown must be a valid number >= 0');
      }

      const { data, error } = await supabase
        .from('categories')
        .insert([
          {
            name: formData.name,
            description: formData.description || null,
            claim_cooldown_minutes: parsedCooldown,
          }
        ])
        .select();

      if (error) throw error;

      // Log activity for category creation
      const createdCategory = data && data[0];
      if (createdCategory) {
        await supabase.from('activity_logs').insert({
          user_id: user?.id,
          action: 'category_created',
          entity_type: 'category',
          entity_id: createdCategory.id,
          details: {
            category_name: createdCategory.name,
            category_description: createdCategory.description,
            created_by: user?.email || user?.id,
            created_at: createdCategory.created_at,
          },
        });
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      toast({
        title: 'Category created',
        description: 'New category has been created successfully.',
      });
      setFormData({ name: '', description: '', claim_cooldown_minutes: String(defaultCooldownMinutes) });
      setIsOpen(false);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create category',
        variant: 'destructive'
      });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const parsedCooldown = Number(formData.claim_cooldown_minutes);
      if (!Number.isFinite(parsedCooldown) || parsedCooldown < 0) {
        throw new Error('Category cooldown must be a valid number >= 0');
      }

      const { error } = await supabase
        .from('categories')
        .update({
          name: formData.name,
          description: formData.description || null,
          claim_cooldown_minutes: parsedCooldown,
        })
        .eq('id', editingId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      toast({
        title: 'Category updated',
        description: 'Category has been updated successfully.',
      });
      setFormData({ name: '', description: '', claim_cooldown_minutes: String(defaultCooldownMinutes) });
      setEditingId(null);
      setIsOpen(false);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update category',
        variant: 'destructive'
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
      toast({
        title: 'Category deleted',
        description: 'Category has been removed.',
      });
      setDeleteId(null);
    },
    onError: (error) => {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete category',
        variant: 'destructive'
      });
    }
  });

  const handleCreate = () => {
    setEditingId(null);
    setFormData({ name: '', description: '', claim_cooldown_minutes: String(defaultCooldownMinutes) });
    setIsOpen(true);
  };

  const handleEdit = (category: Category) => {
    setEditingId(category.id);
    setFormData({
      name: category.name,
      description: category.description || '',
      claim_cooldown_minutes: String(category.claim_cooldown_minutes ?? defaultCooldownMinutes),
    });
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({
        title: 'Error',
        description: 'Category name is required',
        variant: 'destructive'
      });
      return;
    }

    if (editingId) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const handleCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({
        title: 'Copied',
        description: 'Category ID copied to clipboard.',
      });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Unable to copy category ID.',
        variant: 'destructive',
      });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header with Create Button */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-heading text-3xl font-bold text-foreground">
              Categories
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage task categories and assign them to clients
            </p>
          </div>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleCreate} className="stoic-button-primary">
                <Plus className="h-4 w-4 mr-2" />
                New Category
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="text-foreground">
                  {editingId ? 'Edit Category' : 'Create Category'}
                </DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {editingId ? 'Update category details' : 'Add a new task category'}
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-foreground">Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g., Web Development"
                    className="bg-input border-border"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description" className="text-foreground">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe this category..."
                    className="bg-input border-border min-h-20"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="claim_cooldown_minutes" className="text-foreground">Claim Cooldown (minutes)</Label>
                  <Input
                    id="claim_cooldown_minutes"
                    type="number"
                    min="0"
                    step="1"
                    value={formData.claim_cooldown_minutes}
                    onChange={(e) => setFormData(prev => ({ ...prev, claim_cooldown_minutes: e.target.value }))}
                    placeholder="10"
                    className="bg-input border-border"
                  />
                  <p className="text-xs text-muted-foreground">
                    After a worker claims a task in this category, they must wait this long before claiming another task from the same category.
                  </p>
                </div>

                <div className="flex gap-2 justify-end pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsOpen(false)}
                    className="border-border text-foreground hover:bg-input"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="stoic-button-primary"
                  >
                    {editingId ? 'Update' : 'Create'} Category
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Categories Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : categories && categories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((category) => (
              <Card
                key={category.id}
                className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => navigate(`/admin/categories/${category.id}`)}
              >
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2">
                    <FolderPlus className="h-5 w-5 text-primary" />
                    {category.name}
                  </CardTitle>
                  {category.description && (
                    <CardDescription className="text-muted-foreground">
                      {category.description}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div>
                        {category.task_count || 0} {(category.task_count || 0) === 1 ? 'task' : 'tasks'}
                      </div>
                      <div>
                        Cooldown: {category.claim_cooldown_minutes ?? defaultCooldownMinutes} min
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(category);
                        }}
                        className="border-border text-foreground hover:bg-input"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteId(category.id);
                        }}
                        className="border-border text-foreground hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{category.id}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyId(category.id);
                      }}
                      className="h-6 w-6"
                      aria-label="Copy category id"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="stoic-card p-12 text-center">
            <FolderPlus className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-heading text-xl font-semibold text-foreground mb-2">
              No categories yet
            </h3>
            <p className="text-muted-foreground mb-6">
              Create your first category to organize tasks
            </p>
            <Button onClick={handleCreate} className="stoic-button-primary">
              <Plus className="h-4 w-4 mr-2" />
              Create Category
            </Button>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-foreground">Delete Category</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                Are you sure? This cannot be undone. Tasks in this category will not be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex gap-2 justify-end">
              <AlertDialogCancel className="border-border text-foreground hover:bg-input">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                disabled={deleteMutation.isPending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default AdminCategories;
