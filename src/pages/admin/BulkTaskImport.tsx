import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Papa from 'papaparse';
import { ArrowLeft } from 'lucide-react';
import { ALL_TASK_TYPES, DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE, parseTaskType, requiresSubredditFlair, TaskType } from '@/lib/taskTypes';
import { sendNewTaskPushes } from '@/lib/taskPush';
import { sendNewTaskDiscord } from '@/lib/taskDiscord';
import { createTaskIdentifiers } from '@/lib/taskIdentifiers';

interface ParsedTask {
  title: string;
  instruction?: string;
  content: string;
  task_type: string;
  subreddit_flair?: string;
  target_link?: string;
  category_id: string;
  amount?: string;
  task_completion_time: string;
  minimum_karma?: string;
  cqs_levels?: string;
}

const requiredColumns = [
  'title',
  'content',
  'task_type',
  'category_id',
  'task_completion_time',
];

const CHUNK_SIZE = 200; // 200 rows per request

const BulkTaskImport: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [tasks, setTasks] = useState<ParsedTask[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f || null);
    setTasks([]);
    setErrors([]);
    setProgress(0);

    if (!f) return;

    if (f.size > 5 * 1024 * 1024) {
      setErrors(['File too large (max 5MB)']);
      return;
    }

    Papa.parse(f, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data as ParsedTask[];

        if (!rows.length) {
          setErrors(['CSV is empty']);
          return;
        }

        const columns = Object.keys(rows[0]);
        const missing = requiredColumns.filter(
          (col) => !columns.includes(col)
        );

        if (missing.length) {
          setErrors([`Missing columns: ${missing.join(', ')}`]);
          return;
        }

        setTasks(rows);
      },
      error: (err) => setErrors([err.message]),
    });
  };

  const transformTask = (task: ParsedTask) => {
    if (!task.category_id) throw new Error('Category is required');
    if (!task.title?.trim()) throw new Error('Title is required');
    if (!task.task_completion_time || parseInt(task.task_completion_time) <= 0)
      throw new Error('Completion time must be > 0');

    const taskType = parseTaskType(task.task_type);
    if (!taskType) {
      throw new Error(
        `Invalid task_type "${task.task_type}". Use one of: ${ALL_TASK_TYPES.join(', ')}`
      );
    }

    if (requiresSubredditFlair(taskType) && !task.subreddit_flair?.trim()) {
      throw new Error('subreddit_flair is required for this task_type');
    }

    const identifiers = createTaskIdentifiers();

    return {
      id: identifiers.id,
      title: task.title,
      instruction: task.instruction?.trim() || null,
      content: task.content,
      task_type: taskType,
      subreddit_flair: task.subreddit_flair || null,
      target_link: task.target_link || null,
      category_id: task.category_id,
      amount: null as any,
      task_completion_time: parseInt(task.task_completion_time) || 60,
      minimum_karma: task.minimum_karma
        ? parseInt(task.minimum_karma)
        : null,
      cqs_levels: task.cqs_levels
        ? task.cqs_levels.split(',').map((v) => v.trim())
        : [],
      created_by: user?.id || null,
      public_order_code: identifiers.publicOrderCode,
    };
  };

  const handleImport = async () => {
    setImporting(true);
    setErrors([]);
    setProgress(0);

    let errs: string[] = [];

    try {
      if (!user?.id) {
        throw new Error('Not logged in');
      }

      // Load latest rates (fallback to defaults if table doesn't exist yet)
      let rates: Record<TaskType, number> = { ...DEFAULT_TASK_TYPE_RATES_INR_BY_LEAGUE.bronze };
      const { data: ratesRows, error: ratesErr } = await supabase
        .from('task_type_rates')
        .select('task_type, amount')
        .eq('league', 'bronze');
      if (!ratesErr) {
        for (const r of ratesRows || []) {
          const t = parseTaskType((r as any).task_type);
          if (!t) continue;
          const amount = Number((r as any).amount);
          if (Number.isFinite(amount)) rates[t] = amount;
        }
      }

      const transformedTasks = tasks.map((task, index) => {
        try {
          const row = transformTask(task) as any;
          row.amount = rates[row.task_type] ?? 0;
          return row;
        } catch (e: any) {
          errs.push(`Row ${index + 2}: ${e.message}`);
          return null;
        }
      }).filter(Boolean);

      const total = transformedTasks.length;

      for (let i = 0; i < total; i += CHUNK_SIZE) {
        const chunk = transformedTasks.slice(i, i + CHUNK_SIZE);

        const { data: createdTasks, error } = await supabase
          .from('tasks')
          .insert(chunk)
          .select('id');

        if (error) {
          errs.push(`Chunk starting at row ${i + 2}: ${error.message}`);
        } else {
          const createdIds = (createdTasks || []).map((task) => task.id);
          await sendNewTaskPushes(createdIds);
          await sendNewTaskDiscord(createdIds);
        }

        const completed = Math.min(i + CHUNK_SIZE, total);
        setProgress(Math.round((completed / total) * 100));
      }
    } catch (e: any) {
      errs.push(e.message);
    }

    setErrors(errs);
    setImporting(false);

    if (!errs.length) {
      setFile(null);
      setTasks([]);
      queryClient.invalidateQueries({ queryKey: ['admin-tasks'] });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-3 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            Bulk Task Import
          </h1>
        </div>

        <p className="text-muted-foreground">
          Upload a CSV file to create multiple tasks at once.
          <br />
          Required columns:
          <br />
          <b>
            title, content, task_type, category_id, task_completion_time
          </b>
          <br />
          Optional columns: <b>instruction, subreddit_flair, target_link, minimum_karma, cqs_levels</b>
          <br />
          task_type values: <b>{ALL_TASK_TYPES.join(', ')}</b>
          <br />
          Note: <b>subreddit_flair</b> is required for non_linked_crosspost, linked_post_crosspost (Linked Crosspost), non_linked_post, and linked_post.
          <br />
          Example row:
          <br />
          <b>
            title,content,task_type,category_id,task_completion_time,instruction,subreddit_flair,target_link,minimum_karma,cqs_levels
          </b>
          <br />
          <b>
            "Promo Task","Write a helpful comment","normal_comment","cat_123","60","Be friendly","", "https://example.com","0","Low,Moderate"
          </b>
        </p>

        <div>
          <Label>Upload CSV</Label>
          <Input type="file" accept=".csv" onChange={handleFileChange} />
        </div>

        {tasks.length > 0 && (
          <div>
            <h2 className="font-semibold mb-2">
              Preview ({tasks.length} tasks)
            </h2>

            <div className="overflow-x-auto border rounded">
              <table className="min-w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    {Object.keys(tasks[0]).map((k) => (
                      <th key={k} className="px-2 py-1 border">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((row, i) => (
                    <tr key={i} className="border-t">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-2 py-1 border">
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button
              className="mt-4 stoic-button-primary"
              onClick={handleImport}
              disabled={importing}
            >
              {importing ? 'Importing...' : 'Create All Tasks'}
            </Button>

            {importing && (
              <div className="mt-4">
                <div className="w-full bg-gray-200 rounded h-3">
                  <div
                    className="bg-blue-600 h-3 rounded"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm mt-1">
                  {progress}% completed
                </p>
              </div>
            )}
          </div>
        )}

        {errors.length > 0 && (
          <div className="bg-red-100 text-red-700 p-3 rounded">
            <b>Errors:</b>
            <ul className="list-disc ml-6">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default BulkTaskImport;
