import { parseMemorySize, parseStorageSize, parseCpuMillis } from '../src/utils/resource-parser';

describe('parseMemorySize', () => {
  describe('binary units (1024-based)', () => {
    it('parses Ki (kibibytes)', () => {
      const result = parseMemorySize('1024Ki');
      expect(result).toBeDefined();
    });

    it('parses Mi (mebibytes)', () => {
      const result = parseMemorySize('512Mi');
      expect(result).toBeDefined();
    });

    it('parses Gi (gibibytes)', () => {
      const result = parseMemorySize('5Gi');
      expect(result).toBeDefined();
    });

    it('parses Ti (tebibytes)', () => {
      const result = parseMemorySize('2Ti');
      expect(result).toBeDefined();
    });

    it('parses Pi (pebibytes)', () => {
      const result = parseMemorySize('1Pi');
      expect(result).toBeDefined();
    });

    it('parses Ei (exbibytes)', () => {
      const result = parseMemorySize('1Ei');
      expect(result).toBeDefined();
    });
  });


  describe('decimal values with binary units', () => {
    it('parses decimal Gi', () => {
      const result = parseMemorySize('1.5Gi');
      expect(result).toBeDefined();
    });

    it('parses decimal Mi', () => {
      const result = parseMemorySize('0.5Mi');
      expect(result).toBeDefined();
    });

    it('parses decimal Ti', () => {
      const result = parseMemorySize('2.75Ti');
      expect(result).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('throws on invalid format', () => {
      expect(() => parseMemorySize('invalid')).toThrow('Invalid size format');
    });

    it('throws on missing unit', () => {
      expect(() => parseMemorySize('500')).toThrow('Invalid size format');
    });

    it('throws on invalid unit', () => {
      expect(() => parseMemorySize('5GB')).toThrow('Invalid size format');
    });

    it('includes field name in error message', () => {
      expect(() => parseMemorySize('invalid', 'storage.admin.size')).toThrow(
        'Invalid size format for storage.admin.size',
      );
    });
  });
});

describe('parseStorageSize', () => {
  it('is an alias for parseMemorySize', () => {
    const memoryResult = parseMemorySize('5Gi');
    const storageResult = parseStorageSize('5Gi');
    expect(storageResult).toEqual(memoryResult);
  });

  it('accepts optional fieldName parameter', () => {
    expect(() => parseStorageSize('invalid', 'storage.size')).toThrow(
      'Invalid size format for storage.size',
    );
  });
});

describe('parseCpuMillis', () => {
  describe('millicores format', () => {
    it('parses 100m', () => {
      const result = parseCpuMillis('100m');
      expect(result).toBeDefined();
    });

    it('parses 500m', () => {
      const result = parseCpuMillis('500m');
      expect(result).toBeDefined();
    });

    it('parses 1000m', () => {
      const result = parseCpuMillis('1000m');
      expect(result).toBeDefined();
    });

    it('parses 2000m', () => {
      const result = parseCpuMillis('2000m');
      expect(result).toBeDefined();
    });
  });

  describe('cores format (integer)', () => {
    it('parses 1 core', () => {
      const result = parseCpuMillis('1');
      expect(result).toBeDefined();
    });

    it('parses 2 cores', () => {
      const result = parseCpuMillis('2');
      expect(result).toBeDefined();
    });

    it('parses 4 cores', () => {
      const result = parseCpuMillis('4');
      expect(result).toBeDefined();
    });
  });

  describe('cores format (decimal)', () => {
    it('parses 0.5 cores', () => {
      const result = parseCpuMillis('0.5');
      expect(result).toBeDefined();
    });

    it('parses 1.5 cores', () => {
      const result = parseCpuMillis('1.5');
      expect(result).toBeDefined();
    });

    it('parses 2.75 cores', () => {
      const result = parseCpuMillis('2.75');
      expect(result).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('throws on invalid format', () => {
      expect(() => parseCpuMillis('invalid')).toThrow('Invalid CPU format');
    });

    it('throws on decimal millicores', () => {
      expect(() => parseCpuMillis('100.5m')).toThrow('Invalid CPU format');
    });

    it('throws on invalid units', () => {
      expect(() => parseCpuMillis('1core')).toThrow('Invalid CPU format');
      expect(() => parseCpuMillis('1000mc')).toThrow('Invalid CPU format');
    });

    it('includes field name in error message', () => {
      expect(() => parseCpuMillis('invalid', 'resources.cpu')).toThrow(
        'Invalid CPU format for resources.cpu',
      );
    });
  });
});
