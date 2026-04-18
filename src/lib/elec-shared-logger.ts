import { createSharedLogger } from "@core-x/shared-logger";

let bootstrapped = false;

/**
 * Khởi tạo một lần: khi có `LOG_BRIDGE_URL` thì gửi audit lên Log Bridge → log-service / CRM.
 */
export function bootstrapElecSharedLogger(): void {
  if (bootstrapped) return;

  const logBridgeUrl = (process.env.LOG_BRIDGE_URL ?? "").trim();
  if (!logBridgeUrl) {
    return;
  }

  bootstrapped = true;

  const serviceName = (process.env.ELEC_LOG_SERVICE_NAME ?? "elec-service").trim() || "elec-service";
  const serviceKey = (process.env.ELEC_LOG_SERVICE_KEY ?? "elec").trim() || "elec";

  createSharedLogger({
    serviceName,
    serviceKey,
    logBridgeUrl,
    logBridgeIngressSecret: (process.env.LOG_BRIDGE_INGRESS_SECRET ?? "").trim() || undefined,
    NODE_ENV: process.env.NODE_ENV,
  });
}
