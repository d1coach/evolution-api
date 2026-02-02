# BullMQ Rate Limiter for WhatsApp/Baileys Operations

## Overview

This rate limiting system uses BullMQ (Redis-backed job queue) to throttle outgoing WhatsApp API calls, preventing `rate-overlimit` (429) errors from WhatsApp servers. It implements per-instance queuing with configurable limits, exponential backoff on rate limit hits, and jitter to avoid pattern detection.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Request                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BaileysQueueService                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  • Receives sendMessage requests                                     │    │
│  │  • Calculates jittered delay (750ms - 2250ms with default config)   │    │
│  │  • Adds job to Redis queue with priority                            │    │
│  │  • Deduplicates metadata requests (same group = same jobId)         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Redis Queue                                        │
│                        (baileys:{instanceId})                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Jobs sorted by:                                                     │    │
│  │    1. Priority (CRITICAL > REPLY > OUTGOING > PRESENCE > METADATA)  │    │
│  │    2. Delay (jittered)                                              │    │
│  │    3. FIFO within same priority                                     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BaileysQueueWorker                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  • Processes jobs one at a time (concurrency: 1)                    │    │
│  │  • Rate limited: max N jobs per minute                              │    │
│  │  • Applies backoff delay if rate-limited (with jitter)              │    │
│  │  • Detects 429 errors and increases backoff exponentially           │    │
│  │  • Resets backoff after 5 minutes of successful operations          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Baileys Client                                       │
│                      (this.client.sendMessage)                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WhatsApp Servers                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `false` | Enable/disable rate limiting |
| `RATE_LIMIT_REDIS_URI` | (uses `CACHE_REDIS_URI`) | Redis connection string |
| `RATE_LIMIT_MESSAGES_PER_MINUTE` | `40` | Max messages per minute per instance |
| `RATE_LIMIT_MESSAGE_DELAY_MS` | `1500` | Base delay between messages |
| `RATE_LIMIT_PRESENCE_PER_MINUTE` | `60` | Max presence updates per minute |
| `RATE_LIMIT_METADATA_PER_MINUTE` | `30` | Max metadata lookups per minute |
| `RATE_LIMIT_MAX_RETRIES` | `5` | Max retry attempts for failed jobs |
| `RATE_LIMIT_INITIAL_BACKOFF_MS` | `5000` | Initial backoff on rate limit (5s) |
| `RATE_LIMIT_MAX_BACKOFF_MS` | `300000` | Maximum backoff delay (5 min) |
| `RATE_LIMIT_BACKOFF_MULTIPLIER` | `2` | Exponential backoff multiplier |
| `RATE_LIMIT_FALLBACK_ENABLED` | `true` | Fall back to direct calls if queue fails |
| `RATE_LIMIT_QUEUE_TIMEOUT_MS` | `30000` | Max wait for job completion |
| `RATE_LIMIT_JITTER_FACTOR` | `0.5` | Message delay jitter (±50%) |
| `RATE_LIMIT_BACKOFF_JITTER_FACTOR` | `0.25` | Backoff jitter (±25%) |

### Recommended Production Configuration

```bash
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MESSAGES_PER_MINUTE=40
RATE_LIMIT_MESSAGE_DELAY_MS=1500
RATE_LIMIT_PRESENCE_PER_MINUTE=60
RATE_LIMIT_METADATA_PER_MINUTE=30
RATE_LIMIT_MAX_RETRIES=5
RATE_LIMIT_INITIAL_BACKOFF_MS=5000
RATE_LIMIT_MAX_BACKOFF_MS=300000
RATE_LIMIT_BACKOFF_MULTIPLIER=2
RATE_LIMIT_FALLBACK_ENABLED=true
RATE_LIMIT_QUEUE_TIMEOUT_MS=30000
RATE_LIMIT_JITTER_FACTOR=0.5
RATE_LIMIT_BACKOFF_JITTER_FACTOR=0.25
```

## Jitter Implementation

Jitter adds randomness to delays to avoid pattern detection by WhatsApp's anti-bot systems.

### Message Delay Jitter

```
Base delay: 1500ms
Jitter factor: 0.5 (±50%)
Effective range: 750ms - 2250ms

Formula: delay = baseDelay * (1 + random(-1, 1) * jitterFactor)
```

### Backoff Jitter

```
Base backoff: 5000ms (after first rate limit)
Jitter factor: 0.25 (±25%)
Effective range: 3750ms - 6250ms

Exponential progression (base values):
  Hit 1: 5000ms   → actual: 3750ms - 6250ms
  Hit 2: 10000ms  → actual: 7500ms - 12500ms
  Hit 3: 20000ms  → actual: 15000ms - 25000ms
  Hit 4: 40000ms  → actual: 30000ms - 50000ms
  Hit 5: 80000ms  → actual: 60000ms - 100000ms
  Max:   300000ms → actual: 225000ms - 375000ms
```

## Job Priority System

Jobs are processed in priority order:

| Priority | Value | Use Case |
|----------|-------|----------|
| `CRITICAL` | 1 | System messages (not currently used) |
| `REPLY` | 2 | Replies to incoming messages |
| `OUTGOING` | 3 | Standard outgoing messages |
| `PRESENCE` | 4 | Typing indicators |
| `METADATA` | 5 | Group metadata lookups |

## Rate Limit Detection

The worker detects rate limit errors by checking for:

- Error message contains `rate-overlimit`
- Error message contains `too many requests`
- Error message contains `rate limit`
- HTTP status code `429`
- Error data equals `429`

## Graceful Degradation

When `RATE_LIMIT_FALLBACK_ENABLED=true`:

1. If Redis is unavailable → messages sent directly (no rate limiting)
2. If queue job fails → retry or fall back to direct send
3. If job times out → fall back to direct send

When `RATE_LIMIT_FALLBACK_ENABLED=false`:

- Errors are thrown instead of falling back
- Useful for strict rate limit enforcement

## File Structure

```
src/
├── cache/
│   └── bullmq.connection.ts       # Redis connection manager (ioredis)
├── config/
│   └── env.config.ts              # RateLimitConf type + env parsing
└── api/integrations/channel/whatsapp/
    ├── queue/
    │   ├── index.ts                       # Barrel exports
    │   ├── baileys.queue.types.ts         # TypeScript interfaces
    │   ├── baileys.queue.service.ts       # Queue management
    │   └── baileys.queue.worker.ts        # Job processing
    └── whatsapp.baileys.service.ts        # Integration point
```

## Dependencies

```json
{
  "bullmq": "^5.67.2",
  "ioredis": "^5.9.2"
}
```

**Note:** BullMQ requires `ioredis`, not the standard `redis` package. Both coexist in the project.

## Integration Points

### Initialization

Queue is initialized when WhatsApp client connects:

```typescript
// In whatsapp.baileys.service.ts
this.client = makeWASocket(socketConfig);
this.initializeQueue();  // Creates queue service + worker
```

### Message Sending

Messages are routed through the queue:

```typescript
// sendMessageViaQueue() wraps this.client.sendMessage()
// Falls back to direct call if queue unavailable or fails
```

### Cleanup

Queue resources are released on logout:

```typescript
// In logoutInstance()
await this.queueWorker?.close();
await this.queueService?.close();
```

## Monitoring

Queue stats are available via:

```typescript
const stats = await queueService.getQueueStats();
// Returns: { waiting, active, completed, failed, delayed }
```

Stats are logged at verbose level during operation.

## Safety Thresholds

Based on community research for WhatsApp/Baileys:

| Threshold | Safe | Moderate Risk | High Risk |
|-----------|------|---------------|-----------|
| Messages/min | 30-40 | 60-80 | 120+ |
| Delay between msgs | 2-3s | 1-2s | <1s |

The default configuration uses conservative values within the "Safe" range.
