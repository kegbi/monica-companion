import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@opentelemetry/api", () => ({
	trace: {
		getTracer: () => ({
			startActiveSpan: (_name: string, fn: (span: unknown) => unknown) =>
				fn({ setAttribute: () => {}, end: () => {} }),
		}),
	},
}));

import type { GraphResponse } from "../../state.js";
import { createDeliverResponseNode, type DeliverResponseDeps } from "../deliver-response.js";

const mockDeliver = vi.fn();
const mockGetDeliveryRouting = vi.fn();

function makeDeps(overrides: Partial<DeliverResponseDeps> = {}): DeliverResponseDeps {
	return {
		deliveryClient: { deliver: mockDeliver },
		userManagementClient: { getDeliveryRouting: mockGetDeliveryRouting },
		...overrides,
	};
}

function makeState(response: GraphResponse | null, overrides: Record<string, unknown> = {}) {
	return {
		userId: "550e8400-e29b-41d4-a716-446655440000",
		correlationId: "corr-123",
		inboundEvent: {
			type: "text_message" as const,
			userId: "550e8400-e29b-41d4-a716-446655440000",
			sourceRef: "tg:msg:456",
			correlationId: "corr-123",
			text: "Hello",
		},
		recentTurns: [],
		activePendingCommand: null,
		contactResolution: null,
		contactSummariesCache: null,
		userPreferences: null,
		intentClassification: null,
		actionOutcome: null,
		response,
		...overrides,
	};
}

describe("deliverResponseNode", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetDeliveryRouting.mockResolvedValue({
			connectorType: "telegram",
			connectorRoutingId: "chat-123",
		});
		mockDeliver.mockResolvedValue({ deliveryId: "del-1", status: "delivered" });
	});

	it("delivers text response to delivery service", async () => {
		const node = createDeliverResponseNode(makeDeps());
		const response: GraphResponse = { type: "text", text: "Hello!" };

		await node(makeState(response));

		expect(mockGetDeliveryRouting).toHaveBeenCalledWith(
			"550e8400-e29b-41d4-a716-446655440000",
			"corr-123",
		);
		expect(mockDeliver).toHaveBeenCalledWith({
			userId: "550e8400-e29b-41d4-a716-446655440000",
			connectorType: "telegram",
			connectorRoutingId: "chat-123",
			correlationId: "corr-123",
			content: { type: "text", text: "Hello!" },
		});
	});

	it("delivers confirmation_prompt with pendingCommandId and version", async () => {
		const node = createDeliverResponseNode(makeDeps());
		const response: GraphResponse = {
			type: "confirmation_prompt",
			text: "Create note for Jane?",
			pendingCommandId: "cmd-1",
			version: 2,
		};

		await node(makeState(response));

		expect(mockDeliver).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "confirmation_prompt",
					text: "Create note for Jane?",
					pendingCommandId: "cmd-1",
					version: 2,
				},
			}),
		);
	});

	it("delivers disambiguation_prompt with options", async () => {
		const node = createDeliverResponseNode(makeDeps());
		const response: GraphResponse = {
			type: "disambiguation_prompt",
			text: "Which Jane?",
			options: [
				{ label: "Jane Doe", value: "jane-doe-id" },
				{ label: "Jane Smith", value: "jane-smith-id" },
			],
		};

		await node(makeState(response));

		expect(mockDeliver).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "disambiguation_prompt",
					text: "Which Jane?",
					options: [
						{ label: "Jane Doe", value: "jane-doe-id" },
						{ label: "Jane Smith", value: "jane-smith-id" },
					],
				},
			}),
		);
	});

	it("delivers error response", async () => {
		const node = createDeliverResponseNode(makeDeps());
		const response: GraphResponse = { type: "error", text: "Something went wrong." };

		await node(makeState(response));

		expect(mockDeliver).toHaveBeenCalledWith(
			expect.objectContaining({
				content: { type: "error", text: "Something went wrong." },
			}),
		);
	});

	it("skips delivery when response is null", async () => {
		const node = createDeliverResponseNode(makeDeps());

		await node(makeState(null));

		expect(mockDeliver).not.toHaveBeenCalled();
		expect(mockGetDeliveryRouting).not.toHaveBeenCalled();
	});

	it("handles delivery failure gracefully (best-effort)", async () => {
		mockDeliver.mockRejectedValue(new Error("delivery timeout"));

		const node = createDeliverResponseNode(makeDeps());
		const response: GraphResponse = { type: "text", text: "Hello!" };

		// Should not throw
		const update = await node(makeState(response));
		expect(update).toEqual({});
	});

	it("handles routing lookup failure gracefully", async () => {
		mockGetDeliveryRouting.mockRejectedValue(new Error("user-management down"));

		const node = createDeliverResponseNode(makeDeps());
		const response: GraphResponse = { type: "text", text: "Hello!" };

		// Should not throw
		const update = await node(makeState(response));
		expect(update).toEqual({});
		expect(mockDeliver).not.toHaveBeenCalled();
	});
});
