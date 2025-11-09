/**
 * Configuration validation utilities
 */

/**
 * Validate storage/memory size string format
 *
 * @param sizeStr - Size string to validate
 * @param fieldName - Field name for error messages
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * validateSizeFormat('5Gi', 'storage.admin.size')      // OK
 * validateSizeFormat('512Mi', 'resources.memory')      // OK
 * validateSizeFormat('invalid', 'storage.size')        // Throws error
 * validateSizeFormat('5', 'storage.size')              // Throws error (no unit)
 * ```
 */
export function validateSizeFormat(sizeStr: string, fieldName: string): void {
  const sizePattern = /^\d+(?:Mi|Gi)$/;
  if (!sizePattern.test(sizeStr)) {
    throw new Error(
      `Invalid size format for ${fieldName}: "${sizeStr}". ` +
      'Expected format: number + unit (e.g., "5Gi", "512Mi")',
    );
  }
}

/**
 * Validate CPU string format
 *
 * @param cpuStr - CPU string to validate
 * @param fieldName - Field name for error messages
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * validateCpuFormat('100m', 'resources.cpu')    // OK
 * validateCpuFormat('1000m', 'resources.cpu')   // OK
 * validateCpuFormat('1000', 'resources.cpu')    // Throws error (no 'm' suffix)
 * validateCpuFormat('abc', 'resources.cpu')     // Throws error
 * ```
 */
export function validateCpuFormat(cpuStr: string, fieldName: string): void {
  const cpuPattern = /^\d+m$/;
  if (!cpuPattern.test(cpuStr)) {
    throw new Error(
      `Invalid CPU format for ${fieldName}: "${cpuStr}". ` +
      'Expected format: number + \'m\' (e.g., "100m", "500m")',
    );
  }
}

/**
 * Validate domain name format
 *
 * @param domain - Domain name to validate
 * @param fieldName - Field name for error messages
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * validateDomainFormat('example.com', 'domain')           // OK
 * validateDomainFormat('mail.example.com', 'hostname')    // OK
 * validateDomainFormat('invalid domain', 'domain')        // Throws error
 * validateDomainFormat('example', 'domain')               // Throws error (no TLD)
 * ```
 */
export function validateDomainFormat(domain: string, fieldName: string): void {
  // RFC 1035 compliant domain name pattern
  // - Labels separated by dots
  // - Each label: 1-63 chars, alphanumeric + hyphens, cannot start/end with hyphen
  // - TLD: at least 2 chars, letters only
  const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

  if (!domainPattern.test(domain)) {
    throw new Error(
      `Invalid domain format for ${fieldName}: "${domain}". ` +
      'Expected format: valid DNS name (e.g., "example.com", "mail.example.com")',
    );
  }
}

/**
 * Validate CIDR subnet format
 *
 * @param cidr - CIDR notation to validate
 * @param fieldName - Field name for error messages
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * validateCidrFormat('10.42.0.0/16', 'subnet')        // OK
 * validateCidrFormat('192.168.1.0/24', 'subnet')      // OK
 * validateCidrFormat('10.42.0.0', 'subnet')           // Throws error (no prefix)
 * validateCidrFormat('256.0.0.0/8', 'subnet')         // Throws error (invalid IP)
 * validateCidrFormat('10.42.0.0/33', 'subnet')        // Throws error (invalid prefix)
 * ```
 */
export function validateCidrFormat(cidr: string, fieldName: string): void {
  // IPv4 CIDR pattern: a.b.c.d/prefix
  // - Each octet: 0-255
  // - Prefix: 0-32
  const cidrPattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\/(?:[0-9]|[12][0-9]|3[0-2])$/;

  if (!cidrPattern.test(cidr)) {
    throw new Error(
      `Invalid CIDR format for ${fieldName}: "${cidr}". ` +
      'Expected format: IPv4 CIDR notation (e.g., "10.42.0.0/16", "192.168.0.0/24")',
    );
  }
}

/**
 * Validate email address format
 *
 * @param email - Email address to validate
 * @param fieldName - Field name for error messages
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * validateEmailFormat('admin@example.com', 'initialAccount.email')  // OK
 * validateEmailFormat('invalid', 'email')                           // Throws error
 * ```
 */
export function validateEmailFormat(email: string, fieldName: string): void {
  // Basic email pattern (not RFC 5322 compliant, but good enough for validation)
  const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

  if (!emailPattern.test(email)) {
    throw new Error(
      `Invalid email format for ${fieldName}: "${email}". ` +
      'Expected format: valid email address (e.g., "admin@example.com")',
    );
  }
}
