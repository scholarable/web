import { authLoader } from "@workos-inc/authkit-react-router";
import type { Route } from "./+types/auth-callback";
import { requireStudentAuth, studentAuthEnv } from "../lib/student-auth.server";

const callback = authLoader({ returnPathname: "/account" });
export function loader(args: Route.LoaderArgs) {
  requireStudentAuth(args.request, studentAuthEnv(args.context));
  return callback(args);
}
