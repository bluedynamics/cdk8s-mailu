import { JsonPatch } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';

/**
 * Sets `spec.template.spec.priorityClassName` on a workload's pod template.
 *
 * cdk8s-plus does not expose priorityClassName, so the synthesized manifest
 * is patched through the protected apiObject - the same escape hatch the
 * dovecot-submission construct uses for nodeSelector and tolerations.
 * Without a name nothing is patched and the manifest stays unchanged.
 *
 * Not for CronJob, whose pod template lives under `spec.jobTemplate`.
 */
export function applyPriorityClassName(workload: kplus.Workload, priorityClassName?: string): void {
  if (!priorityClassName) {
    return;
  }
  (workload as any).apiObject.addJsonPatch(
    JsonPatch.add('/spec/template/spec/priorityClassName', priorityClassName),
  );
}
