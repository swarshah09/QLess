import { API_PREFIX } from '../config/constants';

/**
 * OpenAPI 3.0 description of the public API.
 *
 * Hand-written rather than generated: the Zod schemas describe request
 * validation, but the response envelope, error codes and the semantics that
 * matter (conservative thresholds, UNKNOWN handling, nearest-first ordering)
 * are contract details a generator would not capture.
 */

const bearerAuth = [{ bearerAuth: [] }];

const errorResponse = {
  description: 'Error',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ApiError' },
    },
  },
};

function ok(schemaRef: string, description = 'Success') {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: { $ref: schemaRef },
          },
        },
      },
    },
  };
}

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'QLess CNG Platform API',
    version: '1.0.0',
    description: [
      'Backend for the QLess CNG queue platform.',
      '',
      '**Conventions**',
      '- Every response is `{ success: true, data }` or `{ success: false, error }`.',
      '- `error.code` values are stable and safe to branch on.',
      '- An unknown queue is `null`/`null`, never `0`.',
      '- Station lists are ordered NEAREST FIRST by default.',
      '- Notification thresholds are conservative: a queue range of 4-7 does not',
      '  satisfy "at most 5", because the range does not guarantee it.',
    ].join('\n'),
  },
  servers: [{ url: API_PREFIX, description: 'API v1' }],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Stations', description: 'Discovery — guest accessible' },
    { name: 'Reports', description: 'Crowd reporting by any authenticated user' },
    { name: 'Visits', description: '"I\'m Here" check-ins' },
    { name: 'Saved' },
    { name: 'Notifications' },
    { name: 'Operator', description: 'Requires an active station assignment' },
    { name: 'Admin' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: {
                type: 'string',
                enum: [
                  'VALIDATION_ERROR',
                  'BAD_REQUEST',
                  'UNAUTHORIZED',
                  'FORBIDDEN',
                  'NOT_FOUND',
                  'CONFLICT',
                  'RATE_LIMITED',
                  'REPORT_COOLDOWN',
                  'DUPLICATE_REPORT',
                  'PAYLOAD_TOO_LARGE',
                  'DATABASE_ERROR',
                  'INTERNAL_ERROR',
                  'SERVICE_UNAVAILABLE',
                ],
              },
              message: { type: 'string' },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { field: { type: 'string' }, message: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      StationStatus: {
        type: 'object',
        properties: {
          availability: {
            type: 'string',
            enum: [
              'AVAILABLE',
              'LOW_SUPPLY',
              'TEMPORARILY_INTERRUPTED',
              'UNAVAILABLE',
              'UNKNOWN',
            ],
          },
          queue: {
            type: 'object',
            description: 'Both bounds null means UNKNOWN — never interpret as zero.',
            properties: {
              min: { type: 'integer', nullable: true },
              max: { type: 'integer', nullable: true },
              bucket: { type: 'string' },
              label: { type: 'string', example: '4-7' },
            },
          },
          wait: {
            type: 'object',
            properties: {
              min: { type: 'integer', nullable: true },
              max: { type: 'integer', nullable: true },
            },
          },
          pressure: {
            type: 'object',
            properties: {
              value: { type: 'number', nullable: true },
              unit: { type: 'string', enum: ['BAR', 'PSI', 'KPA'] },
              status: { type: 'string', enum: ['NORMAL', 'LOW', 'CRITICAL', 'UNKNOWN'] },
              thresholds: {
                type: 'object',
                description: 'The station\'s own configured thresholds.',
                properties: {
                  low: { type: 'number', nullable: true },
                  normal: { type: 'number', nullable: true },
                },
              },
            },
          },
          activeDispensers: { type: 'integer', nullable: true },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          freshness: {
            type: 'string',
            enum: ['LIVE', 'RECENT', 'AGING', 'STALE', 'EXPIRED', 'UNKNOWN'],
          },
          computedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Station: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          address: { type: 'string' },
          city: { type: 'string', nullable: true },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          active: { type: 'boolean' },
          numberOfDispensers: { type: 'integer' },
          distanceKm: { type: 'number', nullable: true },
          distanceM: { type: 'integer', nullable: true },
          saved: { type: 'boolean' },
          status: { $ref: '#/components/schemas/StationStatus' },
        },
      },
      StationList: {
        type: 'object',
        properties: {
          stations: { type: 'array', items: { $ref: '#/components/schemas/Station' } },
        },
      },
      Tokens: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          refreshToken: { type: 'string' },
          expiresIn: { type: 'integer', example: 900 },
          tokenType: { type: 'string', example: 'Bearer' },
        },
      },
      AuthResult: {
        type: 'object',
        properties: {
          user: { type: 'object' },
          tokens: { $ref: '#/components/schemas/Tokens' },
        },
      },
      Recommendation: {
        type: 'object',
        properties: {
          recommendedStationId: { type: 'string', nullable: true },
          nearestStationId: { type: 'string', nullable: true },
          differsFromNearest: { type: 'boolean' },
          savingMinutes: { type: 'integer', nullable: true },
          reason: { type: 'string', nullable: true },
          alternatives: { type: 'array', items: { type: 'object' } },
        },
      },
      Empty: { type: 'object' },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Liveness',
        responses: { 200: ok('#/components/schemas/Empty') },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account (always role USER)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  phone: { type: 'string' },
                  password: { type: 'string', minLength: 10 },
                },
              },
            },
          },
        },
        responses: { 201: ok('#/components/schemas/AuthResult'), 409: errorResponse },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Email + password login',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: ok('#/components/schemas/AuthResult'), 401: errorResponse },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token',
        description:
          'Unauthenticated by design — it must work once the access token has expired. Reusing a consumed token revokes the whole session family.',
        responses: { 200: ok('#/components/schemas/AuthResult'), 401: errorResponse },
      },
    },
    '/auth/logout': {
      post: { tags: ['Auth'], summary: 'Revoke the current session', responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current profile',
        security: bearerAuth,
        responses: { 200: ok('#/components/schemas/Empty'), 401: errorResponse },
      },
    },
    '/stations/nearby': {
      get: {
        tags: ['Stations'],
        summary: 'Nearby stations, NEAREST FIRST by default',
        parameters: [
          { name: 'latitude', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'longitude', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'radius', in: 'query', schema: { type: 'integer', default: 5000 } },
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string', enum: ['distance', 'wait', 'queue', 'recent'], default: 'distance' },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'availability', in: 'query', schema: { type: 'string' }, description: 'Comma-separated' },
          { name: 'maxQueue', in: 'query', schema: { type: 'integer' } },
          { name: 'maxWait', in: 'query', schema: { type: 'integer' } },
          { name: 'minPressure', in: 'query', schema: { type: 'number' } },
        ],
        responses: { 200: ok('#/components/schemas/StationList'), 422: errorResponse },
      },
    },
    '/stations/recommendations': {
      get: {
        tags: ['Stations'],
        summary: 'Nearest-first list plus a separate recommendation',
        description:
          'The station list is ordered identically to /stations/nearby. The recommendation is metadata, never a reordering.',
        parameters: [
          { name: 'latitude', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'longitude', in: 'query', required: true, schema: { type: 'number' } },
          { name: 'radius', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: ok('#/components/schemas/Empty') },
      },
    },
    '/stations/{stationId}': {
      get: {
        tags: ['Stations'],
        summary: 'Station detail (guest accessible)',
        parameters: [
          { name: 'stationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'latitude', in: 'query', schema: { type: 'number' } },
          { name: 'longitude', in: 'query', schema: { type: 'number' } },
        ],
        responses: { 200: ok('#/components/schemas/Empty'), 404: errorResponse },
      },
    },
    '/stations/{stationId}/reports': {
      post: {
        tags: ['Reports'],
        summary: 'Submit a crowd report (any authenticated USER)',
        description:
          'No operator assignment needed. All fields optional — partial reporting is normal. queueRange "UNKNOWN" is stored as null bounds, never zero. Location verification is computed server-side; a client-supplied locationVerified is rejected.',
        security: bearerAuth,
        parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  queueRange: { type: 'string', enum: ['0-3', '4-7', '8-15', '16-25', '25+', 'UNKNOWN'] },
                  availability: { type: 'string' },
                  pressureValue: { type: 'number' },
                  pressureUnit: { type: 'string', enum: ['BAR', 'PSI', 'KPA'] },
                  latitude: { type: 'number' },
                  longitude: { type: 'number' },
                },
              },
            },
          },
        },
        responses: {
          201: ok('#/components/schemas/Empty'),
          409: { ...errorResponse, description: 'DUPLICATE_REPORT' },
          422: errorResponse,
          429: { ...errorResponse, description: 'REPORT_COOLDOWN' },
        },
      },
      get: {
        tags: ['Reports'],
        summary: 'Raw append-only report history',
        parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok('#/components/schemas/Empty') },
      },
    },
    '/stations/{stationId}/visits': {
      post: {
        tags: ['Visits'],
        summary: '"I\'m Here" — proximity verified server-side',
        security: bearerAuth,
        parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['latitude', 'longitude'],
                properties: { latitude: { type: 'number' }, longitude: { type: 'number' } },
              },
            },
          },
        },
        responses: { 201: ok('#/components/schemas/Empty'), 422: { ...errorResponse, description: 'Too far from the station' } },
      },
    },
    '/stations/{stationId}/visits/{visitId}/complete': {
      patch: {
        tags: ['Visits'],
        summary: 'End a visit',
        description:
          'Ending a visit does NOT imply a successful refuel. outcome defaults to UNKNOWN and must be stated explicitly.',
        security: bearerAuth,
        parameters: [
          { name: 'stationId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'visitId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  outcome: {
                    type: 'string',
                    enum: ['UNKNOWN', 'REFUELLED', 'ABANDONED_QUEUE', 'STATION_UNAVAILABLE'],
                  },
                },
              },
            },
          },
        },
        responses: { 200: ok('#/components/schemas/Empty') },
      },
    },
    '/stations/saved': {
      get: { tags: ['Saved'], summary: 'Saved stations', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/stations/{stationId}/save': {
      post: { tags: ['Saved'], summary: 'Save a station', security: bearerAuth, parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: ok('#/components/schemas/Empty') } },
      delete: { tags: ['Saved'], summary: 'Unsave a station', security: bearerAuth, parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/notifications/rules': {
      get: { tags: ['Notifications'], summary: 'List alert rules', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
      post: {
        tags: ['Notifications'],
        summary: 'Create an alert rule',
        description:
          'Conditions combine with AND and use conservative semantics: maxQueue 5 does NOT match a station reading 4-7.',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['stationId'],
                properties: {
                  stationId: { type: 'string', format: 'uuid' },
                  requiredAvailability: { type: 'array', items: { type: 'string' } },
                  maxQueue: { type: 'integer', nullable: true },
                  maxWaitMinutes: { type: 'integer', nullable: true },
                  minPressure: { type: 'number', nullable: true },
                  enabled: { type: 'boolean' },
                  cooldownMinutes: { type: 'integer', default: 30 },
                },
              },
            },
          },
        },
        responses: { 201: ok('#/components/schemas/Empty'), 400: errorResponse, 409: errorResponse },
      },
    },
    '/notifications/rules/{id}': {
      patch: { tags: ['Notifications'], summary: 'Update a rule', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('#/components/schemas/Empty'), 404: errorResponse } },
      delete: { tags: ['Notifications'], summary: 'Delete a rule', security: bearerAuth, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/notifications/vapid-public-key': {
      get: { tags: ['Notifications'], summary: 'VAPID public key (public)', responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/notifications/subscriptions': {
      get: { tags: ['Notifications'], summary: 'List registered devices', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
      post: {
        tags: ['Notifications'],
        summary: 'Register a browser push subscription',
        security: bearerAuth,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['endpoint', 'keys'],
                properties: {
                  endpoint: { type: 'string', format: 'uri' },
                  keys: {
                    type: 'object',
                    required: ['p256dh', 'auth'],
                    properties: { p256dh: { type: 'string' }, auth: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        responses: { 201: ok('#/components/schemas/Empty') },
      },
      delete: { tags: ['Notifications'], summary: 'Remove a device', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/stations/{stationId}/operator-update': {
      post: {
        tags: ['Operator'],
        summary: 'Operator status update for an ASSIGNED station',
        description:
          'Creates append-only report rows tagged OPERATOR, then recomputes status. 403 for an unassigned station.',
        security: bearerAuth,
        parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 201: ok('#/components/schemas/Empty'), 403: errorResponse },
      },
    },
    '/stations/{stationId}/supply-events': {
      post: {
        tags: ['Operator'],
        summary: 'Record a supply event',
        security: bearerAuth,
        parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type'],
                properties: {
                  type: {
                    type: 'string',
                    enum: ['SUPPLY_ARRIVED', 'LOW_SUPPLY', 'CNG_FINISHED', 'TEMPORARY_INTERRUPTION', 'SUPPLY_RESTORED', 'MAINTENANCE_START', 'MAINTENANCE_END', 'STATION_CLOSED', 'STATION_REOPENED'],
                  },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 201: ok('#/components/schemas/Empty'), 403: errorResponse },
      },
    },
    '/admin/stations': {
      get: { tags: ['Admin'], summary: 'List stations', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty'), 403: errorResponse } },
      post: { tags: ['Admin'], summary: 'Create a station', security: bearerAuth, responses: { 201: ok('#/components/schemas/Empty') } },
    },
    '/admin/stations/{stationId}': {
      patch: { tags: ['Admin'], summary: 'Update a station', security: bearerAuth, parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/admin/stations/{stationId}/active': {
      patch: {
        tags: ['Admin'],
        summary: 'Enable/disable a station (reason required)',
        description: 'Stations are never deleted — that would orphan historical reports.',
        security: bearerAuth,
        parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['active', 'reason'],
                properties: { active: { type: 'boolean' }, reason: { type: 'string', minLength: 5 } },
              },
            },
          },
        },
        responses: { 200: ok('#/components/schemas/Empty') },
      },
    },
    '/admin/stations/{stationId}/override': {
      post: {
        tags: ['Admin'],
        summary: 'Manual status override (audited)',
        description:
          'Requires admin identity, a reason and is timestamped. Writes ADMIN-sourced report rows rather than mutating history.',
        security: bearerAuth,
        parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reason'],
                properties: {
                  availability: { type: 'string' },
                  queueMin: { type: 'integer', nullable: true },
                  queueMax: { type: 'integer', nullable: true },
                  pressureValue: { type: 'number', nullable: true },
                  activeDispensers: { type: 'integer' },
                  reason: { type: 'string', minLength: 5 },
                },
              },
            },
          },
        },
        responses: { 200: ok('#/components/schemas/Empty'), 400: errorResponse },
      },
    },
    '/admin/users': {
      get: { tags: ['Admin'], summary: 'List users', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/admin/stations/{stationId}/operators': {
      get: { tags: ['Admin'], summary: 'List station operators', security: bearerAuth, parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('#/components/schemas/Empty') } },
      post: { tags: ['Admin'], summary: 'Assign an operator', security: bearerAuth, parameters: [{ name: 'stationId', in: 'path', required: true, schema: { type: 'string' } }], responses: { 201: ok('#/components/schemas/Empty') } },
    },
    '/admin/reports/suspicious': {
      get: { tags: ['Admin'], summary: 'Suspicious reports for review (read-only)', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/admin/stats/reports': {
      get: { tags: ['Admin'], summary: 'Report statistics', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/admin/stats/notifications': {
      get: { tags: ['Admin'], summary: 'Notification delivery statistics', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/admin/settings': {
      get: { tags: ['Admin'], summary: 'Effective platform configuration', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
    },
    '/admin/audit-logs': {
      get: { tags: ['Admin'], summary: 'Audit trail', security: bearerAuth, responses: { 200: ok('#/components/schemas/Empty') } },
    },
  },
} as const;
