import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { Download, IndianRupee, Search, Wallet } from 'lucide-react';

type Scope = 'week' | 'month';

type AssignmentExpenseRow = {
  id: string;
  user_id: string;
  amount: number | null;
  status: string;
  is_removal: boolean | null;
  submitted_at: string | null;
  created_at: string;
  tasks?: {
    id: string;
    title: string;
  } | null;
  profiles: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type PaymentExpenseRow = {
  id: string;
  worker_id: string;
  worker_name: string | null;
  worker_email: string | null;
  amount: number;
  paid_at: string;
  transaction_id: string;
};

const startOfCurrentWeek = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
};

const startOfCurrentMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
};

const downloadCsv = (fileName: string, rows: string[][]) => {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const AdminExpenses: React.FC = () => {
  const [scope, setScope] = useState<Scope>('week');
  const [search, setSearch] = useState('');
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-expenses'],
    queryFn: async () => {
      const [assignmentsRes, paymentsRes] = await Promise.all([
        supabase
          .from('task_assignments')
          .select(`
            id,
            user_id,
            amount,
            status,
            is_removal,
            submitted_at,
            created_at,
            tasks(id, title),
            profiles:user_id (full_name, email)
          `)
          .or('status.eq.completed,is_removal.eq.true'),
        supabase
          .from('payment_logs')
          .select(`
            id,
            worker_id,
            worker_name,
            worker_email,
            amount,
            paid_at,
            transaction_id
          `)
          .order('paid_at', { ascending: false }),
      ]);

      if (assignmentsRes.error) throw assignmentsRes.error;
      if (paymentsRes.error) throw paymentsRes.error;

      return {
        assignments: (assignmentsRes.data || []) as AssignmentExpenseRow[],
        payments: (paymentsRes.data || []) as PaymentExpenseRow[],
      };
    },
  });

  const periodStart = scope === 'week' ? startOfCurrentWeek() : startOfCurrentMonth();
  const assignments = data?.assignments || [];
  const payments = data?.payments || [];

  const periodAssignments = assignments.filter((assignment) => {
    const date = new Date(assignment.submitted_at || assignment.created_at);
    return date >= periodStart;
  });

  const periodPayments = payments.filter((payment) => new Date(payment.paid_at) >= periodStart);

  const totalApprovedAllTime = assignments.reduce(
    (sum, assignment) => sum + Number(assignment.amount || 0),
    0
  );
  const totalPaidAllTime = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const totalOutstandingAllTime = totalApprovedAllTime - totalPaidAllTime;

  const periodApproved = periodAssignments.reduce(
    (sum, assignment) => sum + Number(assignment.amount || 0),
    0
  );
  const periodPaid = periodPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const periodOutstanding = periodApproved - periodPaid;

  const workerMap = new Map<
    string,
    {
      workerId: string;
      workerName: string;
      assignments: number;
      approved: number;
      paid: number;
      outstanding: number;
      lastTransactionId: string;
    }
  >();

  for (const assignment of periodAssignments) {
    const workerId = assignment.user_id;
    const current = workerMap.get(workerId) || {
      workerId,
      workerName:
        assignment.profiles?.full_name || assignment.profiles?.email || 'Unknown tasker',
      assignments: 0,
      approved: 0,
      paid: 0,
      outstanding: 0,
      lastTransactionId: '-',
    };

    current.assignments += 1;
    current.approved += Number(assignment.amount || 0);
    workerMap.set(workerId, current);
  }

  for (const payment of periodPayments) {
    const workerId = payment.worker_id;
    const current = workerMap.get(workerId) || {
      workerId,
      workerName: payment.worker_name || payment.worker_email || 'Unknown tasker',
      assignments: 0,
      approved: 0,
      paid: 0,
      outstanding: 0,
      lastTransactionId: '-',
    };

    current.paid += Number(payment.amount || 0);
    current.lastTransactionId = payment.transaction_id || current.lastTransactionId;
    workerMap.set(workerId, current);
  }

  const workerRows = Array.from(workerMap.values())
    .map((row) => ({
      ...row,
      outstanding: row.approved - row.paid,
    }))
    .filter((row) => row.workerName.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.outstanding - a.outstanding);

  const detailAssignments = periodAssignments.filter((assignment) => assignment.user_id === detailWorkerId);
  const detailPayments = periodPayments.filter((payment) => payment.worker_id === detailWorkerId);

  const handleExport = () => {
    const rows = [
      ['Scope', scope === 'week' ? 'Current Week' : 'Current Month'],
      ['Approved Total', periodApproved.toFixed(2)],
      ['Paid Total', periodPaid.toFixed(2)],
      ['Outstanding', periodOutstanding.toFixed(2)],
      [],
      ['Worker', 'Assignments', 'Approved', 'Paid', 'Outstanding', 'Last Transaction ID'],
      ...workerRows.map((row) => [
        row.workerName,
        String(row.assignments),
        row.approved.toFixed(2),
        row.paid.toFixed(2),
        row.outstanding.toFixed(2),
        row.lastTransactionId,
      ]),
    ];

    downloadCsv(`expenses-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold">Expenses</h1>
            <p className="text-sm text-muted-foreground">
              Track approved work, confirmed payouts, and remaining liability for the current week or month.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={scope === 'week' ? 'default' : 'outline'}
              onClick={() => setScope('week')}
            >
              Weekly
            </Button>
            <Button
              type="button"
              variant={scope === 'month' ? 'default' : 'outline'}
              onClick={() => setScope('month')}
            >
              Monthly
            </Button>
            <Button type="button" variant="outline" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Approved This {scope === 'week' ? 'Week' : 'Month'}</p>
            <p className="mt-2 flex items-center gap-1 text-2xl font-bold">
              <IndianRupee className="h-5 w-5" />
              {periodApproved.toFixed(2)}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Paid This {scope === 'week' ? 'Week' : 'Month'}</p>
            <p className="mt-2 flex items-center gap-1 text-2xl font-bold text-green-600">
              <Wallet className="h-5 w-5" />
              {periodPaid.toFixed(2)}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Outstanding This {scope === 'week' ? 'Week' : 'Month'}</p>
            <p className="mt-2 flex items-center gap-1 text-2xl font-bold text-amber-600">
              <IndianRupee className="h-5 w-5" />
              {periodOutstanding.toFixed(2)}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Outstanding All Time</p>
            <p className="mt-2 flex items-center gap-1 text-2xl font-bold text-red-600">
              <IndianRupee className="h-5 w-5" />
              {totalOutstandingAllTime.toFixed(2)}
            </p>
          </Card>
        </div>

        <Card className="p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <Input
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search worker..."
              />
            </div>

            <div className="rounded-lg border px-4 py-3 text-sm">
              <p className="text-muted-foreground">Approved All Time</p>
              <p className="mt-1 font-semibold">Rs {totalApprovedAllTime.toFixed(2)}</p>
            </div>

            <div className="rounded-lg border px-4 py-3 text-sm">
              <p className="text-muted-foreground">Paid All Time</p>
              <p className="mt-1 font-semibold">Rs {totalPaidAllTime.toFixed(2)}</p>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b px-5 py-4">
            <h2 className="text-lg font-semibold">
              {scope === 'week' ? 'Weekly' : 'Monthly'} Worker Breakdown
            </h2>
          </div>

          {isLoading ? (
            <div className="p-5">Loading expenses...</div>
          ) : workerRows.length > 0 ? (
            <div className="divide-y">
              {workerRows.map((row) => (
                <div
                  key={row.workerId}
                  className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div>
                    <p className="font-semibold">{row.workerName}</p>
                    <p className="text-sm text-muted-foreground">
                      {row.assignments} approved assignment{row.assignments === 1 ? '' : 's'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Approved: Rs {row.approved.toFixed(2)}</Badge>
                    <Badge variant="outline">Paid: Rs {row.paid.toFixed(2)}</Badge>
                    <Badge className="bg-amber-500/15 text-amber-700">
                      Owed: Rs {row.outstanding.toFixed(2)}
                    </Badge>
                    <Badge variant="outline">Last Txn: {row.lastTransactionId}</Badge>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDetailWorkerId(row.workerId)}
                    >
                      View Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-5 text-sm text-muted-foreground">
              No expense rows found for the selected period.
            </div>
          )}
        </Card>
      </div>

      <Dialog open={!!detailWorkerId} onOpenChange={(open) => !open && setDetailWorkerId(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tasker Payment Details</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="text-sm font-semibold">Approved Tasks</div>
              {detailAssignments.length > 0 ? (
                <div className="mt-3 space-y-2 text-sm">
                  {detailAssignments.map((assignment) => (
                    <div key={assignment.id} className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {assignment.tasks?.title || 'Untitled task'}
                      </span>
                      <span className="font-semibold">
                        Rs {Number(assignment.amount || 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">No approved tasks in this period.</div>
              )}
            </div>

            <div className="rounded-lg border p-4">
              <div className="text-sm font-semibold">Payments Logged</div>
              {detailPayments.length > 0 ? (
                <div className="mt-3 space-y-2 text-sm">
                  {detailPayments.map((payment) => (
                    <div key={payment.id} className="flex items-center justify-between">
                      <span className="text-muted-foreground">
                        {new Date(payment.paid_at).toLocaleString()} - {payment.transaction_id}
                      </span>
                      <span className="font-semibold">
                        Rs {Number(payment.amount || 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">No payments logged in this period.</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminExpenses;
