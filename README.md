# Basic Node.js Base

A minimal Node.js starter with an HTML landing page and API key-protected API routes.

## Requirements

- Node.js 18+

## Run

```bash
npm start
```

## Development mode (auto-reload)

```bash
npm run dev
```

The server listens on `PORT` or defaults to `3000`.

## API Security (.env)

Create or update `.env`:

```bash
PORT=3001
API_KEYS=dev_key_alpha_2026,dev_key_beta_2026
```

All routes under `/api` require an `x-api-key` header.

Example:

```bash
curl -H "x-api-key: dev_key_alpha_2026" http://localhost:3001/api
```
