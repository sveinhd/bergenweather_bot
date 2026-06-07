# bergenweather_bot

Posts weather updates for Bergen to Bluesky using data from the Norwegian Meteorological Institute.

## Prerequisites

- Node.js 18+
- npm

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create an environment file from `example.env` and fill in your credentials:

   ```bash
   cp example.env .env
   ```

3. Required variables in `.env`:

   - `BLUESKY_USERNAME`
   - `BLUESKY_PASSWORD`
   - `FROST_ID`

## Compile And Run

Compile TypeScript to JavaScript:

```bash
npm run build
```

Run the bot:

```bash
npm start
```

This is equivalent to running `node index.js`.

## Useful Scripts

- `npm run build`: compile TypeScript (`tsc`)
- `npm run typecheck`: type-check without emitting files
- `npm test`: run tests with Vitest
- `npm start`: run the compiled bot

## Runtime Behavior

When started, the bot:

1. Runs `main()` immediately.
2. Posts to Bluesky right away.
3. Starts a cron job defined in `index.ts`.

Current schedule:

- `10 * * * *` (minute 10 of every hour)

If you want to test frequently, there is also a commented minute-by-minute schedule in `index.ts`.
