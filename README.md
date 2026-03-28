# StoicOPS Admin Hub

## Project info

**URL**: (add your deployed URL here)

## How can I edit this code?

There are several ways of editing your application.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Deploy the static build output (typically `dist/`) to your hosting provider of choice.

## WhatsApp Order Bot

This repo now includes a Supabase Edge Function at `supabase/functions/whatsapp-order-bot` that lets clients ask WhatsApp for their order details.

### What it does

- Matches the incoming WhatsApp number against `profiles.whatsapp_phone_e164`
- Only replies when `profiles.whatsapp_opt_in = true`
- Returns recent orders for `orders`, `status`, or `hello`
- Returns one specific order for messages like `order ORD-1234ABCD`
- Uses `tasks.public_order_code` as the client-facing order reference

### Required setup

1. Apply the latest Supabase migration:

```bash
supabase db push
```

2. Deploy the function:

```bash
supabase functions deploy whatsapp-order-bot --no-verify-jwt
```

3. Set function secrets:

```bash
supabase secrets set WHATSAPP_VERIFY_TOKEN=your_verify_token
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
supabase secrets set WHATSAPP_ACCESS_TOKEN=your_meta_access_token
supabase secrets set WHATSAPP_APP_SECRET=your_meta_app_secret
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

4. In Meta WhatsApp Cloud API, point the webhook to:

```text
https://<your-project-ref>.supabase.co/functions/v1/whatsapp-order-bot
```

5. In the admin app, open `Clients`, save each client's WhatsApp number in E.164 format, and enable WhatsApp replies.

### Client commands

- `orders`
- `status`
- `order ORD-1234ABCD`
- `help`

## Arcade Survivor Mode

The arcade now includes a low-resource multiplayer survival shooter built with:

- HTML5 Canvas on the client
- Socket.IO for realtime multiplayer
- Node.js for the match server
- SQLite via Node's built-in `node:sqlite` module for credits, wins, kills, and leaderboard persistence

### Local run

Start the React app and the arcade server in separate terminals:

```bash
npm install
npm run dev
npm run dev:arcade-server
```

The Vite dev server proxies:

- `/api/arcade-survivor`
- `/socket.io/arcade-survivor`

If you host the arcade server on another origin, set `VITE_ARCADE_SURVIVOR_SERVER_URL` in your environment.

## Seeding a Default Admin

A migration has been added to create a table of initial admin emails and to grant the `admin` role to any user who signs up with one of those emails.

- **Migration file:** supabase/migrations/20260110050000_seed_initial_admin.sql
- **Default seeded email:** `admin@stoicops.com` (change this if you prefer a different address)

How it works:

- When a new user signs up, the signup trigger checks `public.initial_admins`.
- If the signing-up user's email exists there, they receive the `admin` role; otherwise they get the `client` role.

To change the seeded admin email, edit the migration file or run an SQL insert against your database:

```sql
INSERT INTO public.initial_admins (email) VALUES ('you@yourdomain.com');
```

To apply migrations locally or to your Supabase project, use the Supabase CLI. Example commands (adjust for your setup):

```bash
# start the local supabase stack (if using local development)
supabase start

# apply migrations to the target database
supabase db push
```

After applying the migration, sign up in the app using the seeded admin email to get the admin role automatically.
