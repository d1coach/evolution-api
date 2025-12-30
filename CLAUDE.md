# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Evolution API** is a production-ready REST API for WhatsApp communication supporting multiple providers:
- **Baileys** - WhatsApp Web client (QR code authentication)
- **Meta Business API** - Official WhatsApp Business API
- **Evolution API** - Custom WhatsApp integration

Built with Node.js 20+, TypeScript 5+, Express.js. Multi-tenant architecture with chatbot, CRM, and messaging platform integrations.

## Common Development Commands

### Build and Run
```bash
# Development
npm run dev:server    # Run in development with hot reload (tsx watch)

# Production
npm run build        # TypeScript check + tsup build
npm run start:prod   # Run production build

# Direct execution
npm start           # Run with tsx
```

### Code Quality
```bash
npm run lint        # ESLint with auto-fix
npm run lint:check  # ESLint check only
npm run commit      # Interactive commit with commitizen
```

### Database Management
```bash
# Set database provider first
export DATABASE_PROVIDER=postgresql  # or mysql

# Generate Prisma client (automatically uses DATABASE_PROVIDER env)
npm run db:generate

# Deploy migrations (production)
npm run db:deploy      # Unix/Mac
npm run db:deploy:win  # Windows

# Development migrations (with sync to provider folder)
npm run db:migrate:dev      # Unix/Mac
npm run db:migrate:dev:win  # Windows

# Open Prisma Studio
npm run db:studio
```

### Testing
```bash
npm test    # Run tests with watch mode (minimal test infrastructure currently)
```

## Architecture Overview

### Core Structure
- **Multi-tenant SaaS**: Complete instance isolation with per-tenant authentication
- **Multi-provider database**: PostgreSQL and MySQL via Prisma ORM with provider-specific schemas
- **Event-driven**: EventEmitter2 internally + WebSocket, RabbitMQ, SQS, NATS, Pusher externally
- **Microservices pattern**: Modular integrations for chatbots, storage, and external services

### Directory Layout
```
src/
├── api/
│   ├── controllers/     # HTTP route handlers (thin layer)
│   ├── services/        # Business logic (core functionality)
│   ├── repository/      # Data access layer (Prisma)
│   ├── dto/            # Data Transfer Objects (simple classes)
│   ├── guards/         # Authentication/authorization middleware
│   ├── integrations/   # External service integrations
│   │   ├── channel/    # WhatsApp providers (Baileys, Business API, Evolution)
│   │   ├── chatbot/    # AI/Bot integrations (OpenAI, Dify, Typebot, Chatwoot)
│   │   ├── event/      # Event systems (WebSocket, RabbitMQ, SQS, NATS, Pusher)
│   │   └── storage/    # File storage (S3, MinIO)
│   ├── routes/         # Express route definitions (RouterBroker pattern)
│   └── types/          # TypeScript type definitions
├── config/             # Environment and app configuration
├── cache/             # Redis and local cache implementations
├── exceptions/        # Custom HTTP exception classes
├── utils/            # Shared utilities and helpers
└── validate/         # JSONSchema7 validation schemas
```

### Key Integration Points

**Channel Integrations** (`src/api/integrations/channel/`):
- **Baileys**: WhatsApp Web client with QR code authentication
- **Business API**: Official Meta WhatsApp Business API
- **Evolution API**: Custom WhatsApp integration
- Connection lifecycle management per instance with automatic reconnection

**Chatbot Integrations** (`src/api/integrations/chatbot/`):
- **EvolutionBot**: Native chatbot with trigger system
- **Chatwoot**: Customer service platform integration
- **Typebot**: Visual chatbot flow builder
- **OpenAI**: AI capabilities including GPT and Whisper (audio transcription)
- **Dify**: AI agent workflow platform
- **Flowise**: LangChain visual builder
- **N8N**: Workflow automation platform
- **EvoAI**: Custom AI integration

**Event Integrations** (`src/api/integrations/event/`):
- **WebSocket**: Real-time Socket.io connections
- **RabbitMQ**: Message queue for async processing
- **Amazon SQS**: Cloud-based message queuing
- **NATS**: High-performance messaging system
- **Pusher**: Real-time push notifications

**Storage Integrations** (`src/api/integrations/storage/`):
- **AWS S3**: Cloud object storage
- **MinIO**: Self-hosted S3-compatible storage
- Media file management and URL generation

### Database Schema Management
- Separate schema files: `postgresql-schema.prisma` and `mysql-schema.prisma`
- Environment variable `DATABASE_PROVIDER` determines active database
- Migration folders are provider-specific and auto-selected during deployment

### Authentication & Security
- **API key-based authentication** via `apikey` header (global or per-instance)
- **Instance-specific tokens** for WhatsApp connection authentication
- **Guards system** for route protection and authorization
- **Input validation** using JSONSchema7 with RouterBroker `dataValidate`
- **Rate limiting** and security middleware
- **Webhook signature validation** for external integrations

## Key Implementation Patterns

### WhatsApp Instance Management
- Each WhatsApp connection is an "instance" with unique name
- Session persistence in database or file system (configurable)
- Automatic reconnection with exponential backoff

### RouterBroker Pattern
Routes extend `RouterBroker` and use `dataValidate` for request handling:
```typescript
.post(this.routerPath('createExample'), ...guards, async (req, res) => {
  const response = await this.dataValidate<ExampleDto>({
    request: req,
    schema: exampleSchema,  // JSONSchema7 validation
    ClassRef: ExampleDto,
    execute: (instance, data) => controller.create(instance, data),
  });
  return res.status(HttpStatus.CREATED).json(response);
})
```

### Service Layer Pattern
Services access WhatsApp instances via `WAMonitoringService`:
```typescript
export class ExampleService {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  public async operation(instance: InstanceDto, data: DataDto) {
    await this.waMonitor.waInstances[instance.instanceName].performAction(data);
    return { result: { ...instance, data } };
  }
}
```

### Guards System
Standard guard chain: `[instanceExistsGuard, instanceLoggedGuard, authGuard['apikey']]`

## Environment Configuration

Key environment variables defined in `.env.example`, typed via `src/config/env.config.ts`:
- `DATABASE_PROVIDER`: postgresql or mysql
- `DATABASE_CONNECTION_URI`: Database connection string
- `AUTHENTICATION_API_KEY`: Global API authentication
- `REDIS_ENABLED`: Enable Redis cache
- `RABBITMQ_ENABLED`/`SQS_ENABLED`: Message queue options

## Code Standards

- **TypeScript strict mode** - avoid `any` type
- **JSONSchema7** for input validation (not class-validator)
- **Conventional Commits** enforced by commitlint (`npm run commit` for guided commits)
- **ESLint + Prettier** for formatting
- **Logger class** instead of console.log
- **Portuguese (PT-BR)** for user-facing error messages; English for code/comments