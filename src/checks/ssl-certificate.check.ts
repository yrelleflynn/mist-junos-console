import type { Check, CheckContext, CheckResult } from './base';
import type { MistEndpoint } from '../config/mist-clouds.config';

/**
 * Factory function — returns a Check for a specific endpoint.
 * Called per-endpoint from TroubleshootService.checkFirewallPolicy().
 */
export function sslCertificateCheck(endpoint: MistEndpoint): Check {
  return {
    id: `cert-${endpoint.host.replace(/\./g, '-')}`,
    name: `SSL Cert: ${endpoint.host}`,

    async run(ctx: CheckContext): Promise<CheckResult> {
      const id = `cert-${endpoint.host.replace(/\./g, '-')}`;
      const name = `SSL Cert: ${endpoint.host}`;
      const { runner } = ctx;

      // Enter shell mode (Junos drops to csh)
      await runner.send('start shell\n');
      await new Promise((r) => setTimeout(r, 2000));

      // csh doesn't support 2>&1 or > redirect properly.
      // Wrap in /bin/sh -c for proper shell redirects.
      // curl -v outputs cert info to stderr, so redirect stderr to a temp file.
      await runner.execute(
        `/bin/sh -c 'curl -4 -vk --connect-timeout 30 https://${endpoint.host}/ -o /dev/null 2>/tmp/certcheck.txt'`,
        45000,
        3000,
      );

      const catCmd = await runner.execute('cat /tmp/certcheck.txt', 10000, 2000);
      const output = (catCmd.success && catCmd.output.trim().length > 0) ? catCmd.output : '';

      // Clean up
      await runner.execute('rm -f /tmp/certcheck.txt', 5000, 1000);

      // Exit shell back to Junos CLI
      await runner.send('exit\n');
      await new Promise((r) => setTimeout(r, 1000));
      await runner.send('cli\n');
      await new Promise((r) => setTimeout(r, 1500));

      if (!output || output.includes('command not found') || output.includes('No such file')) {
        return { id, name, status: 'warn', detail: 'curl not available on this switch', raw: output };
      }

      if (output.includes('Connection refused')) {
        return { id, name, status: 'skip', detail: 'Connection refused — host not accepting HTTPS', raw: output };
      }

      // Check if we got cert info before any timeout.
      // curl may timeout on SSL handshake but still show partial TLS info.
      const hasIssuer = /issuer\s*[=:]/i.test(output);
      if (hasIssuer) {
        return parseSslCertOutput(id, name, output);
      }

      // SSL connection timeout — connected but TLS handshake didn't complete
      if (output.includes('SSL connection timeout') || output.includes('SSL handshake timeout')) {
        return { id, name, status: 'warn', detail: 'Connected but TLS handshake timed out — unable to inspect certificate', raw: output };
      }

      // General connect timeout — couldn't reach the host at all
      if (output.includes('timed out') || output.includes('connect timeout')) {
        return { id, name, status: 'skip', detail: 'Connection timed out — host unreachable on port 443', raw: output };
      }

      return parseSslCertOutput(id, name, output);
    },
  };
}

function parseSslCertOutput(id: string, name: string, output: string): CheckResult {
  const lines = output.split('\n');

  // curl -v format from Junos:
  //   "*  issuer: C=US; ST=CA; L=Sunnyvale; O=Juniper Networks; OU=Juniper CA; CN=RedirectServiceRSACA"
  //   "*  issuer: C=US; O=Amazon; CN=Amazon RSA 2048 M03"
  // openssl format:
  //   "issuer=C = US, O = Amazon, CN = Amazon RSA 2048 M03"
  const issuerLine = lines.find((l) => /issuer\s*[=:]/i.test(l)) || '';
  const subjectLine = lines.find((l) => /subject\s*[=:]/i.test(l) && !/issuer/i.test(l)) || '';

  if (!issuerLine && !subjectLine) {
    const hasSSL = /ssl|tls|certificate|verify|handshake/i.test(output);
    if (hasSSL) {
      return { id, name, status: 'warn', detail: 'SSL connection made but could not parse certificate issuer — check terminal output', raw: output };
    }
    return { id, name, status: 'warn', detail: 'Could not determine SSL certificate details', raw: output };
  }

  // Parse issuer fields — handle both ; and , separators
  const textToParse = issuerLine || subjectLine;
  const cnMatch = textToParse.match(/CN\s*[=:]\s*([^;,\n]+)/i);
  const oMatch = textToParse.match(/O\s*[=:]\s*([^;,\n]+)/i);

  const issuerCn = cnMatch?.[1]?.trim() || '';
  const issuerO = oMatch?.[1]?.trim() || '';
  const issuerDisplay = issuerCn || issuerO || textToParse.replace(/^[\s*]+(?:issuer|subject)\s*:\s*/i, '').trim();

  if (!issuerDisplay) {
    return { id, name, status: 'warn', detail: 'SSL certificate found but issuer field is empty', raw: output };
  }

  // Expected issuers for Mist cloud endpoints (verified from real switch output):
  // - Juniper Networks (redirect.juniper.net — self-signed Juniper CA)
  // - Mist Systems Inc. (jma-terminator, ztp — Mist internal CA)
  // - DigiCert (cdn.juniper.net — public CA)
  // - Amazon / Starfield (some AWS-hosted endpoints)
  // - Google Trust Services / GTS (GCP-hosted clouds)
  const expectedPatterns = [
    /juniper/i,
    /mist\s*systems/i,
    /mistsys/i,
    /digicert/i,
    /amazon/i,
    /starfield/i,
    /google\s*trust/i,
    /\bGTS\b/,
  ];

  const isExpected = expectedPatterns.some((p) => p.test(issuerLine + ' ' + subjectLine));

  if (isExpected) {
    return { id, name, status: 'pass', detail: `Certificate OK — issued by ${issuerDisplay}`, raw: output };
  }

  // Not an expected issuer — likely SSL inspection
  return {
    id,
    name,
    status: 'fail',
    detail: `POSSIBLE SSL INSPECTION — Certificate issued by "${issuerDisplay}". Expected Juniper, Mist, DigiCert, Amazon, or Google. SSL decryption must be disabled for Mist endpoints.`,
    raw: output,
  };
}
