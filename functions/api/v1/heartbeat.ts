import { handleHeartbeatRequest } from "../../../src/server/interface/http/heartbeat-handler";
import type { StatusEnvironment } from "../../../src/server/interface/http/environment";

export const onRequest: PagesFunction<StatusEnvironment> = async (context) =>
  handleHeartbeatRequest(context.request, context.env);
