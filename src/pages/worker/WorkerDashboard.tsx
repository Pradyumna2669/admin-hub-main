import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FaReddit } from 'react-icons/fa';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { StatCard } from '@/components/ui/stat-card';
import { TaskCard } from '@/components/tasks/TaskCard';
import { Button } from '@/components/ui/button';
import { DiscordVerificationCard } from '@/components/DiscordVerificationCard';
import { TaskForecastChart } from '@/components/TaskForecastChart';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  IndianRupee,
  Link2,
  PlayCircle,
  Trophy,
  Activity as ActivityIcon
} from 'lucide-react';
import { motion, animate, useInView } from 'framer-motion';

// Luxury Animated Counter
const AnimatedCounter = ({ from = 0, to, prefix = '' }: { from?: number; to: number; prefix?: string }) => {
  const nodeRef = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(nodeRef, { once: true, margin: "-50px" });

  React.useEffect(() => {
    if (inView && nodeRef.current) {
      const controls = animate(from, to, {
        duration: 2.5,
        ease: "easeOut",
        onUpdate: (latest) => {
          if (nodeRef.current) {
            nodeRef.current.textContent = `${prefix}${latest.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
          }
        }
      });
      return () => controls.stop();
    }
  }, [inView, from, to, prefix]);

  return <span ref={nodeRef}>{prefix}{from}</span>;
};

// SVG Animated Power Ring
const PowerRing = ({ value, max, label, icon: Icon, colorClass, gradientId }: any) => {
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const safeValue = Math.min(value, max);
  const strokeDashoffset = circumference - (safeValue / max) * circumference;

  return (
    <div className="relative flex flex-col items-center justify-center p-4 bg-white/60 dark:bg-[#131722]/80 backdrop-blur-xl border border-slate-200 dark:border-white/10 rounded-2xl glow-card overflow-hidden group">
      <svg width="120" height="120" className="rotate-[-90deg]">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(168, 85, 247, 1)" />
            <stop offset="100%" stopColor="rgba(216, 180, 254, 1)" />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={radius} className="stroke-slate-200 dark:stroke-white/10 fill-none" strokeWidth="8" />
        <motion.circle 
          cx="60" cy="60" r={radius} 
          className="fill-none drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]" 
          stroke={`url(#${gradientId})`} 
          strokeWidth="8"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 2, ease: "easeOut", delay: 0.2 }}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute top-[48px] flex flex-col items-center">
        <Icon className={`w-5 h-5 mb-1 ${colorClass}`} />
        <span className="font-bold text-lg leading-none"><AnimatedCounter to={value} /></span>
      </div>
      <div className="mt-3 text-xs font-bold font-label uppercase text-slate-500 tracking-wider group-hover:text-purple-500 transition-colors">
        {label}
      </div>
    </div>
  );
};

const WorkerDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: stats } = useQuery({
    queryKey: ['worker-stats', user?.id],
    queryFn: async () => {
      const { data: assignments, error } = await supabase
        .from('task_assignments')
        .select('*')
        .eq('user_id', user?.id);

      if (error) throw error;

      const total = assignments?.length || 0;
      const completed =
        assignments?.filter((task) => task.status === 'completed').length || 0;
      const pending =
        assignments?.filter((task) => task.status === 'pending').length || 0;
      const inProgress =
        assignments?.filter((task) => task.status === 'in_progress').length || 0;
      const earnings =
        assignments
          ?.filter((task) => task.status === 'completed')
          .reduce(
            (sum, task) =>
              sum +
              parseFloat(
                typeof task.amount === 'string'
                  ? task.amount
                  : String(task.amount || 0),
              ),
            0,
          ) || 0;

      return { total, completed, pending, inProgress, earnings };
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const { data: dashboardData } = useQuery({
    queryKey: ['worker-dashboard', user?.id],
    queryFn: async () => {
      const { data: assignments, error: assignmentsError } = await supabase
        .from('task_assignments')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (assignmentsError) throw assignmentsError;

      const taskIds = (assignments || []).map((assignment: any) => assignment.task_id);
      if (taskIds.length === 0) {
        return {
          recentTasks: [],
        };
      }

      const { data, error } = await supabase
        .from('tasks')
        .select('*, task_items(*)')
        .in('id', taskIds)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;

      return {
        recentTasks: (data || []).map((task: any) => ({
          ...task,
          task_assignments: (assignments || []).filter(
            (assignment: any) => assignment.task_id === task.id,
          ),
        })),
      };
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const recentTasks = dashboardData?.recentTasks || [];

  const { data: redditAccountCount = 0 } = useQuery({
    queryKey: ['worker-reddit-account-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('reddit_accounts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user?.id);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });

  const nextRedditSlot = Math.min(redditAccountCount + 1, 3);

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <section className="dashboard-hero">
          <div className="relative z-10 max-w-2xl">
            <h1 className="font-heading text-3xl font-bold text-foreground sm:text-4xl">
              Tasker Dashboard
            </h1>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Track your claimed tasks, linked accounts, Discord verification, and upcoming task
              demand from one workspace.
            </p>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {/* Revenue Luxury Card */}
          <div className="lg:col-span-2 relative p-6 bg-white/60 dark:bg-gradient-to-br dark:from-purple-900/40 dark:to-[#090b14] border border-purple-500/20 dark:border-purple-500/30 rounded-2xl glow-card overflow-hidden flex flex-col justify-center">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 dark:bg-purple-500/20 blur-[50px] rounded-full"></div>
            <div className="flex items-center gap-3 mb-2 text-purple-600 dark:text-purple-400 font-label uppercase text-xs font-bold tracking-widest">
              <IndianRupee className="w-4 h-4" /> Total Ecosystem Revenue
            </div>
            <div className="text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-white drop-shadow-[0_0_15px_rgba(168,85,247,0.2)] dark:drop-shadow-[0_0_15px_rgba(168,85,247,0.4)]">
              <AnimatedCounter from={0} to={stats?.earnings || 0} prefix="₹" />
            </div>
          </div>

          <PowerRing value={stats?.completed || 0} max={100} label="Tasks Verified" icon={CheckCircle2} colorClass="text-emerald-400" gradientId="ring-grad-1" />
          <PowerRing value={stats?.inProgress || 0} max={20} label="Active Ops" icon={PlayCircle} colorClass="text-amber-400" gradientId="ring-grad-2" />
          <PowerRing value={stats?.total || 0} max={500} label="Lifetime Total" icon={ClipboardList} colorClass="text-purple-400" gradientId="ring-grad-3" />
        </div>

        {redditAccountCount < 3 ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <div className="rounded-[28px] border border-border bg-card/95 p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="inline-flex items-center gap-2 text-sm font-medium text-[#ff6b35]">
                    <FaReddit className="h-4 w-4" />
                    Reddit Account Progress
                  </div>
                  <div>
                    <h2 className="text-2xl font-semibold text-foreground">
                      {redditAccountCount === 0
                        ? 'Add your first Reddit account'
                        : 'Link your Reddit accounts to your account'}
                    </h2>
                    <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                      {redditAccountCount === 0
                        ? 'You have not linked any Reddit accounts yet. Add your first account to start verification and unlock worker tasks.'
                        : `You have linked ${redditAccountCount} of 3 Reddit accounts. Connect your Grade ${nextRedditSlot}/3 Reddit account to unlock more task access and account flexibility.`}
                    </p>
                  </div>
                </div>

                <div className="rounded-full border border-border bg-muted/30 px-3 py-1 text-sm font-medium text-muted-foreground">
                  {redditAccountCount}/3 linked
                </div>
              </div>

              <div className="mt-5 h-2 overflow-hidden rounded-full bg-muted/40">
                <div
                  className="h-full rounded-full bg-[#ff6b35] transition-all"
                  style={{ width: `${(redditAccountCount / 3) * 100}%` }}
                />
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  type="button"
                  onClick={() => navigate('/profile')}
                  className="bg-[#1b1b1d] text-white hover:bg-[#2a2a2d]"
                >
                  <FaReddit className="mr-2 h-4 w-4 text-[#ff6b35]" />
                  Add Reddit Account
                </Button>
                <Button type="button" variant="outline" onClick={() => navigate('/profile')}>
                  <Link2 className="mr-2 h-4 w-4" />
                  Manage Linked Accounts
                </Button>
              </div>
            </div>

            <DiscordVerificationCard />
          </div>
        ) : (
          <DiscordVerificationCard />
        )}

        <TaskForecastChart />

        <div>
          <h2 className="mb-4 font-heading text-xl font-semibold text-foreground">
            Recent Tasks
          </h2>
          <div className="grid gap-4">
            {recentTasks && recentTasks.length > 0 ? (
              recentTasks.map((task) => (
                <TaskCard key={task.id} task={task} showActions={false} />
              ))
            ) : (
              <div className="stoic-card p-8 text-center">
                <ClipboardList className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                <p className="text-muted-foreground">No tasks claimed yet. Check back soon.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default WorkerDashboard;
