import type { ReporterTokenIssuer } from "../../domain/status/reporter-management";
import { sha256Hex } from "./token-crypto";

export class WebCryptoReporterTokenIssuer implements ReporterTokenIssuer {
  async issue(reporterId: string) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const token = `${reporterId}.${secret}`;
    return { token, hash: await sha256Hex(token) };
  }
}
