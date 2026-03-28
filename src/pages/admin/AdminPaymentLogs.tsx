import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getUserUploadsObjectPath } from '@/lib/storagePaths';
import { ExternalLink, Search } from 'lucide-react';

type PaymentLogRow = {
  id: string;
  amount: number;
  paid_at: string;
  transaction_id: string;
  payment_proof_url: string | null;
  notes: string | null;
  worker_name: string | null;
  worker_email: string | null;
  payer_name: string | null;
  tasks: {
    title: string | null;
  } | null;
};

const AdminPaymentLogs: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<PaymentLogRow | null>(null);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});

  const { data: logs, isLoading } = useQuery({
    queryKey: ['payment-logs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_logs')
        .select(`
          id,
          amount,
          paid_at,
          transaction_id,
          payment_proof_url,
          notes,
          worker_name,
          worker_email,
          payer_name,
          tasks(title)
        `)
        .order('paid_at', { ascending: false });

      if (error) throw error;
      return (data || []) as PaymentLogRow[];
    },
  });

  useEffect(() => {
    const generateSignedUrls = async () => {
      if (!logs?.length) {
        setProofUrls({});
        return;
      }

      const entries = await Promise.all(
        logs.map(async (log) => {
          const path = getUserUploadsObjectPath(log.payment_proof_url);
          if (!path) return [log.id, log.payment_proof_url || ''] as const;

          const { data } = await supabase.storage
            .from('user_uploads')
            .createSignedUrl(path, 60 * 60);

          return [log.id, data?.signedUrl || log.payment_proof_url || ''] as const;
        })
      );

      setProofUrls(Object.fromEntries(entries));
    };

    generateSignedUrls();
  }, [logs]);

  const filteredLogs =
    logs?.filter((log) => {
      const q = search.toLowerCase();
      return (
        (log.worker_name || '').toLowerCase().includes(q) ||
        (log.worker_email || '').toLowerCase().includes(q) ||
        (log.transaction_id || '').toLowerCase().includes(q) ||
        (log.payer_name || '').toLowerCase().includes(q)
      );
    }) || [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Payment Logs</h1>
          <p className="text-sm text-muted-foreground">
            Search by worker, payer, or transaction ID to audit proof-backed payouts.
          </p>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search payments..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {isLoading ? (
          <p>Loading...</p>
        ) : filteredLogs.length > 0 ? (
          <div className="space-y-3">
            {filteredLogs.map((log) => (
              <Card
                key={log.id}
                className="cursor-pointer p-4 transition-colors hover:bg-muted/60"
                onClick={() => setSelected(log)}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-1">
                    <p className="font-semibold">
                      {log.worker_name || log.worker_email || 'Unknown tasker'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {log.tasks?.title || 'Unknown task'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">Txn: {log.transaction_id}</Badge>
                      {log.payer_name && <Badge variant="outline">By: {log.payer_name}</Badge>}
                    </div>
                  </div>

                  <div className="text-left md:text-right">
                    <p className="font-bold">Rs {log.amount}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.paid_at ? new Date(log.paid_at).toLocaleString() : '-'}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <p>No payment logs found.</p>
        )}

        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Payment Details</DialogTitle>
            </DialogHeader>

            {selected && (
              <div className="space-y-4 text-sm">
                {(() => {
                  const proofUrl = proofUrls[selected.id] || selected.payment_proof_url || '';

                  return (
                    <>
                <div className="grid gap-2 rounded-lg border p-4 sm:grid-cols-2">
                  <p><strong>Tasker:</strong> {selected.worker_name || '-'}</p>
                  <p><strong>Email:</strong> {selected.worker_email || '-'}</p>
                  <p><strong>Task:</strong> {selected.tasks?.title || '-'}</p>
                  <p><strong>Amount:</strong> Rs {selected.amount}</p>
                  <p><strong>Transaction ID:</strong> {selected.transaction_id}</p>
                  <p><strong>Paid By:</strong> {selected.payer_name || '-'}</p>
                  <p className="sm:col-span-2">
                    <strong>Paid At:</strong>{' '}
                    {selected.paid_at ? new Date(selected.paid_at).toLocaleString() : '-'}
                  </p>
                </div>

                {selected.notes && (
                  <div className="rounded-lg border p-4">
                    <p className="font-medium">Notes</p>
                    <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                      {selected.notes}
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  <p className="font-medium">Payment Proof</p>
                  {proofUrl ? (
                    <>
                      <img
                        src={proofUrl}
                        alt="Payment proof"
                        className="max-h-[420px] w-full rounded-lg border object-contain"
                      />
                      <Button asChild variant="outline">
                        <a
                          href={proofUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Open proof in new tab
                        </a>
                      </Button>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
                      No payment proof available for this payout.
                    </div>
                  )}
                </div>
                    </>
                  );
                })()}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
};

export default AdminPaymentLogs;
