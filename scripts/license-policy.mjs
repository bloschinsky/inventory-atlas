const allowed =
  /^(?:MIT|MIT-0|ISC|0BSD|Apache-2\.0|BSD-(?:2|3)-Clause|BlueOak-1\.0\.0|CC0-1\.0|Python-2\.0|MPL-2\.0|Unlicense)$/u;

// Owner approval: docs/project/dependency-remediation.md. No blanket EPL allowlist.
export function isLicenseApproved({ name, version, license }, production = false) {
  return (
    (typeof license === 'string' &&
      license.split(/\s+(?:AND|and)\s+/u).every((part) => allowed.test(part))) ||
    (!production && name === 'elkjs' && version === '0.11.1' && license === 'EPL-2.0')
  );
}
