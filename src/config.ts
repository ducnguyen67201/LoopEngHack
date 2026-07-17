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
      .enum(['arena', 'target', 'red-agent', 'white-agent', 'deploy-controller', 'log-bridge'])
      .default('arena'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    DEMO_MODE: z.enum(['live', 'recorded']).default('live'),
    DEMO_STEP_DELAY_MS: z.coerce.number().int().min(0).max(10_000).default(600),
    INTERNAL_AGENT_TOKEN: optionalValue(secretSchema),
    LOG_BRIDGE_TOKEN: optionalValue(secretSchema),
    ARENA_INTERNAL_URL: urlSchema.default('http://arena:8080'),
    TARGET_V1_URL: urlSchema.default('http://target-v1:8081'),
    TARGET_V2_URL: urlSchema.default('http://target-v2:8081'),
    RED_AGENT_URL: urlSchema.default('http://red-agent:8091'),
    WHITE_AGENT_URL: urlSchema.default('http://white-agent:8092'),
    CONTROLLER_AGENT_URL: urlSchema.default('http://deploy-controller:8093'),
    TARGET_VERSION: optionalValue(z.enum(['v1', 'v2'])),
    RED_MCP_URL: optionalValue(urlSchema),
    WHITE_MCP_URL: optionalValue(urlSchema),
    CONTROLLER_MCP_URL: optionalValue(urlSchema),
    RED_POMERIUM_JWT: optionalValue(secretSchema),
    WHITE_POMERIUM_JWT: optionalValue(secretSchema),
    CONTROLLER_POMERIUM_JWT: optionalValue(secretSchema),
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
        requireField('INTERNAL_AGENT_TOKEN');
        requireField('LOG_BRIDGE_TOKEN');
        break;
      case 'target':
        requireField('TARGET_VERSION');
        break;
      case 'red-agent':
        requireField('INTERNAL_AGENT_TOKEN');
        requireField('RED_MCP_URL');
        requireField('RED_POMERIUM_JWT');
        break;
      case 'white-agent':
        requireField('INTERNAL_AGENT_TOKEN');
        requireField('WHITE_MCP_URL');
        requireField('WHITE_POMERIUM_JWT');
        break;
      case 'deploy-controller':
        requireField('INTERNAL_AGENT_TOKEN');
        requireField('CONTROLLER_MCP_URL');
        requireField('CONTROLLER_POMERIUM_JWT');
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
