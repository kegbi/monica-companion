export { ContactResolutionClientError, fetchContactSummaries } from "./client.js";
export { matchContacts } from "./matcher.js";
export {
	AMBIGUITY_GAP_THRESHOLD,
	MAX_DISAMBIGUATION_CANDIDATES,
	MAX_NARROWING_ROUNDS,
	MINIMUM_MATCH_THRESHOLD,
	NARROWING_BUTTON_THRESHOLD,
	RESOLVED_THRESHOLD,
	resolveContact,
} from "./resolver.js";
export { contactResolutionRoutes } from "./routes.js";
