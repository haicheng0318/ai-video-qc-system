import nodeFetch = require('node-fetch');
import { HttpsProxyAgent } from 'https-proxy-agent';

let configuredProxyUrl: string | undefined;

export function configureOutboundProxy(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const proxyUrl = environment.OUTBOUND_PROXY_URL?.trim();

  if (!proxyUrl) {
    return false;
  }

  if (configuredProxyUrl === proxyUrl) {
    return true;
  }

  const parsedUrl = new URL(proxyUrl);
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(
      'OUTBOUND_PROXY_URL must use the http or https protocol.',
    );
  }

  const proxyAgent = new HttpsProxyAgent(parsedUrl);

  globalThis.fetch = ((
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) =>
    nodeFetch(input as any, {
      ...(init as any),
      agent: proxyAgent,
    }) as unknown as Promise<globalThis.Response>) as typeof globalThis.fetch;

  configuredProxyUrl = proxyUrl;
  return true;
}
