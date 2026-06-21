import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

const DEFAULT_SERVICE_NAME = 'interview-bff';
const DEFAULT_ENVIRONMENT = 'local';

type TelemetryGlobal = typeof globalThis & {
  __interviewBffTelemetrySdk?: NodeSDK;
  __interviewBffTelemetryShutdownHookRegistered?: boolean;
};

function isSdkDisabled(): boolean {
  return process.env.OTEL_SDK_DISABLED?.toLowerCase() === 'true';
}

function parseResourceAttributes(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  return value.split(',').reduce<Record<string, string>>((attributes, entry) => {
    const [rawKey, ...rawValueParts] = entry.split('=');
    const key = rawKey?.trim();
    const attributeValue = rawValueParts.join('=').trim();

    if (key && attributeValue) {
      attributes[key] = attributeValue;
    }

    return attributes;
  }, {});
}

function buildResourceAttributes(): Record<string, string> {
  const environmentAttributes = parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES);
  const serviceName = process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME;
  const deploymentEnvironment =
    environmentAttributes['deployment.environment'] ||
    process.env.APP_ENV ||
    process.env.NODE_ENV ||
    DEFAULT_ENVIRONMENT;
  const serviceVersion = process.env.npm_package_version;

  return {
    'service.name': serviceName,
    'deployment.environment': deploymentEnvironment,
    ...(serviceVersion ? { 'service.version': serviceVersion } : {}),
    ...environmentAttributes,
  };
}

function startTelemetry(): NodeSDK | undefined {
  if (isSdkDisabled()) {
    return undefined;
  }

  const telemetryGlobal = globalThis as TelemetryGlobal;
  if (telemetryGlobal.__interviewBffTelemetrySdk) {
    return telemetryGlobal.__interviewBffTelemetrySdk;
  }

  const sdk = new NodeSDK({
    resource: resourceFromAttributes(buildResourceAttributes()),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-undici': {
          enabled: true,
        },
      }),
    ],
  });

  sdk.start();
  telemetryGlobal.__interviewBffTelemetrySdk = sdk;

  if (!telemetryGlobal.__interviewBffTelemetryShutdownHookRegistered) {
    const shutdown = async () => {
      try {
        await sdk.shutdown();
      } catch (error) {
        console.error('OpenTelemetry shutdown failed', error);
      }
    };

    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    telemetryGlobal.__interviewBffTelemetryShutdownHookRegistered = true;
  }

  return sdk;
}

export const telemetrySdk = startTelemetry();
