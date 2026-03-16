import { describe, expect, it } from "vitest";
import {
	activityFixture,
	activityTypeFixture,
	addressFixture,
	contactFieldFixture,
	contactFieldTypeFixture,
	countryFixture,
	createActivityRequestFixture,
	createContactFieldRequestFixture,
	createContactRequestFixture,
	createNoteRequestFixture,
	createRelationshipRequestFixture,
	createReminderRequestFixture,
	deleteResponseFixture,
	embeddedContactFixture,
	errorResponseFixture,
	fullContactFixture,
	genderFixture,
	noteFixture,
	paginatedContactsFixture,
	relationshipFixture,
	relationshipShortFixture,
	relationshipTypeFixture,
	relationshipTypeGroupFixture,
	reminderFixture,
	reminderOutboxFixture,
	tagFixture,
	updateRelationshipRequestFixture,
} from "../__fixtures__/index.js";
import {
	AccountRef,
	Activity,
	ActivityType,
	Address,
	ContactField,
	ContactFieldType,
	Country,
	CreateActivityRequest,
	CreateContactFieldRequest,
	CreateContactRequest,
	CreateNoteRequest,
	CreateRelationshipRequest,
	CreateReminderRequest,
	DeleteResponse,
	EmbeddedContact,
	ErrorResponse,
	FullContact,
	Gender,
	MonicaDateField,
	Note,
	PaginatedResponse,
	PaginationMetaLink,
	Relationship,
	RelationshipShort,
	RelationshipType,
	RelationshipTypeGroup,
	Reminder,
	ReminderOutbox,
	Tag,
	UpdateRelationshipRequest,
} from "../schemas/index.js";

describe("Monica API Zod schemas", () => {
	describe("common schemas", () => {
		it("parses AccountRef", () => {
			const result = AccountRef.safeParse({ id: 1 });
			expect(result.success).toBe(true);
		});

		it("rejects AccountRef with non-integer id", () => {
			const result = AccountRef.safeParse({ id: 1.5 });
			expect(result.success).toBe(false);
		});

		it("parses MonicaDateField with date", () => {
			const result = MonicaDateField.safeParse({
				is_age_based: false,
				is_year_unknown: false,
				date: "1990-01-15T00:00:00Z",
			});
			expect(result.success).toBe(true);
		});

		it("parses MonicaDateField with all nulls", () => {
			const result = MonicaDateField.safeParse({
				is_age_based: null,
				is_year_unknown: null,
				date: null,
			});
			expect(result.success).toBe(true);
		});

		it("parses DeleteResponse", () => {
			const result = DeleteResponse.safeParse(deleteResponseFixture);
			expect(result.success).toBe(true);
		});

		it("parses ErrorResponse with string message", () => {
			const result = ErrorResponse.safeParse(errorResponseFixture);
			expect(result.success).toBe(true);
		});

		it("parses ErrorResponse with array message", () => {
			const result = ErrorResponse.safeParse({
				error: {
					message: ["The initial date field is required."],
					error_code: 32,
				},
			});
			expect(result.success).toBe(true);
		});

		it("parses PaginationMetaLink", () => {
			const result = PaginationMetaLink.safeParse({
				url: null,
				label: "&laquo; Previous",
				active: false,
			});
			expect(result.success).toBe(true);
		});

		it("parses PaginatedResponse with contacts", () => {
			const result = PaginatedResponse(FullContact).safeParse(paginatedContactsFixture);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.data).toHaveLength(1);
				expect(result.data.meta.total).toBe(1);
			}
		});
	});

	describe("contact schemas", () => {
		it("parses EmbeddedContact fixture", () => {
			const result = EmbeddedContact.safeParse(embeddedContactFixture);
			expect(result.success).toBe(true);
		});

		it("parses FullContact fixture", () => {
			const result = FullContact.safeParse(fullContactFixture);
			expect(result.success).toBe(true);
		});

		it("rejects FullContact missing required field", () => {
			const { first_name, ...rest } = fullContactFixture;
			const result = FullContact.safeParse(rest);
			expect(result.success).toBe(false);
		});

		it("parses RelationshipShort fixture", () => {
			const result = RelationshipShort.safeParse(relationshipShortFixture);
			expect(result.success).toBe(true);
		});

		it("validates FullContact has typed relationship contacts", () => {
			const result = FullContact.safeParse(fullContactFixture);
			expect(result.success).toBe(true);
			if (result.success) {
				const loveContacts = result.data.information.relationships.love.contacts;
				expect(Array.isArray(loveContacts)).toBe(true);
			}
		});

		it("parses CreateContactRequest fixture", () => {
			const result = CreateContactRequest.safeParse(createContactRequestFixture);
			expect(result.success).toBe(true);
		});

		it("rejects CreateContactRequest with extra unknown field", () => {
			const result = CreateContactRequest.safeParse({
				...createContactRequestFixture,
				unknown_field: "test",
			});
			expect(result.success).toBe(false);
		});
	});

	describe("note schemas", () => {
		it("parses Note fixture", () => {
			const result = Note.safeParse(noteFixture);
			expect(result.success).toBe(true);
		});

		it("parses CreateNoteRequest fixture", () => {
			const result = CreateNoteRequest.safeParse(createNoteRequestFixture);
			expect(result.success).toBe(true);
		});

		it("rejects Note with non-boolean is_favorited", () => {
			const result = Note.safeParse({
				...noteFixture,
				is_favorited: "yes",
			});
			expect(result.success).toBe(false);
		});
	});

	describe("activity schemas", () => {
		it("parses Activity fixture", () => {
			const result = Activity.safeParse(activityFixture);
			expect(result.success).toBe(true);
		});

		it("parses ActivityType fixture", () => {
			const result = ActivityType.safeParse(activityTypeFixture);
			expect(result.success).toBe(true);
		});

		it("parses CreateActivityRequest fixture", () => {
			const result = CreateActivityRequest.safeParse(createActivityRequestFixture);
			expect(result.success).toBe(true);
		});

		it("allows null activity_type in Activity", () => {
			const result = Activity.safeParse({
				...activityFixture,
				activity_type: null,
			});
			expect(result.success).toBe(true);
		});
	});

	describe("reminder schemas", () => {
		it("parses Reminder fixture", () => {
			const result = Reminder.safeParse(reminderFixture);
			expect(result.success).toBe(true);
		});

		it("parses ReminderOutbox fixture", () => {
			const result = ReminderOutbox.safeParse(reminderOutboxFixture);
			expect(result.success).toBe(true);
		});

		it("parses CreateReminderRequest fixture", () => {
			const result = CreateReminderRequest.safeParse(createReminderRequestFixture);
			expect(result.success).toBe(true);
		});

		it("rejects invalid frequency_type", () => {
			const result = Reminder.safeParse({
				...reminderFixture,
				frequency_type: "daily",
			});
			expect(result.success).toBe(false);
		});
	});

	describe("contact field schemas", () => {
		it("parses ContactField fixture", () => {
			const result = ContactField.safeParse(contactFieldFixture);
			expect(result.success).toBe(true);
		});

		it("parses ContactFieldType fixture", () => {
			const result = ContactFieldType.safeParse(contactFieldTypeFixture);
			expect(result.success).toBe(true);
		});

		it("parses CreateContactFieldRequest fixture", () => {
			const result = CreateContactFieldRequest.safeParse(createContactFieldRequestFixture);
			expect(result.success).toBe(true);
		});

		it("validates data/content asymmetry (request uses data, response uses content)", () => {
			expect("data" in createContactFieldRequestFixture).toBe(true);
			expect("content" in contactFieldFixture).toBe(true);
			expect("data" in contactFieldFixture).toBe(false);
		});
	});

	describe("address schemas", () => {
		it("parses Address fixture", () => {
			const result = Address.safeParse(addressFixture);
			expect(result.success).toBe(true);
		});

		it("parses Country fixture", () => {
			const result = Country.safeParse(countryFixture);
			expect(result.success).toBe(true);
		});
	});

	describe("relationship schemas", () => {
		it("parses Relationship fixture", () => {
			const result = Relationship.safeParse(relationshipFixture);
			expect(result.success).toBe(true);
		});

		it("parses RelationshipType fixture", () => {
			const result = RelationshipType.safeParse(relationshipTypeFixture);
			expect(result.success).toBe(true);
		});

		it("parses RelationshipTypeGroup fixture", () => {
			const result = RelationshipTypeGroup.safeParse(relationshipTypeGroupFixture);
			expect(result.success).toBe(true);
		});

		it("parses CreateRelationshipRequest fixture", () => {
			const result = CreateRelationshipRequest.safeParse(createRelationshipRequestFixture);
			expect(result.success).toBe(true);
		});

		it("parses UpdateRelationshipRequest fixture", () => {
			const result = UpdateRelationshipRequest.safeParse(updateRelationshipRequestFixture);
			expect(result.success).toBe(true);
		});

		it("rejects CreateRelationshipRequest with extra field", () => {
			const result = CreateRelationshipRequest.safeParse({
				...createRelationshipRequestFixture,
				unknown: true,
			});
			expect(result.success).toBe(false);
		});
	});

	describe("tag schemas", () => {
		it("parses Tag fixture", () => {
			const result = Tag.safeParse(tagFixture);
			expect(result.success).toBe(true);
		});

		it("rejects Tag with missing name", () => {
			const { name, ...rest } = tagFixture;
			const result = Tag.safeParse(rest);
			expect(result.success).toBe(false);
		});
	});

	describe("gender schemas", () => {
		it("parses Gender fixture", () => {
			const result = Gender.safeParse(genderFixture);
			expect(result.success).toBe(true);
		});
	});

	describe("response schemas strip unknown keys", () => {
		it("strips unknown keys from FullContact response", () => {
			const result = FullContact.safeParse({
				...fullContactFixture,
				_extra_field: "should be stripped",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect("_extra_field" in result.data).toBe(false);
			}
		});

		it("strips unknown keys from Note response", () => {
			const result = Note.safeParse({
				...noteFixture,
				_extra_field: "should be stripped",
			});
			expect(result.success).toBe(true);
			if (result.success) {
				expect("_extra_field" in result.data).toBe(false);
			}
		});
	});
});
