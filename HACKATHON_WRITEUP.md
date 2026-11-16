# GoalPocket — Hackathon Project Write-up

**Tagline:** Your money. Your goals. One smarter pocket.  
**Track:** AI + Finance  
**Live preview:** https://goalpocket-v3-0-git-migrate-openrouter-alpha-c6d6.vercel.app/?_vercel_share=ZAWfgEyoL2d9djdUP4cTO3BZCwgL1Nnh  
**Code:** https://github.com/mahwongeorge2-byte/Goalpocket-V3.0/tree/migrate-openrouter

## What it is
GoalPocket is a chat-first money companion for people who manage cash and mobile-money wallets, including Orange Money, MoMo, and susu savings. It is designed to make everyday money tracking and goal planning easier, including for users handling Liberian and US dollars.

## Who it is for
People who want a simple way to understand their spending, keep track of money across pockets, plan budgets, and work toward savings goals—especially users who prefer describing transactions in everyday language instead of filling out forms.

## What goes in
Users can enter income and expenses in chat or manually, ask questions about balances and spending, set savings goals and deadlines, create budgets, and provide their own exchange rate. A transaction is only recorded after the user reviews and confirms the proposal.

## What comes out
GoalPocket presents pocket balances, available-to-spend totals, spending summaries, budget information, savings-goal progress and pace, and answers to money questions. It can propose a transaction from a chat message, but the user can edit or reject it before anything is saved.

## How the AI is used—and how numbers stay reliable
The AI interprets natural-language requests and proposes actions; it does not perform the financial calculations. Deterministic application code handles calculations, stores money in cents, keeps each pocket in one currency, and converts totals using the user's exchange rate. Responses are checked against available data, and unsupported numerical claims are retried or replaced with a code-generated response. User data is isolated with database row-level security. GoalPocket does not request PINs or passwords and does not move money.

## Does it beat a simple baseline?
A simple manual tracker can record transactions and calculate totals. GoalPocket aims to improve that experience by adding conversational entry, review-before-save action cards, and explanations of budgets and savings-goal progress in one place. These are functional differences, not a proven performance advantage: no controlled user study or benchmark against a baseline has been completed.

## Testing and current status
The public preview has been manually tested for basic chat, proposed income and expense entries, balance and spending questions, savings-goal and weekly-budget proposals, chat history, editing/resending, and deleting messages. Test financial entries were cancelled rather than saved. The repository includes automated engine/report/chat tests and a 26-check smoke-test script, but those automated checks have not all been run as part of this submission. The OpenRouter migration is available on the linked preview branch; production deployment is not being claimed as complete.

## Where it can fail / limitations
Natural-language interpretation can misunderstand a request or fail when the AI service is unavailable. The offline demo mode uses simple pattern matching and understands fewer phrasings; it is not AI. Users should review every proposed transaction before saving. Exchange-rate accuracy depends on the rate the user enters. The app does not transfer money, folders are not a supported feature, and automated test coverage does not establish that every live-AI scenario works.

**Prototype notice:** GoalPocket is a hackathon prototype, not financial advice. It is not a bank or payment service. Users remain responsible for checking their entries, balances, and exchange rates.
