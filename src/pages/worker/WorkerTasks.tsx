import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { TaskCard } from '@/components/tasks/TaskCard';
import { WorkerSubmissionDialog } from '@/components/tasks/WorkerSubmissionDialog';
import { StatCard } from '@/components/ui/stat-card';
import { Input } from '@/components/ui/input';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { ClipboardList, Search, CheckCircle2, PlayCircle, Clock, IndianRupee } from 'lucide-react';
import WorkerTasksPage from './WorkerTasksPage';

export default WorkerTasksPage;
