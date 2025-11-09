import {
  validateSizeFormat,
  validateCpuFormat,
  validateDomainFormat,
  validateCidrFormat,
  validateEmailFormat,
} from '../src/utils/validators';

describe('validateSizeFormat', () => {
  it('accepts valid Gi format', () => {
    expect(() => validateSizeFormat('5Gi', 'storage')).not.toThrow();
    expect(() => validateSizeFormat('100Gi', 'storage')).not.toThrow();
    expect(() => validateSizeFormat('1Gi', 'storage')).not.toThrow();
  });

  it('accepts valid Mi format', () => {
    expect(() => validateSizeFormat('512Mi', 'memory')).not.toThrow();
    expect(() => validateSizeFormat('1024Mi', 'memory')).not.toThrow();
    expect(() => validateSizeFormat('256Mi', 'memory')).not.toThrow();
  });

  it('rejects size without unit', () => {
    expect(() => validateSizeFormat('500', 'storage')).toThrow(
      'Invalid size format for storage: "500". Expected format: number + unit (e.g., "5Gi", "512Mi")',
    );
  });

  it('rejects size with invalid unit', () => {
    expect(() => validateSizeFormat('5GB', 'storage')).toThrow(
      'Invalid size format for storage: "5GB". Expected format: number + unit (e.g., "5Gi", "512Mi")',
    );
    expect(() => validateSizeFormat('512MB', 'memory')).toThrow();
  });

  it('rejects size with decimal values', () => {
    expect(() => validateSizeFormat('5.5Gi', 'storage')).toThrow();
    expect(() => validateSizeFormat('512.25Mi', 'memory')).toThrow();
  });

  it('rejects size with spaces', () => {
    expect(() => validateSizeFormat('5 Gi', 'storage')).toThrow();
    expect(() => validateSizeFormat('512 Mi', 'memory')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateSizeFormat('', 'storage')).toThrow();
  });

  it('includes field name in error message', () => {
    expect(() => validateSizeFormat('invalid', 'storage.admin.size')).toThrow(
      'Invalid size format for storage.admin.size',
    );
  });
});

describe('validateCpuFormat', () => {
  it('accepts valid CPU format', () => {
    expect(() => validateCpuFormat('100m', 'cpu')).not.toThrow();
    expect(() => validateCpuFormat('500m', 'cpu')).not.toThrow();
    expect(() => validateCpuFormat('1000m', 'cpu')).not.toThrow();
    expect(() => validateCpuFormat('2000m', 'cpu')).not.toThrow();
  });

  it('rejects CPU without m suffix', () => {
    expect(() => validateCpuFormat('100', 'cpu')).toThrow(
      'Invalid CPU format for cpu: "100". Expected format: number + \'m\' (e.g., "100m", "500m")',
    );
    expect(() => validateCpuFormat('1000', 'cpu')).toThrow();
  });

  it('rejects CPU with decimal values', () => {
    expect(() => validateCpuFormat('100.5m', 'cpu')).toThrow();
    expect(() => validateCpuFormat('500.25m', 'cpu')).toThrow();
  });

  it('rejects CPU with spaces', () => {
    expect(() => validateCpuFormat('100 m', 'cpu')).toThrow();
    expect(() => validateCpuFormat('500m ', 'cpu')).toThrow();
  });

  it('rejects CPU with invalid units', () => {
    expect(() => validateCpuFormat('1', 'cpu')).toThrow();
    expect(() => validateCpuFormat('1000mc', 'cpu')).toThrow();
    expect(() => validateCpuFormat('1core', 'cpu')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateCpuFormat('', 'cpu')).toThrow();
  });

  it('includes field name in error message', () => {
    expect(() => validateCpuFormat('invalid', 'resources.admin.cpu')).toThrow(
      'Invalid CPU format for resources.admin.cpu',
    );
  });
});

describe('validateDomainFormat', () => {
  it('accepts valid domain names', () => {
    expect(() => validateDomainFormat('example.com', 'domain')).not.toThrow();
    expect(() => validateDomainFormat('mail.example.com', 'domain')).not.toThrow();
    expect(() => validateDomainFormat('sub.mail.example.com', 'domain')).not.toThrow();
    expect(() => validateDomainFormat('example.co.uk', 'domain')).not.toThrow();
  });

  it('accepts domains with hyphens', () => {
    expect(() => validateDomainFormat('my-domain.com', 'domain')).not.toThrow();
    expect(() => validateDomainFormat('sub-domain.example.com', 'domain')).not.toThrow();
  });

  it('accepts domains with numbers', () => {
    expect(() => validateDomainFormat('example123.com', 'domain')).not.toThrow();
    expect(() => validateDomainFormat('123example.com', 'domain')).not.toThrow();
  });

  it('rejects domain without TLD', () => {
    expect(() => validateDomainFormat('example', 'domain')).toThrow(
      'Invalid domain format for domain: "example". Expected format: valid DNS name (e.g., "example.com", "mail.example.com")',
    );
  });

  it('rejects domain with spaces', () => {
    expect(() => validateDomainFormat('invalid domain.com', 'domain')).toThrow();
    expect(() => validateDomainFormat('example .com', 'domain')).toThrow();
  });

  it('rejects domain starting with hyphen', () => {
    expect(() => validateDomainFormat('-example.com', 'domain')).toThrow();
  });

  it('rejects domain ending with hyphen', () => {
    expect(() => validateDomainFormat('example-.com', 'domain')).toThrow();
  });

  it('rejects domain with special characters', () => {
    expect(() => validateDomainFormat('example@domain.com', 'domain')).toThrow();
    expect(() => validateDomainFormat('example_domain.com', 'domain')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateDomainFormat('', 'domain')).toThrow();
  });

  it('rejects TLD with numbers', () => {
    expect(() => validateDomainFormat('example.com123', 'domain')).toThrow();
  });

  it('rejects single letter TLD', () => {
    expect(() => validateDomainFormat('example.c', 'domain')).toThrow();
  });

  it('includes field name in error message', () => {
    expect(() => validateDomainFormat('invalid', 'hostnames[0]')).toThrow(
      'Invalid domain format for hostnames[0]',
    );
  });
});

describe('validateCidrFormat', () => {
  it('accepts valid CIDR notation', () => {
    expect(() => validateCidrFormat('10.42.0.0/16', 'subnet')).not.toThrow();
    expect(() => validateCidrFormat('192.168.0.0/24', 'subnet')).not.toThrow();
    expect(() => validateCidrFormat('172.16.0.0/12', 'subnet')).not.toThrow();
    expect(() => validateCidrFormat('10.0.0.0/8', 'subnet')).not.toThrow();
  });

  it('accepts CIDR with /32 prefix', () => {
    expect(() => validateCidrFormat('192.168.1.1/32', 'subnet')).not.toThrow();
  });

  it('accepts CIDR with /0 prefix', () => {
    expect(() => validateCidrFormat('0.0.0.0/0', 'subnet')).not.toThrow();
  });

  it('rejects IP without prefix', () => {
    expect(() => validateCidrFormat('10.42.0.0', 'subnet')).toThrow(
      'Invalid CIDR format for subnet: "10.42.0.0". Expected format: IPv4 CIDR notation (e.g., "10.42.0.0/16", "192.168.0.0/24")',
    );
  });

  it('rejects invalid IP octets', () => {
    expect(() => validateCidrFormat('256.0.0.0/8', 'subnet')).toThrow();
    expect(() => validateCidrFormat('192.168.0.300/24', 'subnet')).toThrow();
    expect(() => validateCidrFormat('10.42.-1.0/16', 'subnet')).toThrow();
  });

  it('rejects invalid prefix length', () => {
    expect(() => validateCidrFormat('10.42.0.0/33', 'subnet')).toThrow();
    expect(() => validateCidrFormat('192.168.0.0/-1', 'subnet')).toThrow();
    expect(() => validateCidrFormat('10.0.0.0/100', 'subnet')).toThrow();
  });

  it('rejects malformed CIDR', () => {
    expect(() => validateCidrFormat('10.42/16', 'subnet')).toThrow();
    expect(() => validateCidrFormat('10.42.0/16', 'subnet')).toThrow();
    expect(() => validateCidrFormat('192.168.0.0.0/24', 'subnet')).toThrow();
  });

  it('rejects CIDR with spaces', () => {
    expect(() => validateCidrFormat('10.42.0.0 /16', 'subnet')).toThrow();
    expect(() => validateCidrFormat('10.42.0.0/ 16', 'subnet')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateCidrFormat('', 'subnet')).toThrow();
  });

  it('includes field name in error message', () => {
    expect(() => validateCidrFormat('invalid', 'config.subnet')).toThrow(
      'Invalid CIDR format for config.subnet',
    );
  });
});

describe('validateEmailFormat', () => {
  it('accepts valid email addresses', () => {
    expect(() => validateEmailFormat('admin@example.com', 'email')).not.toThrow();
    expect(() => validateEmailFormat('user.name@example.com', 'email')).not.toThrow();
    expect(() => validateEmailFormat('user+tag@example.com', 'email')).not.toThrow();
    expect(() => validateEmailFormat('user_name@example.com', 'email')).not.toThrow();
    expect(() => validateEmailFormat('user-name@example.com', 'email')).not.toThrow();
  });

  it('accepts emails with numbers', () => {
    expect(() => validateEmailFormat('user123@example.com', 'email')).not.toThrow();
    expect(() => validateEmailFormat('123user@example.com', 'email')).not.toThrow();
  });

  it('accepts emails with subdomains', () => {
    expect(() => validateEmailFormat('admin@mail.example.com', 'email')).not.toThrow();
    expect(() => validateEmailFormat('user@sub.mail.example.com', 'email')).not.toThrow();
  });

  it('rejects email without @', () => {
    expect(() => validateEmailFormat('adminexample.com', 'email')).toThrow(
      'Invalid email format for email: "adminexample.com". Expected format: valid email address (e.g., "admin@example.com")',
    );
  });

  it('rejects email without domain', () => {
    expect(() => validateEmailFormat('admin@', 'email')).toThrow();
  });

  it('rejects email without local part', () => {
    expect(() => validateEmailFormat('@example.com', 'email')).toThrow();
  });

  it('rejects email without TLD', () => {
    expect(() => validateEmailFormat('admin@example', 'email')).toThrow();
  });

  it('rejects email with spaces', () => {
    expect(() => validateEmailFormat('admin @example.com', 'email')).toThrow();
    expect(() => validateEmailFormat('admin@ example.com', 'email')).toThrow();
  });

  it('rejects email with invalid characters', () => {
    expect(() => validateEmailFormat('admin!@example.com', 'email')).toThrow();
    expect(() => validateEmailFormat('admin#@example.com', 'email')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateEmailFormat('', 'email')).toThrow();
  });

  it('includes field name in error message', () => {
    expect(() => validateEmailFormat('invalid', 'mailu.initialAccount.email')).toThrow(
      'Invalid email format for mailu.initialAccount.email',
    );
  });
});
