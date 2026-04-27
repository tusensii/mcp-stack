import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthEnv } from "../otf/auth.js";
import { getIdToken } from "../otf/auth.js";
import { fetchMemberDetail, fetchMemberships } from "../otf/endpoints.js";
import type { MemberOutput } from "../otf/types.js";
import { textContent, errorContent } from "./utils.js";
import { OtfApiError } from "../otf/client.js";

// Module-scope cache — stable for the life of the isolate
let memberCache: MemberOutput | null = null;

export async function getHomeStudioUuid(env: AuthEnv): Promise<string> {
  const info = await getMemberInfo(env);
  return info.home_studio.studio_uuid;
}

export async function getMemberInfo(env: AuthEnv): Promise<MemberOutput> {
  if (memberCache) return memberCache;

  const { memberUuid } = await getIdToken(env);
  const [detail, memberships] = await Promise.all([
    fetchMemberDetail(memberUuid, env),
    fetchMemberships(memberUuid, env),
  ]);

  const currentMembership = memberships.find(m => m.current === true);

  memberCache = {
    member_uuid: detail.memberUUId,
    email: detail.email ?? "",
    first_name: detail.firstName ?? "",
    last_name: detail.lastName ?? "",
    home_studio: {
      studio_uuid: detail.homeStudio.studioUUId,
      studio_name: detail.homeStudio.studioName ?? "",
      timezone: detail.homeStudio.timeZone ?? "UTC",
    },
    membership_type: currentMembership?.name ?? null,
    remaining_classes_this_period: currentMembership?.remaining ?? null,
    period_resets_on: currentMembership?.expiration_date ?? null,
  };

  return memberCache;
}

export function registerMemberInfoTool(server: McpServer, env: AuthEnv): void {
  server.tool(
    "otf_member_info",
    "Returns your OTF member profile: name, email, home studio (UUID + timezone), " +
    "membership type, and remaining classes this period. " +
    "Use this to resolve your home studio UUID before calling otf_list_classes.",
    {},
    async () => {
      try {
        const info = await getMemberInfo(env);
        return textContent(info);
      } catch (e) {
        if (e instanceof OtfApiError) return errorContent(e.message);
        if (e instanceof Error) return errorContent(e.message);
        throw e;
      }
    },
  );
}
