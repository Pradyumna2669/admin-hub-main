-- Enable necessary extensions
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Schedule the edge function to run every day at midnight
select
  cron.schedule(
    'update-worker-karma-daily',
    '0 0 * * *',
    $$
    select
      net.http_post(
          url:='https://tnkwvwfjboazbjlyvauz.supabase.co/functions/v1/update-worker-karma',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
      ) as request_id;
    $$
  );
