/**
 * TLS settings for the PostgreSQL connection. No imports, so scripts can use it too (node strips the types).
 *
 * Supabase's database and connection pooler present certificates issued by Supabase's own certificate authority,
 * "Supabase Root 2021 CA", which is the same for every Supabase project and is not in the operating system's list.
 * It is public (anyone can download it from the dashboard or read it from the server), so it is built in here and
 * nobody has to configure it. Certificates and host names are always verified.
 *
 * SHA-256 fingerprint 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA,
 * valid until 26 April 2031. Checked against the live poolers in two regions and three independent public copies.
 */
export const SUPABASE_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----
`;

const LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"];

/** True for Supabase's database hosts: the pooler (*.pooler.supabase.com) and direct hosts (db.<ref>.supabase.co). */
export const isSupabaseHost = (host: string) => /(^|\.)supabase\.(com|co)$/i.test(host);

/**
 * TLS for a database host. Local databases (tests, your own machine) use no TLS. Supabase hosts use the built-in
 * Supabase CA. Any other host uses the operating system's certificate list. DATABASE_CA_CERT, when set, replaces
 * the CA (only needed for a database that is neither of these).
 */
export function sslFor(host: string, env: Record<string, string | undefined> = process.env): false | { rejectUnauthorized: true; ca?: string } {
  if (LOCAL.includes(host)) return false;
  const custom = customCa(env);
  if (custom) return { rejectUnauthorized: true, ca: custom };
  if (isSupabaseHost(host)) return { rejectUnauthorized: true, ca: SUPABASE_ROOT_CA };
  return { rejectUnauthorized: true };
}

/**
 * DATABASE_CA_CERT, only when it actually holds a PEM certificate. Anything else (a placeholder, a file name) is
 * ignored, so the built-in Supabase CA is used and certificates are still verified.
 */
export function customCa(env: Record<string, string | undefined> = process.env): string | undefined {
  const v = env.DATABASE_CA_CERT?.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
  return v && /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(v) ? v : undefined;
}

/** The connection string without TLS options (TLS comes from sslFor, so certificates are always verified). */
export function connectionString(raw: string): { url: string; host: string } {
  const u = new URL(raw);
  for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "supa"]) u.searchParams.delete(k);
  return { url: u.toString(), host: u.hostname };
}
