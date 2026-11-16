# Goalpocket setup (do these in order)

The app needs no AI key to run. Without one, the chat runs in demo mode (pattern matching, not AI). For live AI, configure a Gemini API key on the server.
It does need a database and two required settings. If any is missing, the demo button and "Get started" fail.

## 1. Database (Supabase, free)
1. Create a project at supabase.com. Save the database password.
2. Open **SQL Editor** and run this once (pick your own long password):
   `create role gp_app login password 'YOUR-LONG-RANDOM-PASSWORD';`
3. Run the whole of `db/001_schema.sql`.
4. Run the whole of `db/002_supabase.sql`. **Run it after step 2.** If the role did not exist, it skips its permissions silently. If you ran it too early, just run it again.
5. Run the whole of `db/003_goal_withdrawals.sql` to enable goal withdrawals. It is safe to run more than once.
6. Run the whole of `db/004_chat_conversations.sql` to add chat conversation storage and preserve existing messages. It is safe to run more than once.
7. Open **Connect** in Supabase and copy the **Transaction pooler** connection string. Replace the user with `gp_app.<your-project-ref>` and the password with the one from step 2. This is your `DATABASE_URL`.

## 2. Vercel settings
Project → Settings → Environment Variables. Add:
- `DATABASE_URL` = the string from step 1.7
- `SESSION_SECRET` = any random text, 32 or more characters
- `GEMINI_API_KEY` = your Gemini API key (leave out to use demo chat mode)
- `GEMINI_MODEL` = optional; defaults to `gemini-3.8-flash`

Then **Redeploy** (settings only apply to new deployments).

## 3. Check it
Open `https://YOUR-APP.vercel.app/api/health`. Every line should say set, connected, or ready.
Anything saying MISSING or NOT working tells you what to fix.

## Running on your computer
`npm install`, copy `.env.example` to `.env.local` and fill it in, `npm run db:migrate`, `npm run dev`.
