import { z } from 'zod';

const optionalValue = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );

const secretSchema = z.string().trim().min(24, 'must contain at least 24 characters');
const urlSchema = z.url();

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
  });

export type AppConfig = z.infer<typeof rawConfigSchema>;

export function readConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return rawConfigSchema.parse(env);
}
