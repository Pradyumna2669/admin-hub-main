import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TaskCard } from '@/components/tasks/TaskCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  AlertCircle,
  Search,
  FolderOpen,
  Mail,
  CheckCircle2,
  Clock,
  Sparkles,
  XCircle,
  Send,
} from 'lucide-react';

const deriveTaskStatus = (task: any) => {
  const assignments = task.task_assignments || [];

  if (task.status === 'completed' || assignments.some((a: any) => a.status === 'completed')) {
    return 'completed';
  }

  if (assignments.some((a: any) => a.status === 'submitted')) {
    return 'submitted';
  }

  if (task.status === 'in_progress' || assignments.some((a: any) => a.status === 'in_progress')) {
    return 'in_progress';
  }

  if (task.status === 'cancelled' || assignments.every((a: any) => a.status === 'cancelled')) {
    return 'cancelled';
  }

  return 'pending';
};

const ClientCategoryView: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  
  const { user } = useAuth();

  // Get categories assigned to this client
  const { data: assignedCategories } = useQuery({
    queryKey: ['client-categories', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('category_assignments')
        .select('category_id, categories(id, name)')
        .eq('client_user_id', user?.id);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Get tasks for selected category
  const { data: categoryTasks, isLoading: tasksLoading } = useQuery({
    queryKey: ['client-category-tasks', selectedCategoryId, user?.id],
    queryFn: async () => {
      if (!selectedCategoryId) return [];

      const { data: tasks, error } = await supabase
        .from('tasks')
        .select('*, task_items(*), task_assignments(*)')
        .eq('category_id', selectedCategoryId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (tasks || []).map((task) => ({
        ...task,
        status: deriveTaskStatus(task),
      }));
    },
    enabled: !!selectedCategoryId && !!user?.id,
  });

  const filteredTasks = categoryTasks?.filter((task) => {
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.content?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const getCategoryStats = () => {
    if (!categoryTasks) {
      return { total: 0, completed: 0, inProgress: 0, submitted: 0, pending: 0, cancelled: 0 };
    }
    
    const total = categoryTasks.length;
    const completed = categoryTasks.filter((t) => t.status === 'completed').length;
    const inProgress = categoryTasks.filter((t) => t.status === 'in_progress').length;
    const submitted = categoryTasks.filter((t) => t.status === 'submitted').length;
    const pending = categoryTasks.filter((t) => t.status === 'pending').length;
    const cancelled = categoryTasks.filter((t) => t.status === 'cancelled').length;
    
    return { total, completed, inProgress, submitted, pending, cancelled };
  };

  const stats = getCategoryStats();
  const categoryList = assignedCategories?.map((ca: any) => ca.categories).filter(Boolean) || [];
  const hasNoCategoriesAssigned = categoryList.length === 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <section className="dashboard-hero">
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Category insights
              </div>
              <div>
                <h1 className="font-heading text-3xl font-bold text-foreground sm:text-4xl">
                  Category Tasks
                </h1>
                <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                  Open any category to see the real task status across that category, including pending, in progress, submitted, completed, and cancelled work.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* No Categories Assigned Message */}
        {hasNoCategoriesAssigned ? (
          <Card className="bg-card border-border p-8 text-center">
            <AlertCircle className="h-16 w-16 text-orange-600 mx-auto mb-4" />
            <h3 className="font-heading text-xl font-semibold text-foreground mb-2">
              No Categories Assigned
            </h3>
            <p className="text-muted-foreground mb-4">
              You don't have any categories assigned yet. Please contact your administrator to get started.
            </p>
            <div className="flex justify-center gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  // This would typically open an email client or contact form
                  window.location.href = 'mailto:admin@example.com?subject=Request%20Category%20Assignment';
                }}
              >
                <Mail className="mr-2 h-4 w-4" />
                Contact Admin
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {/* Category Selection */}
            <div className="glass-panel flex gap-4 flex-wrap p-4">
              <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
                <SelectTrigger className="w-[250px] bg-input border-border">
                  <SelectValue placeholder="Select a category..." />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  {categoryList.map((cat: any) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Category Stats */}
            {selectedCategoryId && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                <Card className="stoic-card border-border/70 p-4">
                  <div className="flex items-center gap-3">
                    <FolderOpen className="h-5 w-5 text-blue-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">Total Tasks</p>
                      <p className="text-2xl font-bold text-foreground">{stats.total}</p>
                    </div>
                  </div>
                </Card>
                <Card className="stoic-card border-border/70 p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">Completed</p>
                      <p className="text-2xl font-bold text-foreground">{stats.completed}</p>
                    </div>
                  </div>
                </Card>
                <Card className="stoic-card border-border/70 p-4">
                  <div className="flex items-center gap-3">
                    <Clock className="h-5 w-5 text-amber-600" />
                    <div>
                      <p className="text-sm text-muted-foreground">In Progress</p>
                      <p className="text-2xl font-bold text-foreground">{stats.inProgress}</p>
                    </div>
                  </div>
                </Card>
                <Card className="stoic-card border-border/70 p-4">
                  <div className="flex items-center gap-3">
                    <Send className="h-5 w-5 text-cyan-500" />
                    <div>
                      <p className="text-sm text-muted-foreground">Submitted</p>
                      <p className="text-2xl font-bold text-foreground">{stats.submitted}</p>
                    </div>
                  </div>
                </Card>
                <Card className="stoic-card border-border/70 p-4">
                  <div className="flex items-center gap-3">
                    <XCircle className="h-5 w-5 text-rose-500" />
                    <div>
                      <p className="text-sm text-muted-foreground">Cancelled</p>
                      <p className="text-2xl font-bold text-foreground">{stats.cancelled}</p>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {selectedCategoryId && (
              <div className="glass-panel flex gap-4 flex-wrap p-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search tasks..."
                    className="bg-input border-border pl-10"
                  />
                </div>

                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[180px] bg-input border-border">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Tasks */}
            {selectedCategoryId ? (
              tasksLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filteredTasks && filteredTasks.length > 0 ? (
                <div className="grid gap-4">
                  {filteredTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                    />
                  ))}
                </div>
              ) : (
                <Card className="bg-card border-border p-12 text-center">
                  <FolderOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-heading text-xl font-semibold text-foreground mb-2">
                    No tasks found
                  </h3>
                  <p className="text-muted-foreground">
                    {searchQuery || statusFilter !== 'all'
                      ? 'Try adjusting your filters'
                      : 'No tasks in this category yet'}
                  </p>
                </Card>
              )
            ) : (
              <Card className="bg-card border-border p-12 text-center">
                <FolderOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-heading text-lg font-semibold text-foreground mb-2">
                  Select a category to view tasks
                </h3>
                <p className="text-muted-foreground">
                  Choose one of your assigned categories above to see available tasks
                </p>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default ClientCategoryView;
