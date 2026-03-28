import type { MutatingCommandPayload } from "@monica-companion/types";

export interface MonicaRequest {
	method: "POST" | "PUT" | "DELETE";
	path: string;
	body: Record<string, unknown>;
}

/**
 * Maps a confirmed MutatingCommandPayload to the corresponding
 * monica-integration HTTP request. This is a pure function with no I/O.
 */
export function mapCommandToMonicaRequest(payload: MutatingCommandPayload): MonicaRequest {
	switch (payload.type) {
		case "create_contact": {
			const { type: _, ...body } = payload;
			return { method: "POST", path: "/internal/contacts", body };
		}

		case "create_note": {
			const { type: _, contactId, ...rest } = payload;
			return {
				method: "POST",
				path: `/internal/contacts/${contactId}/notes`,
				body: rest,
			};
		}

		case "create_activity": {
			const { type: _, ...body } = payload;
			return { method: "POST", path: "/internal/activities", body };
		}

		case "update_contact_birthday": {
			const { type: _, contactId, day, month, year } = payload;
			return {
				method: "PUT",
				path: `/internal/contacts/${contactId}`,
				body: {
					birthdate: { day, month, ...(year !== undefined ? { year } : {}) },
				},
			};
		}

		case "update_contact_phone": {
			const { type: _, contactId, ...rest } = payload;
			return {
				method: "POST",
				path: `/internal/contacts/${contactId}/contact-fields`,
				body: { ...rest, type: "phone" },
			};
		}

		case "update_contact_email": {
			const { type: _, contactId, ...rest } = payload;
			return {
				method: "POST",
				path: `/internal/contacts/${contactId}/contact-fields`,
				body: { ...rest, type: "email" },
			};
		}

		case "update_contact_address": {
			const { type: _, contactId, ...rest } = payload;
			return {
				method: "POST",
				path: `/internal/contacts/${contactId}/addresses`,
				body: rest,
			};
		}

		case "update_contact_nickname": {
			return {
				method: "PUT",
				path: `/internal/contacts/${payload.contactId}/nickname`,
				body: { nickname: payload.nickname },
			};
		}

		case "delete_contact": {
			return {
				method: "DELETE",
				path: `/internal/contacts/${payload.contactId}`,
				body: {},
			};
		}
	}
}
