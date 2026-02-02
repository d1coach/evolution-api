import { bullmqConnection } from '@cache/bullmq.connection';
import { configService, RateLimitConf } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { AnyMessageContent, MiscMessageGenerationOptions, WAPresence } from 'baileys';
import { Job, Queue, QueueEvents } from 'bullmq';

import {
  GroupMetadataJobData,
  JobType,
  ListJoinRequestsJobData,
  OnWhatsAppJobData,
  QueueJobData,
  QueueJobResult,
  QueuePriority,
  QueueStats,
  ReadMessagesJobData,
  SendMessageJobData,
  SendPresenceJobData,
  UpdateJoinRequestJobData,
} from './baileys.queue.types';

export class BaileysQueueService {
  private readonly logger: Logger;
  private queue: Queue<QueueJobData, QueueJobResult> | null = null;
  private queueEvents: QueueEvents | null = null;
  private readonly conf: RateLimitConf;
  private readonly queueName: string;

  constructor(
    private readonly instanceName: string,
    private readonly instanceId: string,
  ) {
    this.logger = new Logger(`BaileysQueue:${instanceName}`);
    this.conf = configService.get<RateLimitConf>('RATE_LIMIT');
    this.queueName = `baileys_${instanceId}`;
    this.initialize();
  }

  private initialize(): void {
    if (!this.conf?.ENABLED) {
      this.logger.verbose('Rate limiting is disabled');
      return;
    }

    const connection = bullmqConnection.getConnection();
    if (!connection) {
      this.logger.warn('BullMQ Redis connection not available, rate limiting disabled');
      return;
    }

    try {
      this.queue = new Queue<QueueJobData, QueueJobResult>(this.queueName, {
        connection,
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: this.conf.MAX_RETRIES,
          backoff: {
            type: 'exponential',
            delay: this.conf.INITIAL_BACKOFF_MS,
          },
        },
      });

      this.queueEvents = new QueueEvents(this.queueName, { connection });

      this.logger.verbose(`Queue initialized: ${this.queueName}`);
    } catch (error) {
      this.logger.error(`Failed to initialize queue: ${error}`);
      this.queue = null;
      this.queueEvents = null;
    }
  }

  public isQueueEnabled(): boolean {
    // Use isAvailable() instead of isConnected() - BullMQ handles connection state internally
    return this.queue !== null && bullmqConnection.isAvailable();
  }

  /**
   * Calculate a jittered delay to avoid pattern detection.
   * Uses the configured JITTER_FACTOR to add random variance.
   * e.g., baseDelay=1500ms with jitterFactor=0.5 gives range 750ms-2250ms
   */
  private calculateJitteredDelay(baseDelay: number): number {
    const jitterFactor = this.conf.JITTER_FACTOR || 0;
    if (jitterFactor === 0) {
      return baseDelay;
    }
    // Random value between -1 and 1, multiplied by jitter factor
    const jitterMultiplier = (Math.random() * 2 - 1) * jitterFactor;
    const jitteredDelay = Math.round(baseDelay * (1 + jitterMultiplier));
    // Ensure delay is never negative
    return Math.max(0, jitteredDelay);
  }

  public async addSendMessageJob(
    sender: string,
    message: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
    isReply = false,
  ): Promise<Job<QueueJobData, QueueJobResult> | null> {
    if (!this.isQueueEnabled()) {
      return null;
    }

    const jobData: SendMessageJobData = {
      type: JobType.SEND_MESSAGE,
      sender,
      message,
      options,
      isReply,
    };

    const priority = isReply ? QueuePriority.REPLY : QueuePriority.OUTGOING;
    const delay = this.calculateJitteredDelay(this.conf.MESSAGE_DELAY_MS);

    try {
      const job = await this.queue!.add(JobType.SEND_MESSAGE, jobData, {
        priority,
        delay,
      });
      this.logger.verbose(`Added send message job: ${job.id} to ${sender} (delay: ${delay}ms)`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add send message job: ${error}`);
      return null;
    }
  }

  public async addPresenceJob(presence: WAPresence, toJid?: string): Promise<Job<QueueJobData, QueueJobResult> | null> {
    if (!this.isQueueEnabled()) {
      return null;
    }

    const jobData: SendPresenceJobData = {
      type: JobType.SEND_PRESENCE_UPDATE,
      presence,
      toJid,
    };

    try {
      const job = await this.queue!.add(JobType.SEND_PRESENCE_UPDATE, jobData, {
        priority: QueuePriority.PRESENCE,
      });
      this.logger.verbose(`Added presence job: ${job.id}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add presence job: ${error}`);
      return null;
    }
  }

  public async addGroupMetadataJob(groupJid: string): Promise<Job<QueueJobData, QueueJobResult> | null> {
    if (!this.isQueueEnabled()) {
      return null;
    }

    const jobData: GroupMetadataJobData = {
      type: JobType.GROUP_METADATA,
      groupJid,
    };

    const jobId = `group-metadata:${groupJid}`;

    try {
      const existingJob = await this.queue!.getJob(jobId);
      if (existingJob && !(await existingJob.isCompleted()) && !(await existingJob.isFailed())) {
        this.logger.verbose(`Deduplicating group metadata job for: ${groupJid}`);
        return existingJob;
      }

      const job = await this.queue!.add(JobType.GROUP_METADATA, jobData, {
        priority: QueuePriority.METADATA,
        jobId,
      });
      this.logger.verbose(`Added group metadata job: ${job.id}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add group metadata job: ${error}`);
      return null;
    }
  }

  public async addReadMessagesJob(
    keys: { remoteJid: string; id: string; participant?: string }[],
  ): Promise<Job<QueueJobData, QueueJobResult> | null> {
    if (!this.isQueueEnabled()) {
      return null;
    }

    const jobData: ReadMessagesJobData = {
      type: JobType.READ_MESSAGES,
      keys,
    };

    try {
      const job = await this.queue!.add(JobType.READ_MESSAGES, jobData, {
        priority: QueuePriority.OUTGOING,
      });
      this.logger.verbose(`Added read messages job: ${job.id}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add read messages job: ${error}`);
      return null;
    }
  }

  public async addOnWhatsAppJob(jid: string): Promise<Job<QueueJobData, QueueJobResult> | null> {
    if (!this.isQueueEnabled()) {
      return null;
    }

    const jobData: OnWhatsAppJobData = {
      type: JobType.ON_WHATSAPP,
      jid,
    };

    const jobId = `on-whatsapp:${jid}`;

    try {
      const existingJob = await this.queue!.getJob(jobId);
      if (existingJob && !(await existingJob.isCompleted()) && !(await existingJob.isFailed())) {
        this.logger.verbose(`Deduplicating onWhatsApp job for: ${jid}`);
        return existingJob;
      }

      const job = await this.queue!.add(JobType.ON_WHATSAPP, jobData, {
        priority: QueuePriority.METADATA,
        jobId,
      });
      this.logger.verbose(`Added onWhatsApp job: ${job.id}`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add onWhatsApp job: ${error}`);
      return null;
    }
  }

  public async addListJoinRequestsJob(groupJid: string): Promise<Job<QueueJobData, QueueJobResult> | null> {
    if (!this.isQueueEnabled()) {
      return null;
    }

    const jobData: ListJoinRequestsJobData = {
      type: JobType.LIST_JOIN_REQUESTS,
      groupJid,
    };

    const delay = this.calculateJitteredDelay(this.conf.MESSAGE_DELAY_MS);

    try {
      const job = await this.queue!.add(JobType.LIST_JOIN_REQUESTS, jobData, {
        priority: QueuePriority.METADATA,
        delay,
      });
      this.logger.verbose(`Added list join requests job: ${job.id} to ${groupJid} (delay: ${delay}ms)`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add list join requests job: ${error}`);
      return null;
    }
  }

  public async addUpdateJoinRequestJob(
    groupJid: string,
    participants: string[],
    action: 'approve' | 'reject',
  ): Promise<Job<QueueJobData, QueueJobResult> | null> {
    if (!this.isQueueEnabled()) {
      return null;
    }

    const jobData: UpdateJoinRequestJobData = {
      type: JobType.UPDATE_JOIN_REQUEST,
      groupJid,
      participants,
      action,
    };

    const delay = this.calculateJitteredDelay(this.conf.MESSAGE_DELAY_MS);

    try {
      const job = await this.queue!.add(JobType.UPDATE_JOIN_REQUEST, jobData, {
        priority: QueuePriority.OUTGOING,
        delay,
      });
      this.logger.verbose(`Added update join request job: ${job.id} to ${groupJid} (delay: ${delay}ms)`);
      return job;
    } catch (error) {
      this.logger.error(`Failed to add update join request job: ${error}`);
      return null;
    }
  }

  public async waitForJob<T extends QueueJobResult>(job: Job<QueueJobData, T>, timeout?: number): Promise<T> {
    const timeoutMs = timeout || this.conf.QUEUE_TIMEOUT_MS;

    try {
      const result = await job.waitUntilFinished(this.queueEvents!, timeoutMs);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Job ${job.id} failed or timed out: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
        retryable: true,
      } as T;
    }
  }

  public async getQueueStats(): Promise<QueueStats | null> {
    if (!this.isQueueEnabled()) {
      return null;
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue!.getWaitingCount(),
        this.queue!.getActiveCount(),
        this.queue!.getCompletedCount(),
        this.queue!.getFailedCount(),
        this.queue!.getDelayedCount(),
      ]);

      return { waiting, active, completed, failed, delayed };
    } catch (error) {
      this.logger.error(`Failed to get queue stats: ${error}`);
      return null;
    }
  }

  public async close(): Promise<void> {
    try {
      if (this.queueEvents) {
        await this.queueEvents.close();
        this.queueEvents = null;
      }
      if (this.queue) {
        await this.queue.close();
        this.queue = null;
      }
      this.logger.verbose('Queue closed');
    } catch (error) {
      this.logger.error(`Failed to close queue: ${error}`);
    }
  }
}
