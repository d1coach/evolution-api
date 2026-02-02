import { bullmqConnection } from '@cache/bullmq.connection';
import { configService, RateLimitConf } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { WASocket } from 'baileys';
import { Job, Worker } from 'bullmq';

import {
  GroupMetadataJobData,
  JobType,
  ListJoinRequestsJobData,
  OnWhatsAppJobData,
  QueueJobData,
  QueueJobResult,
  ReadMessagesJobData,
  SendMessageJobData,
  SendPresenceJobData,
  UpdateJoinRequestJobData,
} from './baileys.queue.types';

export class BaileysQueueWorker {
  private readonly logger: Logger;
  private worker: Worker<QueueJobData, QueueJobResult> | null = null;
  private readonly conf: RateLimitConf;
  private readonly queueName: string;
  private client: WASocket | null = null;
  private currentBackoffMs = 0;
  private lastRateLimitTime = 0;
  private readonly BACKOFF_RESET_MS = 5 * 60 * 1000;

  constructor(
    private readonly instanceName: string,
    private readonly instanceId: string,
  ) {
    this.logger = new Logger(`BaileysWorker:${instanceName}`);
    this.conf = configService.get<RateLimitConf>('RATE_LIMIT');
    this.queueName = `baileys_${instanceId}`;
  }

  public setClient(client: WASocket): void {
    this.client = client;
    if (this.conf?.ENABLED && !this.worker) {
      this.initialize();
    }
  }

  private initialize(): void {
    if (!this.conf?.ENABLED) {
      this.logger.verbose('Rate limiting is disabled, worker not started');
      return;
    }

    const connection = bullmqConnection.getConnection();
    if (!connection) {
      this.logger.warn('BullMQ Redis connection not available, worker not started');
      return;
    }

    if (!this.client) {
      this.logger.warn('WhatsApp client not available, worker not started');
      return;
    }

    try {
      this.worker = new Worker<QueueJobData, QueueJobResult>(this.queueName, async (job) => this.processJob(job), {
        connection,
        concurrency: 1,
        limiter: {
          max: this.conf.MESSAGES_PER_MINUTE,
          duration: 60000,
        },
      });

      this.worker.on('completed', (job) => {
        this.logger.verbose(`Job ${job.id} completed`);
        this.checkBackoffReset();
      });

      this.worker.on('failed', (job, error) => {
        this.logger.error(`Job ${job?.id} failed: ${error.message}`);
        if (this.isRateLimitError(error)) {
          this.handleRateLimitError();
        }
      });

      this.worker.on('error', (error) => {
        this.logger.error(`Worker error: ${error.message}`);
      });

      this.logger.verbose(`Worker initialized: ${this.queueName}`);
    } catch (error) {
      this.logger.error(`Failed to initialize worker: ${error}`);
      this.worker = null;
    }
  }

  private async processJob(job: Job<QueueJobData, QueueJobResult>): Promise<QueueJobResult> {
    if (!this.client) {
      return { success: false, error: 'WhatsApp client not available', retryable: true };
    }

    if (this.currentBackoffMs > 0) {
      const jitteredBackoff = this.applyBackoffJitter(this.currentBackoffMs);
      this.logger.verbose(`Applying backoff delay: ${jitteredBackoff}ms (base: ${this.currentBackoffMs}ms)`);
      await this.delay(jitteredBackoff);
    }

    const data = job.data;

    try {
      switch (data.type) {
        case JobType.SEND_MESSAGE:
          return await this.processSendMessage(data as SendMessageJobData);

        case JobType.SEND_PRESENCE_UPDATE:
          return await this.processPresenceUpdate(data as SendPresenceJobData);

        case JobType.GROUP_METADATA:
          return await this.processGroupMetadata(data as GroupMetadataJobData);

        case JobType.READ_MESSAGES:
          return await this.processReadMessages(data as ReadMessagesJobData);

        case JobType.ON_WHATSAPP:
          return await this.processOnWhatsApp(data as OnWhatsAppJobData);

        case JobType.LIST_JOIN_REQUESTS:
          return await this.processListJoinRequests(data as ListJoinRequestsJobData);

        case JobType.UPDATE_JOIN_REQUEST:
          return await this.processUpdateJoinRequest(data as UpdateJoinRequestJobData);

        default:
          return { success: false, error: 'Unknown job type', retryable: false };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (this.isRateLimitError(error)) {
        this.handleRateLimitError();
        throw error;
      }

      return { success: false, error: errorMessage, retryable: this.isRetryableError(error) };
    }
  }

  private async processSendMessage(data: SendMessageJobData): Promise<QueueJobResult> {
    const result = await this.client!.sendMessage(data.sender, data.message, data.options);
    this.resetBackoffOnSuccess();
    return { success: true, data: result };
  }

  private async processPresenceUpdate(data: SendPresenceJobData): Promise<QueueJobResult> {
    if (data.toJid) {
      await this.client!.sendPresenceUpdate(data.presence, data.toJid);
    } else {
      await this.client!.sendPresenceUpdate(data.presence);
    }
    this.resetBackoffOnSuccess();
    return { success: true };
  }

  private async processGroupMetadata(data: GroupMetadataJobData): Promise<QueueJobResult> {
    const metadata = await this.client!.groupMetadata(data.groupJid);
    this.resetBackoffOnSuccess();
    return { success: true, data: metadata };
  }

  private async processReadMessages(data: ReadMessagesJobData): Promise<QueueJobResult> {
    await this.client!.readMessages(data.keys);
    this.resetBackoffOnSuccess();
    return { success: true };
  }

  private async processOnWhatsApp(data: OnWhatsAppJobData): Promise<QueueJobResult> {
    const result = await this.client!.onWhatsApp(data.jid);
    this.resetBackoffOnSuccess();
    return { success: true, data: result };
  }

  private async processListJoinRequests(data: ListJoinRequestsJobData): Promise<QueueJobResult> {
    const participants = await this.client!.groupRequestParticipantsList(data.groupJid);
    this.resetBackoffOnSuccess();
    return { success: true, data: participants };
  }

  private async processUpdateJoinRequest(data: UpdateJoinRequestJobData): Promise<QueueJobResult> {
    const result = await this.client!.groupRequestParticipantsUpdate(data.groupJid, data.participants, data.action);
    this.resetBackoffOnSuccess();
    return { success: true, data: result };
  }

  private isRateLimitError(error: unknown): boolean {
    if (!error) return false;

    const errorObj = error as any;
    const message = errorObj?.message || '';
    const output = errorObj?.output;
    const data = errorObj?.data;

    return (
      message.includes('rate-overlimit') ||
      message.includes('too many requests') ||
      message.toLowerCase().includes('rate limit') ||
      output?.statusCode === 429 ||
      data === 429
    );
  }

  private isRetryableError(error: unknown): boolean {
    if (!error) return true;

    const errorObj = error as any;
    const message = errorObj?.message || '';

    const nonRetryablePatterns = ['not authorized', 'unauthorized', 'forbidden', 'not found', 'invalid', 'bad request'];

    return !nonRetryablePatterns.some((pattern) => message.toLowerCase().includes(pattern));
  }

  private handleRateLimitError(): void {
    this.lastRateLimitTime = Date.now();

    if (this.currentBackoffMs === 0) {
      this.currentBackoffMs = this.conf.INITIAL_BACKOFF_MS;
    } else {
      this.currentBackoffMs = Math.min(this.currentBackoffMs * this.conf.BACKOFF_MULTIPLIER, this.conf.MAX_BACKOFF_MS);
    }

    this.logger.warn(`Rate limit hit, backoff increased to ${this.currentBackoffMs}ms`);
  }

  private checkBackoffReset(): void {
    if (this.currentBackoffMs > 0 && Date.now() - this.lastRateLimitTime > this.BACKOFF_RESET_MS) {
      this.logger.verbose('Resetting backoff after successful period');
      this.currentBackoffMs = 0;
    }
  }

  private resetBackoffOnSuccess(): void {
    this.checkBackoffReset();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Apply jitter to backoff delay to avoid synchronized retry storms
   * and make the retry pattern less predictable.
   * Uses BACKOFF_JITTER_FACTOR (default 0.25 = ±25% variance)
   */
  private applyBackoffJitter(baseDelay: number): number {
    const jitterFactor = this.conf.BACKOFF_JITTER_FACTOR || 0;
    if (jitterFactor === 0) {
      return baseDelay;
    }
    // Random value between -1 and 1, multiplied by jitter factor
    const jitterMultiplier = (Math.random() * 2 - 1) * jitterFactor;
    const jitteredDelay = Math.round(baseDelay * (1 + jitterMultiplier));
    // Ensure delay is never negative
    return Math.max(0, jitteredDelay);
  }

  public async close(): Promise<void> {
    try {
      if (this.worker) {
        await this.worker.close();
        this.worker = null;
      }
      this.client = null;
      this.logger.verbose('Worker closed');
    } catch (error) {
      this.logger.error(`Failed to close worker: ${error}`);
    }
  }

  public isRunning(): boolean {
    return this.worker !== null;
  }
}
