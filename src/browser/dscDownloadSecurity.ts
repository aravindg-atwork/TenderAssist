import { readFileSync, renameSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const MAX_JNLP_BYTES = 1024 * 1024;
const DEFAULT_TRUSTED_HOSTS = ['tntenders.gov.in', 'www.tntenders.gov.in'];
const JNLP_NAME = /^signData(?:\s*\(\d+\))?\.jnlp$/i;

export interface DscDownloadCandidate {
  sourceUrl: string;
  suggestedFilename: string;
}

export interface DscJnlpArtifact {
  filePath: string;
  fileName: string;
  sourceHost: string;
  downloadedAt: string;
}

export function isTrustedDscDownload(
  candidate: DscDownloadCandidate,
  trustedHosts: readonly string[] = DEFAULT_TRUSTED_HOSTS,
  trustedPathPrefix = '/nicgep/'
): boolean {
  try {
    const url = new URL(candidate.sourceUrl);
    const hosts = new Set(trustedHosts.map((host) => host.toLocaleLowerCase()));
    return (
      url.protocol === 'https:' &&
      hosts.has(url.hostname.toLocaleLowerCase()) &&
      url.pathname.toLocaleLowerCase().startsWith(trustedPathPrefix.toLocaleLowerCase()) &&
      JNLP_NAME.test(basename(candidate.suggestedFilename))
    );
  } catch {
    return false;
  }
}

export function isValidJnlpFile(filePath: string): boolean {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size === 0 || stats.size > MAX_JNLP_BYTES) return false;
    const contents = readFileSync(filePath, 'utf8').slice(0, 8192);
    return /<jnlp(?:\s|>)/i.test(contents);
  } catch {
    return false;
  }
}

export function finalizeDscDownload(
  guidFilePath: string,
  downloadDirectory: string,
  candidate: DscDownloadCandidate,
  trustedHosts: readonly string[] = DEFAULT_TRUSTED_HOSTS,
  trustedPathPrefix = '/nicgep/'
): DscJnlpArtifact | null {
  if (!isTrustedDscDownload(candidate, trustedHosts, trustedPathPrefix) || !isValidJnlpFile(guidFilePath)) return null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `signData-${timestamp}${extname(candidate.suggestedFilename).toLocaleLowerCase()}`;
  const filePath = join(downloadDirectory, fileName);
  renameSync(guidFilePath, filePath);
  return {
    filePath,
    fileName,
    sourceHost: new URL(candidate.sourceUrl).hostname,
    downloadedAt: new Date().toISOString(),
  };
}
