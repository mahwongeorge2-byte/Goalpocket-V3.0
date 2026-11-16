# Goalpocket

**First time? Follow [SETUP.md](SETUP.md). After deploying, open `/api/health` to check everything is connected.**

Know what's in every pocket. A chat-first money companion for cash, Orange Money, MoMo and susu, in US and Liberian dollars.

Hackathon prototype (Stage 5). Not financial advice. Goalpocket never asks for PINs or passwords and never moves money.

## What works

- **Welcome, demo and setup.** "Try the demo" opens a private copy of a fictional user (Musu). "Get started" sets up your own pockets, exchange rate and goal.
- **Chat.** You type what you spent or earned. The AI proposes a card. Nothing is saved until you tap Save. You can edit the card first.
- **Money tab.** Available to spend, total with locked pockets (like susu), each pocket, this week by category, weekly budget, insight of the week, this month report, recent entries (remove with ✕), the + button for manual entries, and settings (rate, spendable pockets, sign out, delete my data).
- **Goal tab.** Progress, pace needed, your pace, finish date, and "Can I afford it?" with Show the math.

## Demo mode (no API key, no cost)

With no `GEMINI_API_KEY`, the chat runs in **demo mode**. Plain pattern matching (`src/lib/ai/offline.ts`) reads simple messages such as "Spent L$500 on keke from MoMo", "Earned $20 from sales", "Can I afford a $120 phone?", "How much did I spend this week?", "What is my balance?" and "How is my goal?". It is not AI and understands much less, and the app says so on screen. It uses the same tools, checks, confirm cards and maths as the real AI. Set `GOALPOCKET_DEMO_MODE=off` to turn it off.

## How the numbers stay honest

- Every number comes from plain code in `src/lib/engine.ts`. The AI never calculates.
- The AI can only *propose*. Saving needs the user's tap (`/api/actions/confirm`).
- Each AI reply is checked: any number not found in the data is sent back for a rewrite once, then replaced by a code-written reply.
- Money is stored in whole cents. Each pocket has one currency. Totals convert once, at the user's own rate.
- Row-level security in Postgres: each user can only read and change their own rows.

## Run it on your computer

Needs Node.js 20+ and PostgreSQL 16 (or a free Supabase project).

```bash
npm install
cp .env.example .env.local      # then fill in the values
npm run db:migrate              # creates the tables
npm run dev                     # http://localhost:3000
```

Settings (`.env.local`, or Vercel project settings). **Never put real keys in code or in chat.**

| Setting | What it is |
|---|---|
| `DATABASE_URL` | Postgres connection string. Use a database user that is *not* a superuser, so row-level security applies. |
| `SESSION_SECRET` | Any long random text, 32 characters or more. |
| `GEMINI_API_KEY` | Gemini API key. Without it the chat runs in demo mode (see above). |
| `GOALPOCKET_MODEL` | Optional. Defaults to `claude-opus-5-5`. |

## Tests

```bash
npm test                        # engine, report and chat tests (chat tests need the database)
npm run build && npm start      # then, in another window:
node scripts/smoke.mjs          # 26 end-to-end checks against the running app
```

The chat tests use a fake model and demo mode, so they cost nothing and need no key. The live AI has not been tested yet.

## Deploy (Vercel + Supabase)

1. Create a Supabase project. Create the app role by hand (`create role gp_app login password '...'`), then run `db/001_schema.sql` and `db/002_supabase.sql` in its SQL editor. Use the pooler connection string for `gp_app` as `DATABASE_URL`.
2. Push this folder to an empty GitHub repository.
3. Import the repository in Vercel. Add the settings above. Deploy.
