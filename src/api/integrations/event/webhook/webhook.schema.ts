import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

import { EventController } from '../event.controller';

export const webhookSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    webhook: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        url: { type: 'string' },
        headers: { type: 'object' },
        byEvents: { type: 'boolean' },
        base64: { type: 'boolean' },
        events: {
          type: 'array',
          minItems: 0,
          items: {
            type: 'string',
            enum: EventController.events,
          },
        },
      },
      required: ['enabled'],
      if: {
        properties: { enabled: { const: true } },
      },
      then: {
        required: ['url'],
        properties: {
          url: { minLength: 1, description: 'The "url" cannot be empty when webhook is enabled' },
        },
      },
    },
  },
  required: ['webhook'],
};
