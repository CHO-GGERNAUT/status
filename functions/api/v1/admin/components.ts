import { handleAdminRequest } from "../../../../src/server/interface/http/admin-handler";
import type { StatusEnvironment } from "../../../../src/server/interface/http/environment";

export const onRequest: PagesFunction<StatusEnvironment> = (context) =>
  handleAdminRequest(context.request, context.env, "components");
