import { Size } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { validateSizeFormat, validateCpuFormat } from './validators';

/**
 * Parse memory size string (e.g., "512Mi", "1Gi") to Size object
 *
 * Validates input format before parsing.
 *
 * @param sizeStr - Memory size string with unit (e.g., "512Mi", "2Gi")
 * @param fieldName - Optional field name for error messages
 * @returns Size object for use with cdk8s-plus resource configuration
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * parseMemorySize('512Mi')           // Returns Size.mebibytes(512)
 * parseMemorySize('2Gi')             // Returns Size.gibibytes(2)
 * parseMemorySize('invalid')         // Throws error
 * ```
 */
export function parseMemorySize(sizeStr: string, fieldName: string = 'memory size'): Size {
  validateSizeFormat(sizeStr, fieldName);

  if (sizeStr.endsWith('Gi')) {
    return Size.gibibytes(parseInt(sizeStr.replace('Gi', '')));
  } else if (sizeStr.endsWith('Mi')) {
    return Size.mebibytes(parseInt(sizeStr.replace('Mi', '')));
  }

  // Should never reach here due to validation, but TypeScript needs this
  throw new Error(`Unexpected size format: ${sizeStr}`);
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
 * Parse CPU string (e.g., "100m", "1000m") to Cpu object
 *
 * Validates input format before parsing.
 *
 * @param cpuStr - CPU string with 'm' suffix for millicores (e.g., "100m", "500m")
 * @param fieldName - Optional field name for error messages
 * @returns Cpu object for use with cdk8s-plus resource configuration
 * @throws Error if format is invalid
 *
 * @example
 * ```typescript
 * parseCpuMillis('100m')   // Returns Cpu.millis(100)
 * parseCpuMillis('1000m')  // Returns Cpu.millis(1000)
 * parseCpuMillis('500')    // Throws error (missing 'm' suffix)
 * ```
 */
export function parseCpuMillis(cpuStr: string, fieldName: string = 'CPU'): kplus.Cpu {
  validateCpuFormat(cpuStr, fieldName);
  const millis = parseInt(cpuStr.replace('m', ''));
  return kplus.Cpu.millis(millis);
}
