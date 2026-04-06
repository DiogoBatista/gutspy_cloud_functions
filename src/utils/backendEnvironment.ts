/**
 * Labels the Firebase project hosting Cloud Functions (backend) for Slack and logs.
 * Project IDs are not secret; staging vs prod is a product concern.
 */

const DEFAULT_STAGING_IDS = new Set(["gutspy-stg"]);

/**
 * Optional comma-separated override (e.g. "gutspy-stg,other-stg").
 * If unset, DEFAULT_STAGING_IDS is used.
 * @return {Set<string>} Project ids treated as staging
 */
function stagingProjectIds(): Set<string> {
  const raw = process.env.STAGING_FIREBASE_PROJECT_IDS?.trim();
  if (!raw) return DEFAULT_STAGING_IDS;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/**
 * Returns the active GCP project id for this Cloud Functions runtime.
 * @return {string} Firebase/GCP project id or "unknown"
 */
export function getGcloudProjectId(): string {
  if (process.env.GCLOUD_PROJECT) {
    return process.env.GCLOUD_PROJECT;
  }
  const fc = process.env.FIREBASE_CONFIG;
  if (fc) {
    try {
      const parsed = JSON.parse(fc) as { projectId?: string };
      if (parsed.projectId) return parsed.projectId;
    } catch {
      // ignore
    }
  }
  return "unknown";
}

export type BackendEnvironmentLabel = "Staging" | "Production";

/**
 * Staging if project id is listed as staging; otherwise Production (covers prod and unknown ids).
 * @return {{ projectId: string, label: BackendEnvironmentLabel }} Deployed project and label
 */
export function getBackendEnvironment(): { projectId: string; label: BackendEnvironmentLabel } {
  const projectId = getGcloudProjectId();
  const label: BackendEnvironmentLabel = stagingProjectIds().has(projectId)
    ? "Staging"
    : "Production";
  return { projectId, label };
}
