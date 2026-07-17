import { z } from 'zod';

const optionalValue = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );

const secretSchema = z.string().trim().min(24, 'must contain at least 24 characters');
const urlSchema = z.url();
const identifierSchema = z.string().trim().min(1).max(256);
const e164PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'must be an E.164 phone number');
const httpsUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'https:') context.addIssue({ code: 'custom', message: 'must use HTTPS' });
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    context.addIssue({
      code: 'custom',
      message: 'must not contain credentials, query, or fragment',
    });
  }
});
const isoDateTimeSchema = z.string().datetime({ offset: true });
const csvSchema = z
  .string()
  .trim()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.string().min(1)).min(1));

const rawConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    SERVICE_ROLE: z
      .enum([
        'arena',
        'outbound-sourcer',
        'white-verifier',
        'hiring-controller',
        'recruiting-mcp',
        'log-bridge',
      ])
      .default('arena'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    DEMO_MODE: z.enum(['fake', 'recorded', 'hybrid', 'live']).default('fake'),
    DEMO_STEP_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(600),
    LOOP_MEMORY_DIRECTORY: z.string().trim().min(1).default('.loop-memory'),
    LOOP_READINESS_THRESHOLD: z.coerce.number().min(0).max(100).default(75),
    LOOP_MIN_HOSTILE_EVALUATIONS: z.coerce.number().int().min(1).max(100).default(4),
    LOOP_MIN_LEGITIMATE_CONTROLS: z.coerce.number().int().min(1).max(100).default(3),
    LOOP_MAX_EPISODES: z.coerce.number().int().min(1).max(20).default(8),
    LOOP_STAGNATION_EPISODES: z.coerce.number().int().min(1).max(10).default(3),
    LOOP_MAX_ZERO_SPEND_USD: z.coerce.number().positive().max(100).default(1),
    ELEVENLABS_LOOP_CLOSURE_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    ELEVENLABS_API_KEY: optionalValue(secretSchema),
    ELEVENLABS_AGENT_ID: optionalValue(identifierSchema),
    ELEVENLABS_PHONE_NUMBER_ID: optionalValue(identifierSchema),
    ELEVENLABS_TO_NUMBER: optionalValue(e164PhoneSchema),
    ELEVENLABS_WEBHOOK_SECRET: optionalValue(secretSchema),
    ZERO_MODE: z.enum(['fake', 'live']).default('fake'),
    ZERO_RUNNER: z.string().trim().min(1).default('zero'),
    ZERO_TIMEOUT_MS: z.coerce.number().int().min(1).max(60_000).default(30_000),
    ZERO_ALLOWED_CAPABILITY_REFS: optionalValue(csvSchema),
    ZERO_ALLOWED_TARGET_DOMAINS: optionalValue(csvSchema),
    ZERO_TARGET_BASE_URL: optionalValue(httpsUrlSchema),
    ZERO_MAX_PER_CALL_USD: z.coerce.number().positive().max(100).default(0.05),
    RECRUITING_OPS_MODE: z.enum(['fake', 'http']).default('fake'),
    OUTBOUND_RECRUITING_BASE_URL: optionalValue(httpsUrlSchema),
    OUTBOUND_RECRUITING_BEARER_TOKEN: optionalValue(secretSchema),
    OUTBOUND_RECRUITING_TIMEOUT_MS: z.coerce.number().int().min(1).max(60_000).default(10_000),
    CALENDAR_MODE: z.enum(['memory', 'google']).default('memory'),
    GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN: optionalValue(secretSchema),
    GOOGLE_CALENDAR_SANDBOX_ID: optionalValue(z.string().trim().min(1).max(1_024)),
    GOOGLE_CALENDAR_TIMEOUT_MS: z.coerce.number().int().min(1).max(60_000).default(10_000),
    SANDBOX_CALENDAR_ATTENDEE_EMAIL: optionalValue(z.email()),
    SANDBOX_SCREEN_START_AT: optionalValue(isoDateTimeSchema),
    SANDBOX_SCREEN_END_AT: optionalValue(isoDateTimeSchema),
    SANDBOX_SCREEN_TITLE: z.string().trim().min(1).max(120).default('[HACKATHON TEST] Screening'),
    SANDBOX_SCREEN_DESCRIPTION: z
      .string()
      .trim()
      .min(1)
      .max(2_000)
      .default('Evidence-backed screening event in the team-controlled sandbox calendar.'),
    INTERNAL_AGENT_TOKEN: optionalValue(secretSchema),
    LOG_BRIDGE_TOKEN: optionalValue(secretSchema),
    ARENA_INTERNAL_URL: urlSchema.default('http://arena:8080'),
    RECRUITING_MCP_INTERNAL_URL: urlSchema.default('http://recruiting-mcp:8084/mcp'),
    SOURCER_MCP_URL: optionalValue(urlSchema),
    VERIFIER_MCP_URL: optionalValue(urlSchema),
    CONTROLLER_MCP_URL: optionalValue(urlSchema),
    SOURCER_POMERIUM_JWT: optionalValue(secretSchema),
    VERIFIER_POMERIUM_JWT: optionalValue(secretSchema),
    CONTROLLER_POMERIUM_JWT: optionalValue(secretSchema),
    POMERIUM_JWKS_URL: optionalValue(urlSchema),
    POMERIUM_ISSUER: optionalValue(z.string().trim().min(1)),
    POMERIUM_AUDIENCE: optionalValue(z.string().trim().min(1)),
    POMERIUM_SOURCER_SUBJECT: optionalValue(z.string().trim().min(1)),
    POMERIUM_CONTROLLER_SUBJECT: optionalValue(z.string().trim().min(1)),
  })
  .superRefine((config, context) => {
    const requireField = (field: keyof typeof config): void => {
      if (config[field] === undefined) {
        context.addIssue({
          code: 'custom',
          message: `${field} is required for ${config.SERVICE_ROLE}`,
          path: [field],
        });
      }
    };
    if (config.ZERO_MODE === 'live') {
      requireField('ZERO_ALLOWED_CAPABILITY_REFS');
      requireField('ZERO_ALLOWED_TARGET_DOMAINS');
      requireField('ZERO_TARGET_BASE_URL');
      if (config.ZERO_MAX_PER_CALL_USD > config.LOOP_MAX_ZERO_SPEND_USD) {
        context.addIssue({
          code: 'custom',
          message: 'ZERO_MAX_PER_CALL_USD must not exceed LOOP_MAX_ZERO_SPEND_USD',
          path: ['ZERO_MAX_PER_CALL_USD'],
        });
      }
      if (
        config.ZERO_TARGET_BASE_URL !== undefined &&
        config.ZERO_ALLOWED_TARGET_DOMAINS !== undefined
      ) {
        const hostname = new URL(config.ZERO_TARGET_BASE_URL).hostname.toLowerCase();
        if (
          !config.ZERO_ALLOWED_TARGET_DOMAINS.some((domain) => {
            const normalizedDomain = domain.toLowerCase();
            return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
          })
        ) {
          context.addIssue({
            code: 'custom',
            message: 'ZERO_TARGET_BASE_URL host must be in ZERO_ALLOWED_TARGET_DOMAINS',
            path: ['ZERO_TARGET_BASE_URL'],
          });
        }
      }
    }
    if (config.RECRUITING_OPS_MODE === 'http') {
      requireField('OUTBOUND_RECRUITING_BASE_URL');
      requireField('OUTBOUND_RECRUITING_BEARER_TOKEN');
    }
    if (config.CALENDAR_MODE === 'google') {
      requireField('GOOGLE_CALENDAR_OAUTH_ACCESS_TOKEN');
      requireField('GOOGLE_CALENDAR_SANDBOX_ID');
      requireField('SANDBOX_CALENDAR_ATTENDEE_EMAIL');
      requireField('SANDBOX_SCREEN_START_AT');
      requireField('SANDBOX_SCREEN_END_AT');
      if (
        config.SANDBOX_SCREEN_START_AT !== undefined &&
        config.SANDBOX_SCREEN_END_AT !== undefined &&
        Date.parse(config.SANDBOX_SCREEN_END_AT) <= Date.parse(config.SANDBOX_SCREEN_START_AT)
      ) {
        context.addIssue({
          code: 'custom',
          message: 'SANDBOX_SCREEN_END_AT must be after SANDBOX_SCREEN_START_AT',
          path: ['SANDBOX_SCREEN_END_AT'],
        });
      }
    }

    switch (config.SERVICE_ROLE) {
      case 'arena':
        if (config.DEMO_MODE === 'hybrid' || config.DEMO_MODE === 'live') {
          requireField('INTERNAL_AGENT_TOKEN');
          requireField('SOURCER_MCP_URL');
          requireField('CONTROLLER_MCP_URL');
          requireField('SOURCER_POMERIUM_JWT');
          requireField('CONTROLLER_POMERIUM_JWT');
          requireField('POMERIUM_JWKS_URL');
          requireField('POMERIUM_ISSUER');
          requireField('POMERIUM_AUDIENCE');
          requireField('POMERIUM_SOURCER_SUBJECT');
          requireField('POMERIUM_CONTROLLER_SUBJECT');
        }
        if (config.DEMO_MODE === 'live') {
          if (config.ZERO_MODE !== 'live') {
            context.addIssue({
              code: 'custom',
              message: 'ZERO_MODE must be live for DEMO_MODE=live',
              path: ['ZERO_MODE'],
            });
          }
          if (config.RECRUITING_OPS_MODE !== 'http') {
            context.addIssue({
              code: 'custom',
              message: 'RECRUITING_OPS_MODE must be http for DEMO_MODE=live',
              path: ['RECRUITING_OPS_MODE'],
            });
          }
          if (config.CALENDAR_MODE !== 'google') {
            context.addIssue({
              code: 'custom',
              message: 'CALENDAR_MODE must be google for DEMO_MODE=live',
              path: ['CALENDAR_MODE'],
            });
          }
        }
        break;
      case 'outbound-sourcer':
        requireField('INTERNAL_AGENT_TOKEN');
        requireField('SOURCER_MCP_URL');
        requireField('SOURCER_POMERIUM_JWT');
        break;
      case 'white-verifier':
        requireField('INTERNAL_AGENT_TOKEN');
        requireField('VERIFIER_MCP_URL');
        requireField('VERIFIER_POMERIUM_JWT');
        break;
      case 'hiring-controller':
        requireField('INTERNAL_AGENT_TOKEN');
        requireField('CONTROLLER_MCP_URL');
        requireField('CONTROLLER_POMERIUM_JWT');
        break;
      case 'recruiting-mcp':
        requireField('INTERNAL_AGENT_TOKEN');
        break;
      case 'log-bridge':
        requireField('LOG_BRIDGE_TOKEN');
        break;
    }

    if (config.ELEVENLABS_LOOP_CLOSURE_ENABLED) {
      requireField('INTERNAL_AGENT_TOKEN');
      requireField('ELEVENLABS_API_KEY');
      requireField('ELEVENLABS_AGENT_ID');
      requireField('ELEVENLABS_PHONE_NUMBER_ID');
      requireField('ELEVENLABS_TO_NUMBER');
      requireField('ELEVENLABS_WEBHOOK_SECRET');
    }
  });

export type AppConfig = z.infer<typeof rawConfigSchema>;

export function readConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return rawConfigSchema.parse(env);
}
