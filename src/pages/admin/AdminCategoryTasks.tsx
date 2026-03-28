import React from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TaskCard } from '@/components/tasks/TaskCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ArrowLeft, ClipboardList, FolderOpen } from 'lucide-react';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

const TASKS_PAGE_SIZE = 20;

const statusBadgeClass: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  in_progress: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const AdminCategoryTasks: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();

  const { data: category, isLoading: categoryLoading } = useQuery({
    queryKey: ['admin-category', categoryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, description')
        .eq('id', categoryId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!categoryId,
  });

  const {
    data: taskPages,
    isLoading: tasksLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['admin-category-tasks', categoryId],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * TASKS_PAGE_SIZE;
      const to = from + TASKS_PAGE_SIZE - 1;

      const { data, error } = await supabase
        .from('tasks')
        .select('*, task_items(*), task_assignments(*)')
        .eq('category_id', categoryId)
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      return data || [];
    },
    enabled: !!categoryId,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < TASKS_PAGE_SIZE ? undefined : allPages.length,
  });

  const tasks = taskPages?.pages.flat() || [];
  const sentinelRef = useInfiniteScroll({
    enabled: !!categoryId,
    hasMore: !!hasNextPage,
    isLoading: tasksLoading || isFetchingNextPage,
    onLoadMore: () => {
      if (hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
  });

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <section className="dashboard-hero">
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl space-y-3">
              <Button asChild variant="outline" className="w-fit">
                <Link to="/admin/categories">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Categories
                </Link>
              </Button>

              <div>
                <h1 className="text-3xl font-bold text-foreground sm:text-4xl">
                  {categoryLoading ? 'Loading category...' : category?.name || 'Category'}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                  {category?.description || 'View every task assigned to this category, with the latest tasks shown first.'}
                </p>
              </div>
            </div>

            <Card className="stoic-card border-border/70 p-4">
              <div className="flex items-center gap-3">
                <FolderOpen className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Loaded Tasks</p>
                  <p className="text-2xl font-bold text-foreground">{tasks.length}</p>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {tasksLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : tasks.length > 0 ? (
          <div className="grid gap-4">
            {tasks.map((task: any) => (
              <div key={task.id} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`border ${statusBadgeClass[task.status] || 'bg-muted text-muted-foreground'}`}>
                    {task.status.replace('_', ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    Created {new Date(task.created_at).toLocaleString()}
                  </span>
                </div>
                <TaskCard task={task} showActions={false} />
              </div>
            ))}
          </div>
        ) : (
          <div className="stoic-card p-12 text-center">
            <ClipboardList className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
            <h3 className="mb-2 text-xl font-semibold text-foreground">No tasks in this category</h3>
            <p className="text-muted-foreground">This category does not have any assigned tasks yet.</p>
          </div>
        )}

        {tasks.length > 0 && (
          <div ref={sentinelRef} className="py-4 text-center text-sm text-muted-foreground">
            {isFetchingNextPage
              ? 'Loading more tasks...'
              : hasNextPage
                ? 'Scroll to load more'
                : 'You have reached the oldest tasks in this category'}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminCategoryTasks;
