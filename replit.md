# Evolution API

A REST API for communication with WhatsApp, built with Node.js/TypeScript and Express.

## Overview

Evolution API is a WhatsApp integration API that allows you to send and receive messages, manage contacts, groups, and more through a REST API interface.

## Project Structure

- `src/` - Main source code
  - `api/` - API routes and controllers
  - `config/` - Configuration files
  - `cache/` - Caching utilities
  - `utils/` - Utility functions
  - `validate/` - Validation schemas
- `prisma/` - Database schema and migrations (PostgreSQL)
- `public/` - Static files
- `manager/` - Evolution Manager UI files

## Environment Configuration

The application is configured via environment variables. Key settings include:

- `SERVER_PORT=5000` - Server port
- `DATABASE_CONNECTION_URI` - PostgreSQL connection string
- `AUTHENTICATION_API_KEY` - API key for authentication
- `CORS_ORIGIN=*` - CORS configuration

## Running the Application

- Development: `npm run start` (uses tsx to run TypeScript directly)
- Production: `npm run build && npm run start:prod`

## Database

Uses PostgreSQL with Prisma ORM. Migrations are in `prisma/postgresql-migrations/`.

To regenerate Prisma client:
```bash
npx prisma generate --schema ./prisma/postgresql-schema.prisma
```

To run migrations:
```bash
npx prisma migrate deploy --schema ./prisma/postgresql-schema.prisma
```

## API Endpoints

- `GET /` - Health check
- `/manager` - Evolution Manager web interface
- Various WhatsApp API endpoints (see documentation at https://doc.evolution-api.com)

## Authentication

Use the `apikey` header with the value from `AUTHENTICATION_API_KEY` environment variable to authenticate API requests.
