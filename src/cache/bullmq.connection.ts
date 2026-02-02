import { configService, RateLimitConf } from '@config/env.config';
import { Logger } from '@config/logger.config';
import Redis from 'ioredis';

class BullMQConnection {
  private logger = new Logger('BullMQConnection');
  private client: Redis | null = null;
  private conf: RateLimitConf;
  private connected = false;
  private connecting = false;

  constructor() {
    this.conf = configService.get<RateLimitConf>('RATE_LIMIT');
  }

  public isEnabled(): boolean {
    return this.conf?.ENABLED && !!this.conf?.REDIS_URI;
  }

  public isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  public getConnection(): Redis | null {
    if (!this.isEnabled()) {
      return null;
    }

    if (this.connected && this.client) {
      return this.client;
    }

    if (this.connecting) {
      return null;
    }

    this.connecting = true;

    try {
      this.client = new Redis(this.conf.REDIS_URI, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times) => {
          if (times > 10) {
            this.logger.error('BullMQ Redis connection failed after 10 retries');
            return null;
          }
          return Math.min(times * 100, 3000);
        },
      });

      this.client.on('connect', () => {
        this.logger.verbose('BullMQ Redis connecting');
      });

      this.client.on('ready', () => {
        this.logger.verbose('BullMQ Redis ready');
        this.connected = true;
        this.connecting = false;
      });

      this.client.on('error', (err) => {
        this.logger.error('BullMQ Redis error: ' + err.message);
        this.connected = false;
      });

      this.client.on('close', () => {
        this.logger.verbose('BullMQ Redis connection closed');
        this.connected = false;
      });

      this.client.on('end', () => {
        this.logger.verbose('BullMQ Redis connection ended');
        this.connected = false;
        this.connecting = false;
      });

      return this.client;
    } catch (e) {
      this.logger.error('BullMQ Redis connect exception: ' + e);
      this.connected = false;
      this.connecting = false;
      return null;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch (e) {
        this.logger.error('BullMQ Redis disconnect error: ' + e);
      } finally {
        this.client = null;
        this.connected = false;
        this.connecting = false;
      }
    }
  }
}

export const bullmqConnection = new BullMQConnection();
