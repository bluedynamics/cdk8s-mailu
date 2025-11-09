import { Size } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { validateSizeFormat, validateCpuFormat } from './validators';

/**
 * Parse memory size string (e.g., "512Mi", "1Gi") to Size object
 *
 * Validates input format before parsing. Supports Kubernetes binary units (1024-based):
 * - Ki (kibibytes), Mi (mebibytes), Gi (gibibytes), Ti (tebibytes), Pi (pebibytes), Ei (exbibytes)
 * - Decimal values: "1.5Gi", "0.5Mi"
 *
 * @param sizeStr - Memory size string with unit (e.g., "512Mi", "2Gi", "1.5Gi")
 * @param fieldName - Optional field name for error messages
 * @returns Size object for use with cdk8s-plus resource configuration
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * parseMemorySize('512Mi')           // Returns Size.mebibytes(512)
 * parseMemorySize('2Gi')             // Returns Size.gibibytes(2)
 * parseMemorySize('1.5Gi')           // Returns Size.gibibytes(1.5)
 * parseMemorySize('1Ei')             // Returns Size.pebibyte(1024) - 1 Ei = 1024 Pi
 * parseMemorySize('invalid')         // Throws error
 * ```
 */
export function parseMemorySize(sizeStr: string, fieldName: string = 'memory size'): Size {
  validateSizeFormat(sizeStr, fieldName);

  // Extract numeric value and unit
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|Ei)$/);
  if (!match) {
    throw new Error(`Failed to parse size format: ${sizeStr}`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  // Binary units (1024-based)
  switch (unit) {
    case 'Ki':
      return Size.kibibytes(value);
    case 'Mi':
      return Size.mebibytes(value);
    case 'Gi':
      return Size.gibibytes(value);
    case 'Ti':
      return Size.tebibytes(value);
    case 'Pi':
      return Size.pebibyte(value);
    case 'Ei':
      // cdk8s Size doesn't have exbibytes(), so convert to pebibytes (1 Ei = 1024 Pi)
      return Size.pebibyte(value * 1024);
    default:
      throw new Error(`Unsupported size unit: ${unit}`);
  }
}

/**
 * Parse storage size string (e.g., "5Gi", "100Gi") to Size object
 *
 * This is an alias for parseMemorySize, provided for clarity when
 * parsing PVC storage sizes (which typically use larger values).
 *
 * @param sizeStr - Storage size string with unit (e.g., "5Gi", "100Gi")
 * @param fieldName - Optional field name for error messages
 * @returns Size object for use with PVC storage configuration
 *
 * @example
 * ```typescript
 * parseStorageSize('5Gi')    // Returns Size.gibibytes(5)
 * parseStorageSize('100Gi')  // Returns Size.gibibytes(100)
 * ```
 */
export function parseStorageSize(sizeStr: string, fieldName: string = 'storage size'): Size {
  return parseMemorySize(sizeStr, fieldName);
}

/**
 * Parse CPU string (e.g., "100m", "1", "0.5") to Cpu object
 *
 * Validates input format before parsing. Supports all Kubernetes CPU formats:
 * - Millicores: "100m", "500m", "1000m"
 * - Cores: "1", "2", "0.5", "1.5"
 * - Note: 1 core = 1000 millicores
 *
 * @param cpuStr - CPU string (e.g., "100m" for millicores, "1" or "0.5" for cores)
 * @param fieldName - Optional field name for error messages
 * @returns Cpu object for use with cdk8s-plus resource configuration
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * parseCpuMillis('100m')   // Returns Cpu.millis(100) - 100 millicores
 * parseCpuMillis('1000m')  // Returns Cpu.millis(1000) - 1000 millicores = 1 core
 * parseCpuMillis('1')      // Returns Cpu.units(1) - 1 core
 * parseCpuMillis('0.5')    // Returns Cpu.units(0.5) - 0.5 cores = 500m
 * parseCpuMillis('1.5')    // Returns Cpu.units(1.5) - 1.5 cores = 1500m
 * parseCpuMillis('abc')    // Throws error
 * ```
 */
export function parseCpuMillis(cpuStr: string, fieldName: string = 'CPU'): kplus.Cpu {
  validateCpuFormat(cpuStr, fieldName);

  // Check if it's millicores (ends with 'm')
  if (cpuStr.endsWith('m')) {
    const millis = parseInt(cpuStr.replace('m', ''));
    return kplus.Cpu.millis(millis);
  }

  // Otherwise it's cores (integer or decimal)
  const cores = parseFloat(cpuStr);
  return kplus.Cpu.units(cores);
}
