import { AnyMessageContent, MiscMessageGenerationOptions, WAMessage, WAPresence } from 'baileys';

export enum QueuePriority {
  CRITICAL = 1,
  REPLY = 2,
  OUTGOING = 3,
  PRESENCE = 4,
  METADATA = 5,
}

export enum JobType {
  SEND_MESSAGE = 'SEND_MESSAGE',
  SEND_PRESENCE_UPDATE = 'SEND_PRESENCE_UPDATE',
  GROUP_METADATA = 'GROUP_METADATA',
  READ_MESSAGES = 'READ_MESSAGES',
  ON_WHATSAPP = 'ON_WHATSAPP',
  LIST_JOIN_REQUESTS = 'LIST_JOIN_REQUESTS',
  UPDATE_JOIN_REQUEST = 'UPDATE_JOIN_REQUEST',
}

export interface SendMessageJobData {
  type: JobType.SEND_MESSAGE;
  sender: string;
  message: AnyMessageContent;
  options?: MiscMessageGenerationOptions;
  isReply?: boolean;
}

export interface SendPresenceJobData {
  type: JobType.SEND_PRESENCE_UPDATE;
  presence: WAPresence;
  toJid?: string;
}

export interface GroupMetadataJobData {
  type: JobType.GROUP_METADATA;
  groupJid: string;
}

export interface ReadMessagesJobData {
  type: JobType.READ_MESSAGES;
  keys: { remoteJid: string; id: string; participant?: string }[];
}

export interface OnWhatsAppJobData {
  type: JobType.ON_WHATSAPP;
  jid: string;
}

export interface ListJoinRequestsJobData {
  type: JobType.LIST_JOIN_REQUESTS;
  groupJid: string;
}

export interface UpdateJoinRequestJobData {
  type: JobType.UPDATE_JOIN_REQUEST;
  groupJid: string;
  participants: string[];
  action: 'approve' | 'reject';
}

export type QueueJobData =
  | SendMessageJobData
  | SendPresenceJobData
  | GroupMetadataJobData
  | ReadMessagesJobData
  | OnWhatsAppJobData
  | ListJoinRequestsJobData
  | UpdateJoinRequestJobData;

export interface JobResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  retryable?: boolean;
}

export interface SendMessageJobResult extends JobResult<WAMessage> {}

export interface SendPresenceJobResult extends JobResult<void> {}

export interface GroupMetadataJobResult extends JobResult<unknown> {}

export interface ReadMessagesJobResult extends JobResult<void> {}

export interface OnWhatsAppJobResult extends JobResult<{ exists: boolean; jid: string }[]> {}

export interface ListJoinRequestsJobResult extends JobResult<unknown[]> {}

export interface UpdateJoinRequestJobResult extends JobResult<unknown[]> {}

export type QueueJobResult =
  | SendMessageJobResult
  | SendPresenceJobResult
  | GroupMetadataJobResult
  | ReadMessagesJobResult
  | OnWhatsAppJobResult
  | ListJoinRequestsJobResult
  | UpdateJoinRequestJobResult;

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}
