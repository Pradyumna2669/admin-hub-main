import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getUserUploadsObjectPath } from '@/lib/storagePaths';
import { ExternalLink, Wallet } from 'lucide-react';

type WorkerPaymentLog = {
  id: string;
  amount: number;
  paid_at: string;
  transaction_id: string;
  payment_proof_url: string | null;
  notes: string | null;
  payer_name: string | null;
  tasks: {
    title: string | null;
  } | null;
};

const WorkerPaymentHistory: React.FC = () => {
  const { user } = useAuth();
  const [selected, setSelected] = useState<WorkerPaymentLog | null>(null);
  const [proofUrls, setProofUrls] = useState<Record<string, string>>({});

  const { data: payments, isLoading } = useQuery({
    queryKey: ['worker-payment-history', user?.id],
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
          payer_name,
          tasks(title)
        `)
        .eq('worker_id', user?.id)
        .order('paid_at', { ascending: false });

      if (error) throw error;
      return (data || []) as WorkerPaymentLog[];
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    const generateSignedUrls = async () => {
      if (!payments?.length) {
        setProofUrls({});
        return;
      }

      const entries = await Promise.all(
        payments.map(async (payment) => {
          const path = getUserUploadsObjectPath(payment.payment_proof_url);
          if (!path) return [payment.id, payment.payment_proof_url || ''] as const;

          const { data } = await supabase.storage
            .from('user_uploads')
            .createSignedUrl(path, 60 * 60);

          return [payment.id, data?.signedUrl || payment.payment_proof_url || ''] as const;
        })
      );

      setProofUrls(Object.fromEntries(entries));
    };

    generateSignedUrls();
  }, [payments]);

  const totalEarnings =
    payments?.reduce((sum, payment) => sum + (payment.amount || 0), 0) || 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">My Earnings</h1>

        <Card className="p-6 flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Total Earnings</p>
            <p className="text-3xl font-bold text-green-600">Rs {totalEarnings}</p>
          </div>
          <Wallet className="h-10 w-10 text-green-600" />
        </Card>

        <div>
          <h2 className="mb-3 text-xl font-semibold">Payment History</h2>

          {isLoading ? (
            <p>Loading...</p>
          ) : payments && payments.length > 0 ? (
            <div className="space-y-3">
              {payments.map((payment) => (
                <Card
                  key={payment.id}
                  className="cursor-pointer p-4 hover:bg-muted"
                  onClick={() => setSelected(payment)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{payment.tasks?.title || 'Task'}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(payment.paid_at).toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Txn ID: {payment.transaction_id}
                      </p>
                    </div>

                    <Badge className="bg-green-500/20 text-green-400">
                      Rs {payment.amount}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No payments received yet.</p>
          )}
        </div>

        <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Payment Details</DialogTitle>
            </DialogHeader>

            {selected && (
              <div className="space-y-4 text-sm">
                {(() => {
                  const proofUrl = proofUrls[selected.id] || selected.payment_proof_url || '';

                  return (
                    <>
                <div className="space-y-2">
                  <p><strong>Task:</strong> {selected.tasks?.title || '-'}</p>
                  <p><strong>Amount:</strong> Rs {selected.amount}</p>
                  <p><strong>Transaction ID:</strong> {selected.transaction_id}</p>
                  <p><strong>Paid By:</strong> {selected.payer_name || '-'}</p>
                  <p><strong>Paid At:</strong> {new Date(selected.paid_at).toLocaleString()}</p>
                  {selected.notes && <p><strong>Notes:</strong> {selected.notes}</p>}
                </div>

                <div className="space-y-3">
                  {proofUrl ? (
                    <>
                      <img
                        src={proofUrl}
                        alt="Payment proof"
                        className="max-h-[380px] w-full rounded-lg border object-contain"
                      />
                      <Button asChild variant="outline" className="w-full">
                        <a
                          href={proofUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Open proof
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

export default WorkerPaymentHistory;
