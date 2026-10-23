# RakshaRoute backend

## Local development

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

`npm run dev` starts a temporary single-node MongoDB replica set, seeds three
available ambulances near Chandigarh, and then starts the API with nodemon.
This makes registration, map search, and the transactional booking flow
available without a separate database installation. Development searches top
up the local fleet to three vehicles at realistic distances from the entered
pickup point. Active local bookings automatically move the assigned vehicle
toward pickup and publish Socket.IO location updates, so the trip map and its
five-second polling fallback remain synchronized. Data is discarded whenever
the development command stops.

To use the `MONGO_URI` from `.env` instead, run:

```bash
USE_MEMORY_DB=false npm run dev
```

`npm start` and `node server.js` use the configured `MONGO_URI` directly and are
the production-style entrypoints. Production must provide a reachable MongoDB
deployment and all required environment variables from `.env.example`.

## Password reset

The login page links to `/forgot-password`. The backend stores only a SHA-256
hash of each reset token; links expire after 30 minutes and can be used once.

To deliver reset emails, configure either:

```bash
SMTP_URL=smtp://user:password@smtp.example.com:587
```

or the individual `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and
`SMTP_PASS` variables. `MAIL_FROM` optionally sets the sender address.

When SMTP is not configured during local development, the API logs the reset
link to the terminal and the forgot-password page shows an "Open reset link"
button so the flow still works end to end. In production, without working SMTP,
the endpoint stays generic for privacy and the link is only logged as a
delivery failure.
