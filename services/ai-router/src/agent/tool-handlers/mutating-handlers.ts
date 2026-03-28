import type { ServiceClient } from "@monica-companion/auth";
import { createLogger } from "@monica-companion/observability";
import type { ConfirmedCommandPayload, MutatingCommandPayload } from "@monica-companion/types";
import type { SchedulerClient } from "../../lib/scheduler-client.js";

const logger = createLogger("ai-router:mutating-handlers");

/**
 * Pending command version — must match the constant in loop.ts.
 * Used to construct idempotency keys: `${pendingCommandId}:v${VERSION}`.
 */
const PENDING_COMMAND_VERSION = 1;

export interface ExecuteMutatingToolParams {
	toolName: string;
	args: Record<string, unknown>;
	userId: string;
	correlationId: string;
	pendingCommandId: string;
	schedulerClient: SchedulerClient;
	monicaServiceClient: ServiceClient;
}

export type ExecuteMutatingToolResult =
	| { status: "success"; executionId: string }
	| { status: "error"; message: string };

/**
 * Execute a confirmed mutating tool call by mapping LLM tool args
 * to a ConfirmedCommandPayload and sending it to the scheduler.
 */
export async function executeMutatingTool(
	params: ExecuteMutatingToolParams,
): Promise<ExecuteMutatingToolResult> {
	const {
		toolName,
		args,
		userId,
		correlationId,
		pendingCommandId,
		schedulerClient,
		monicaServiceClient,
	} = params;

	try {
		const payload = await buildPayload(toolName, args, monicaServiceClient, userId, correlationId);
		if (!payload) {
			return {
				status: "error",
				message: `Unknown tool "${toolName}". Cannot execute.`,
			};
		}

		const confirmedPayload: ConfirmedCommandPayload = {
			pendingCommandId,
			userId,
			commandType: toolName as ConfirmedCommandPayload["commandType"],
			payload,
			idempotencyKey: `${pendingCommandId}:v${PENDING_COMMAND_VERSION}`,
			correlationId,
			confirmedAt: new Date().toISOString(),
			suppressDelivery: true,
		};

		const result = await schedulerClient.execute(confirmedPayload);

		logger.info("Mutating tool executed", {
			correlationId,
			userId,
			toolName,
			executionId: result.executionId,
		});

		return { status: "success", executionId: result.executionId };
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		logger.warn("Mutating tool execution failed", {
			correlationId,
			userId,
			toolName,
			error: errMsg,
		});
		return {
			status: "error",
			message: `Failed to execute "${toolName}". Please try again later.`,
		};
	}
}

/**
 * Build the MutatingCommandPayload from LLM tool args (snake_case) to
 * the camelCase schema expected by the scheduler.
 * Returns null for unknown tool names.
 */
async function buildPayload(
	toolName: string,
	args: Record<string, unknown>,
	serviceClient: ServiceClient,
	userId: string,
	correlationId: string,
): Promise<MutatingCommandPayload | null> {
	switch (toolName) {
		case "create_note":
			return {
				type: "create_note",
				contactId: args.contact_id as number,
				body: args.body as string,
			};

		case "create_contact":
			return {
				type: "create_contact",
				firstName: args.first_name as string,
				lastName: args.last_name as string | undefined,
				nickname: args.nickname as string | undefined,
				genderId: (args.gender_id as number | undefined) ?? 3,
			};

		case "create_activity": {
			const happenedAt =
				(args.date as string | undefined) ?? new Date().toISOString().split("T")[0];
			return {
				type: "create_activity",
				summary: args.description as string,
				happenedAt,
				contactIds: args.contact_ids as number[],
				activityTypeId: null,
			};
		}

		case "update_contact_birthday": {
			const parsed = parseDateString(args.date as string);
			return {
				type: "update_contact_birthday",
				contactId: args.contact_id as number,
				day: parsed.day,
				month: parsed.month,
				year: parsed.year,
			};
		}

		case "update_contact_phone": {
			const phoneTypeId = await fetchContactFieldTypeId(
				serviceClient,
				userId,
				correlationId,
				"phone",
			);
			return {
				type: "update_contact_phone",
				contactId: args.contact_id as number,
				value: args.phone_number as string,
				contactFieldTypeId: phoneTypeId,
			};
		}

		case "update_contact_email": {
			const emailTypeId = await fetchContactFieldTypeId(
				serviceClient,
				userId,
				correlationId,
				"email",
			);
			return {
				type: "update_contact_email",
				contactId: args.contact_id as number,
				value: args.email as string,
				contactFieldTypeId: emailTypeId,
			};
		}

		case "update_contact_address":
			return {
				type: "update_contact_address",
				contactId: args.contact_id as number,
				name: "Main",
				street: args.street as string | undefined,
				city: args.city as string | undefined,
				province: args.province as string | undefined,
				postalCode: args.postal_code as string | undefined,
				country: (args.country as string | undefined) ?? "US",
			};

		case "update_contact_nickname":
			return {
				type: "update_contact_nickname",
				contactId: args.contact_id as number,
				nickname: args.nickname as string,
			};

		case "delete_contact":
			return {
				type: "delete_contact",
				contactId: args.contact_id as number,
			};

		default:
			return null;
	}
}

/**
 * Fetch the Monica contact_field_type_id for a given type string (e.g. "phone", "email").
 * Calls the monica-integration reference endpoint.
 */
export async function fetchContactFieldTypeId(
	serviceClient: ServiceClient,
	userId: string,
	correlationId: string,
	typeString: string,
): Promise<number> {
	const response = await serviceClient.fetch("/internal/contact-field-types", {
		userId,
		correlationId,
		signal: AbortSignal.timeout(10_000),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "unknown");
		throw new Error(`Failed to fetch contact field types: ${response.status}`);
	}

	const data = (await response.json()) as {
		data: Array<{ id: number; name: string; type: string | null }>;
	};

	const entry = data.data.find((t) => t.type === typeString);
	if (!entry) {
		throw new Error(
			`Contact field type "${typeString}" not found. Available types: ${data.data.map((t) => t.type).join(", ")}`,
		);
	}

	return entry.id;
}

/**
 * Parse a "YYYY-MM-DD" date string into day, month, year components.
 */
export function parseDateString(dateStr: string): { day: number; month: number; year?: number } {
	if (!dateStr) {
		throw new Error("Date string is empty");
	}

	const parts = dateStr.split("-");
	if (parts.length !== 3) {
		throw new Error(`Invalid date format: "${dateStr}". Expected YYYY-MM-DD.`);
	}

	const year = Number(parts[0]);
	const month = Number(parts[1]);
	const day = Number(parts[2]);

	if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
		throw new Error(`Invalid date format: "${dateStr}". Expected YYYY-MM-DD with numeric parts.`);
	}

	return { day, month, year };
}
