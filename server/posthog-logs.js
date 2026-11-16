function createPostHogLogger() {
  const projectToken = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  if (!projectToken || !host) return { logger: null, shutdown: async () => {} };

  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { BatchLogRecordProcessor, LoggerProvider } = require('@opentelemetry/sdk-logs');
  const provider = new LoggerProvider({
    resource: resourceFromAttributes({
      'service.name': 'shortlist-api',
      'deployment.environment': process.env.NODE_ENV || 'development',
    }),
    processors: [
      new BatchLogRecordProcessor(new OTLPLogExporter({
        url: new URL('/i/v1/logs', host).toString(),
        headers: { Authorization: `Bearer ${projectToken}` },
      }), {
        scheduledDelayMillis: 1000,
        exportTimeoutMillis: 3000,
      }),
    ],
  });

  let shutdownPromise;
  return {
    logger: provider.getLogger('posthog-shortlist'),
    shutdown: () => {
      shutdownPromise ??= provider.shutdown();
      return shutdownPromise;
    },
  };
}

module.exports = { createPostHogLogger };
