import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { ClipboardCopy, PackageSearch, RefreshCw, Webhook } from 'lucide-react';

const samplePayload = {
  order_id: 'ORD-1001',
  customer_name: 'Jane Doe',
  customer_phone: '+91XXXXXXXXXX',
  status: 'new',
  total_amount: 1499,
  currency: 'INR',
  items: [
    { sku: 'SKU-001', name: 'Starter Pack', quantity: 1, price: 1499 },
  ],
  created_at: '2026-03-26T12:00:00Z',
};

type IncomingOrderRow = {
  id: string;
  event: string;
  order_id: string;
  order_type: string | null;
  order_data: Record<string, unknown> | null;
  raw_payload: Record<string, unknown> | null;
  source: string | null;
  received_at: string;
};

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const AdminOrders: React.FC = () => {
  const { toast } = useToast();
  const webhookUrl = useMemo(() => {
    const baseUrl = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
    return baseUrl ? `${baseUrl}/functions/v1/orders-webhook` : 'Set VITE_SUPABASE_URL to generate the webhook URL';
  }, []);
  const { data: orders = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin-orders'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('incoming_orders')
        .select('id, event, order_id, order_type, order_data, raw_payload, source, received_at')
        .order('received_at', { ascending: false })
        .limit(50);

      if (error) {
        throw error;
      }

      return (data || []) as IncomingOrderRow[];
    },
  });

  const stats = useMemo(() => {
    const createdCount = orders.filter((row) => row.event === 'order.created').length;
    const latestReceivedAt = orders[0]?.received_at || null;

    return {
      total: orders.length,
      createdCount,
      latestReceivedAt,
    };
  }, [orders]);

  const copyWebhookUrl = async () => {
    if (!webhookUrl.startsWith('http')) {
      toast({
        title: 'Webhook URL unavailable',
        description: 'Set VITE_SUPABASE_URL first.',
        variant: 'destructive',
      });
      return;
    }

    await navigator.clipboard.writeText(webhookUrl);
    toast({
      title: 'Webhook URL copied',
      description: 'Send your order payloads to this endpoint after deployment.',
    });
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <section className="dashboard-hero">
          <div className="relative z-10 max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              <Webhook className="h-3.5 w-3.5" />
              Orders Intake
            </div>
            <h1 className="mt-4 font-heading text-3xl font-bold text-foreground sm:text-4xl">
              Orders
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
              This page is reserved for owners and admins. The webhook scaffold is ready, and
              incoming orders can be wired here once persistence is added.
            </p>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <Card className="rounded-[28px] border-border/70 bg-card/95">
            <CardHeader className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <CardTitle className="text-2xl">Webhook Endpoint</CardTitle>
                <Badge variant="outline">Owner/Admin Only</Badge>
                <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-700">
                  Storage Pending
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-border bg-muted/20 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
                  Webhook URL
                </div>
                <div className="mt-2 break-all font-mono text-sm text-foreground">
                  {webhookUrl}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="button" onClick={copyWebhookUrl}>
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  Copy Webhook URL
                </Button>
                <Button type="button" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh Orders
                </Button>
              </div>

              <div className="rounded-2xl border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
                POST payloads shaped like <code>{'{ event, order_id, order_type, order_data }'}</code> are stored and listed below.
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="text-2xl">Incoming Orders Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Total</div>
                  <div className="mt-2 text-3xl font-semibold">{stats.total}</div>
                </div>
                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">order.created</div>
                  <div className="mt-2 text-3xl font-semibold">{stats.createdCount}</div>
                </div>
                <div className="rounded-2xl border border-border bg-muted/20 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Latest Received</div>
                  <div className="mt-2 text-sm font-medium text-foreground">
                    {formatDateTime(stats.latestReceivedAt)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-[28px] border-border/70 bg-card/95">
          <CardHeader>
            <CardTitle className="text-2xl">Recent Incoming Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/10 p-6 text-sm text-muted-foreground">
                Loading orders...
              </div>
            ) : orders.length === 0 ? (
              <div className="flex min-h-[220px] flex-col items-center justify-center rounded-3xl border border-dashed border-border bg-muted/10 p-8 text-center">
                <PackageSearch className="h-12 w-12 text-muted-foreground" />
                <div className="mt-4 text-lg font-semibold text-foreground">
                  No orders received yet
                </div>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Once your source system POSTs to the webhook, orders will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div key={order.id} className="rounded-3xl border border-border bg-background/60 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{order.event}</Badge>
                          {order.order_type ? <Badge variant="outline">{order.order_type}</Badge> : null}
                          <Badge variant="outline">{order.order_id}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Received: {formatDateTime(order.received_at)}
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Source: {order.source || 'orders-webhook'}
                      </div>
                    </div>
                    <pre className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card/70 p-4 text-xs text-foreground">
                      {JSON.stringify(order.order_data || order.raw_payload || {}, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/70 bg-card/95">
          <CardHeader>
            <CardTitle className="text-2xl">Sample Payload</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-2xl border border-border bg-background/70 p-4 text-sm text-foreground">
              {JSON.stringify(samplePayload, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminOrders;
