import type { StatusEnvironment } from "../../../src/server/interface/http/environment";
import { handleStatusRequest } from "../../../src/server/interface/http/status-handler";

export const onRequest: PagesFunction<StatusEnvironment> = async (context) =>
  handleStatusRequest(context.request, context.env);
