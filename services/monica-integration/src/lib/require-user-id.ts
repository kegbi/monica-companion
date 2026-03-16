import { getUserId } from "@monica-companion/auth";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Extract and validate the userId from the JWT context.
 * Guards against undefined userId (missing `sub` claim), returning 400.
 */
export function requireUserId(c: Context): string {
	const userId = getUserId(c);
	if (!userId) {
		throw new HTTPException(400, {
			message: "Missing userId in JWT subject claim",
		});
	}
	return userId;
}
