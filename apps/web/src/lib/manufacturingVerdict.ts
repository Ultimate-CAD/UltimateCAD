/** A surface verdict is separate from sampled thickness/fidelity and print readiness. */
export type VerificationStatus =
  | "verified-valid"
  | "verified-invalid"
  | "inconclusive"
  | "cancelled"
  | "failed";

export type VerificationVerdict = {
  status: VerificationStatus;
  scope: "surface-topology-and-contact";
  reason: string;
};

export function verificationVerdict(
  status: VerificationStatus,
  reason: string,
): VerificationVerdict {
  return {
    status,
    scope: "surface-topology-and-contact",
    reason,
  };
}

export function contactVerdict(
  found: number,
  complete: boolean,
  reason?: string,
): VerificationVerdict {
  if (found > 0)
    return verificationVerdict("verified-invalid", "Intersection witness found");
  return complete
    ? verificationVerdict("verified-valid", "All candidate contacts checked; no intersections")
    : verificationVerdict("inconclusive", reason ?? "Contact search incomplete");
}

export function combineSurfaceVerdicts(
  topologyValid: boolean,
  contacts: VerificationVerdict[],
): VerificationVerdict {
  if (!topologyValid || contacts.some((c) => c.status === "verified-invalid"))
    return verificationVerdict(
      "verified-invalid",
      !topologyValid ? "Topology checks failed" : "Intersection witness found",
    );
  for (const status of ["failed", "cancelled", "inconclusive"] as const) {
    const result = contacts.find((c) => c.status === status);
    if (result) return result;
  }
  return contacts.length
    ? verificationVerdict(
        "verified-valid",
        "Topology and complete contact checks passed; review other manufacturing requirements separately",
      )
    : verificationVerdict("inconclusive", "No surfaces checked");
}

/** Cancellation and resource exhaustion are not internal-error or valid verdicts. */
export function verificationFailure(error: unknown): VerificationVerdict {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "AbortError") return verificationVerdict("cancelled", message);
  if (
    name === "TimeoutError" ||
    /(?:exceed(?:ed|s)|exhaust|time limit|timed out|out of memory|allocation failed|(?:hit|reached).*(?:budget|limit))/i.test(
      message,
    )
  )
    return verificationVerdict("inconclusive", message);
  return verificationVerdict("failed", message);
}
