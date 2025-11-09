import { Size } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';

/**
 * Parse memory size string (e.g., "512Mi", "1Gi") to Size object
 *
 * @param sizeStr - Memory size string with unit (e.g., "512Mi", "2Gi")
 * @returns Size object for use with cdk8s-plus resource configuration
 *
 * @example
 * ```typescript
 * parseMemorySize('512Mi')  // Returns Size.mebibytes(512)
 * parseMemorySize('2Gi')    // Returns Size.gibibytes(2)
 * parseMemorySize('1024')   // Returns Size.mebibytes(1024) - defaults to Mi
 * ```
 */
export function parseMemorySize(sizeStr: string): Size {
  if (sizeStr.endsWith('Gi')) {
    return Size.gibibytes(parseInt(sizeStr.replace('Gi', '')));
  } else if (sizeStr.endsWith('Mi')) {
    return Size.mebibytes(parseInt(sizeStr.replace('Mi', '')));
  }
  // Default to mebibytes if no unit specified
  return Size.mebibytes(parseInt(sizeStr));
}

/**
 * Parse storage size string (e.g., "5Gi", "100Gi") to Size object
 *
 * This is an alias for parseMemorySize, provided for clarity when
 * parsing PVC storage sizes (which typically use larger values).
 *
 * @param sizeStr - Storage size string with unit (e.g., "5Gi", "100Gi")
 * @returns Size object for use with PVC storage configuration
 *
 * @example
 * ```typescript
 * parseStorageSize('5Gi')    // Returns Size.gibibytes(5)
 * parseStorageSize('100Gi')  // Returns Size.gibibytes(100)
 * ```
 */
export function parseStorageSize(sizeStr: string): Size {
  return parseMemorySize(sizeStr);
}

/**
 * Parse CPU string (e.g., "100m", "1000m") to Cpu object
 *
 * @param cpuStr - CPU string with 'm' suffix for millicores (e.g., "100m", "500m")
 * @returns Cpu object for use with cdk8s-plus resource configuration
 *
 * @example
 * ```typescript
 * parseCpuMillis('100m')   // Returns Cpu.millis(100)
 * parseCpuMillis('1000m')  // Returns Cpu.millis(1000)
 * parseCpuMillis('500')    // Returns Cpu.millis(500) - assumes millicores
 * ```
 */
export function parseCpuMillis(cpuStr: string): kplus.Cpu {
  const millis = parseInt(cpuStr.replace('m', ''));
  return kplus.Cpu.millis(millis);
}
