-- Unschedule the previous incorrect job
select cron.unschedule('update-worker-karma-daily');

-- Reschedule with the correct production project ID
select
  cron.schedule(
    'update-worker-karma-daily',
    '0 0 * * *',
    $$
    select
      net.http_post(
          url:='https://sbvnwbcpgdcwulwsdnab.supabase.co/functions/v1/update-worker-karma',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
      ) as request_id;
    $$
  );
