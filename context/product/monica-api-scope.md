# Monica V4 API Scope: Monica Companion V1

_Verified against live Monica hosted API (app.monicahq.com) running v4.1.1 on 2026-03-15._

> **Source of truth:** All contracts below were validated via real API calls with a test account
> **and** cross-referenced against the v4.1.1 source code (Resource classes, Service validation
> rules, and route definitions). The official docs page (monicahq.com/api) has multiple
> inaccuracies for v4.1.1. This document reflects the **actual** deployed behavior confirmed
> by source.

---

## General

- **Base URL:** `https://app.monicahq.com/api` (or self-hosted equivalent)
- **Auth:** `Authorization: Bearer <OAuth2-token>` header on every request
- **Format:** JSON over HTTPS; timestamps in ISO 8601 (`YYYY-MM-DDTHH:MM:SSZ`)
- **Rate limit:** 60 requests/minute; headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`

### Pagination

All list endpoints return a standard paginated envelope. Defaults: `per_page: 15` (Laravel default; controller sets `limitPerPage = 0` which defers to framework), `page: 1`.

Query params: `?page=<int>&limit=<int>` (max 100, configurable via `MAX_API_LIMIT_PER_PAGE` env var).

```jsonc
{
  "data": [ /* array of resource objects */ ],
  "links": {
    "first": "string (URL)",
    "last": "string (URL)",
    "prev": "string|null",
    "next": "string|null"
  },
  "meta": {
    "current_page": "int",
    "from": "int|null",
    "last_page": "int",
    "links": [
      { "url": "string|null", "label": "string", "active": "boolean" }
    ],
    "path": "string (base URL without query)",
    "per_page": "int",
    "to": "int|null",
    "total": "int"
  }
}
```

### Embedded Contact (Short Form)

Many resources embed a contact reference. This is a reduced projection used inside notes, reminders, activities, contact fields, and addresses:

```jsonc
{
  "id": "int",
  "uuid": "string (UUID v4)",
  "object": "contact",
  "hash_id": "string",
  "first_name": "string",
  "last_name": "string|null",
  "nickname": "string|null",
  "complete_name": "string",
  "initials": "string",
  "gender": "string",           // e.g. "Man", "Woman", "Rather not say"
  "gender_type": "string",      // "M", "F", "O"
  "is_starred": "boolean",
  "is_partial": "boolean",
  "is_active": "boolean",
  "is_dead": "boolean",
  "is_me": "boolean",
  "information": {
    "birthdate": { "is_age_based": "boolean|null", "is_year_unknown": "boolean|null", "date": "string|null" },
    "deceased_date": { "is_age_based": "boolean|null", "is_year_unknown": "boolean|null", "date": "string|null" },
    "avatar": {
      "url": "string",
      "source": "string",          // "default", "adorable", "gravatar", "photo"
      "default_avatar_color": "string"  // hex color e.g. "#b3d5fe"
    }
  },
  "url": "string (API URL to this contact)",
  "account": { "id": "int" }
}
```

### Delete Response

All DELETE endpoints return:
```jsonc
{ "deleted": true, "id": "int" }
```

---

## Contacts

### List Contacts — `GET /api/contacts`

Query params: `page`, `limit`, `sort` (`created_at`, `-created_at`, `updated_at`, `-updated_at`).

Returns paginated array of full contact objects.

### Search Contacts — `GET /api/contacts?query=<string>`

Searches `first_name`, `last_name`, `food_preferences`, `job`, `company`. Returns paginated contact array.

### Get Contact — `GET /api/contacts/:id`

Returns single full contact object wrapped in `{ "data": { ... } }`.

**With contact fields and notes:** `GET /api/contacts/:id?with=contactfields`
Adds `contactFields` array and `notes` array (latest 3) to the response.

### Full Contact Object

```jsonc
{
  "id": "int",
  "uuid": "string (UUID v4)",
  "object": "contact",
  "hash_id": "string",
  "first_name": "string",
  "last_name": "string|null",
  "nickname": "string|null",
  "complete_name": "string",        // computed: "First Last (Nickname)"
  "initials": "string",             // computed: "FL"
  "description": "string|null",
  "gender": "string",               // display name: "Man", "Woman", "Rather not say"
  "gender_type": "string",          // code: "M", "F", "O"
  "is_starred": "boolean",
  "is_partial": "boolean",
  "is_active": "boolean",
  "is_dead": "boolean",
  "is_me": "boolean",
  "last_called": "string|null",
  "last_activity_together": "string|null",  // ISO 8601 datetime or null
  "stay_in_touch_frequency": "int|null",
  "stay_in_touch_trigger_date": "string|null",
  "information": {
    "relationships": {
      "love":   { "total": "int", "contacts": "RelationshipShort[]" },
      "family": { "total": "int", "contacts": "RelationshipShort[]" },
      "friend": { "total": "int", "contacts": "RelationshipShort[]" },
      "work":   { "total": "int", "contacts": "RelationshipShort[]" }
    },
    "dates": {
      "birthdate":     { "is_age_based": "boolean|null", "is_year_unknown": "boolean|null", "date": "string|null" },
      "deceased_date": { "is_age_based": "boolean|null", "is_year_unknown": "boolean|null", "date": "string|null" }
    },
    "career": {
      "job": "string|null",
      "company": "string|null"
    },
    "avatar": {
      "url": "string",
      "source": "string",
      "default_avatar_color": "string"
    },
    "food_preferences": "string|null",
    "how_you_met": {
      "general_information": "string|null",
      "first_met_date": { "is_age_based": "boolean|null", "is_year_unknown": "boolean|null", "date": "string|null" },
      "first_met_through_contact": "object|null"
    }
  },
  "addresses": "Address[]",         // array of Address objects (see Addresses section)
  "tags": "Tag[]",
  "statistics": {
    "number_of_calls": "int",
    "number_of_notes": "int",
    "number_of_activities": "int",
    "number_of_reminders": "int",
    "number_of_tasks": "int",
    "number_of_gifts": "int",
    "number_of_debts": "int"
  },
  // Only present with ?with=contactfields:
  "contactFields": "ContactField[]", // optional
  "notes": "Note[]",                 // optional — latest 3
  "url": "string (API URL)",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

### Create Contact — `POST /api/contacts`

**Request body:**
```jsonc
{
  "first_name": "string (required, max 50)",
  "last_name": "string (max 100)",
  "nickname": "string (max 100)",
  "gender_id": "int (required)",             // from GET /api/genders
  "is_birthdate_known": "boolean (required)",
  "birthdate_day": "int",                    // required if is_birthdate_known=true
  "birthdate_month": "int",                  // required if is_birthdate_known=true
  "birthdate_year": "int",                   // omit for unknown year
  "birthdate_is_age_based": "boolean",
  "birthdate_age": "int",                    // if age-based
  "is_deceased": "boolean (required)",
  "is_deceased_date_known": "boolean (required)",
  "deceased_date_day": "int",
  "deceased_date_month": "int",
  "deceased_date_year": "int",
  "deceased_date_is_age_based": "boolean",
  "is_partial": "boolean"
}
```

**Response:** `{ "data": <Contact> }` — full contact object.

### Update Contact — `PUT /api/contacts/:id`

Same request body as Create. Returns updated full contact object.

### Update Contact Career — `PUT /api/contacts/:id/work`

**Request body:**
```jsonc
{
  "job": "string (max 255)",
  "company": "string (max 255)"
}
```

**Response:** `{ "data": <Contact> }` — full contact object with updated career.

### Delete Contact — `DELETE /api/contacts/:id`

---

## Contact Fields (Phone, Email, etc.)

Phone and email are stored as "contact fields", not as top-level contact properties.

### List Contact Field Types — `GET /api/contactfieldtypes`

Returns the types available in the account. Default types:

| Name      | type   | id (account-specific) |
|-----------|--------|-----------------------|
| Email     | email  | varies                |
| Phone     | phone  | varies                |
| Facebook  | null   | varies                |
| Twitter   | null   | varies                |
| Whatsapp  | null   | varies                |
| Telegram  | null   | varies                |
| LinkedIn  | null   | varies                |

**ContactFieldType object:**
```jsonc
{
  "id": "int",
  "uuid": "string",
  "object": "contactfieldtype",
  "name": "string",
  "fontawesome_icon": "string",
  "protocol": "string|null",       // e.g. "mailto:", "tel:", "https://wa.me/"
  "delible": "boolean",
  "type": "string|null",           // "email", "phone", or null
  "account": { "id": "int" },
  "created_at": "string",
  "updated_at": "string"
}
```

### Create Contact Field — `POST /api/contactfields`

**Request body:**
```jsonc
{
  "data": "string (required, max 255)",        // the value (email address, phone number, etc.)
  "contact_field_type_id": "int (required)",  // from GET /api/contactfieldtypes
  "contact_id": "int (required)",
  "labels": "string[]"                        // optional array of label strings
}
```

**Response:** `{ "data": <ContactField> }`

**ContactField object:**
```jsonc
{
  "id": "int",
  "uuid": "string",
  "object": "contactfield",
  "content": "string",              // NOTE: input field is "data", output field is "content"
  "contact_field_type": "ContactFieldType",
  "labels": "array",
  "account": { "id": "int" },
  "contact": "EmbeddedContact (short form)",
  "created_at": "string",
  "updated_at": "string"
}
```

> **Important asymmetry:** The create/update request uses `"data"` as the field name for the value,
> but the response returns it as `"content"`.

### Update Contact Field — `PUT /api/contactfields/:id`

Same request body as Create. Returns updated ContactField object.

### Delete Contact Field — `DELETE /api/contactfields/:id`

---

## Addresses

### List Addresses — `GET /api/addresses` or `GET /api/contacts/:id/addresses`

Returns paginated array of Address objects.

### Create Address — `POST /api/addresses`

**Request body:**
```jsonc
{
  "name": "string",                // label, e.g. "home", "work"
  "street": "string|null",
  "city": "string|null",
  "province": "string|null",       // state/province code
  "postal_code": "string|null",
  "country": "string",             // ISO 3166-1 alpha-2, e.g. "US"
  "contact_id": "int (required)"
}
```

**Response:** `{ "data": <Address> }`

**Address object:**
```jsonc
{
  "id": "int",
  "uuid": "string",
  "object": "address",
  "name": "string|null",
  "street": "string|null",
  "city": "string|null",
  "province": "string|null",
  "postal_code": "string|null",
  "latitude": "float|null",         // auto-geocoded by Monica
  "longitude": "float|null",        // auto-geocoded by Monica
  "country": {
    "id": "string",                  // ISO code
    "object": "country",
    "name": "string",
    "iso": "string"
  },
  "url": "string (API URL)",
  "account": { "id": "int" },
  "contact": "EmbeddedContact (short form)",
  "created_at": "string",
  "updated_at": "string"
}
```

### Update Address — `PUT /api/addresses/:id`

Same request body as Create. Returns updated Address object.

### Delete Address — `DELETE /api/addresses/:id`

---

## Reminders

### List Reminders — `GET /api/reminders` or `GET /api/contacts/:id/reminders`

Returns paginated array of Reminder objects.

### Get Reminder — `GET /api/reminders/:id`

Returns `{ "data": <Reminder> }`.

### Create Reminder — `POST /api/reminders`

> **Doc correction:** The official docs page says `POST /reminder/` (singular) with field
> `next_expected_date`. Both are wrong. The actual endpoint is `/reminders` (plural) and
> the field is `initial_date`.

**Request body:**
```jsonc
{
  "title": "string (required, max 100000)",
  "description": "string (max 1000000)",
  "initial_date": "string (required)",      // format: YYYY-MM-DD
  "frequency_type": "string (required)",     // "one_time", "week", "month", "year"
  "frequency_number": "int (required)",      // recurrence interval (e.g. 1 = every 1 year)
  "contact_id": "int (required)",
  "delible": "boolean"                       // optional, defaults to true; false = system-managed
}
```

**Response:** `{ "data": <Reminder> }`

**Reminder object:**
```jsonc
{
  "id": "int",
  "uuid": "string",
  "object": "reminder",
  "title": "string",
  "description": "string|null",
  "frequency_type": "string",        // "one_time", "week", "month", "year"
  "frequency_number": "int",
  "initial_date": "string (ISO 8601)",   // NOT "next_expected_date" as docs claim
  "delible": "boolean",                  // false for system-generated (e.g. birthday)
  "account": { "id": "int" },
  "contact": "EmbeddedContact (short form)",
  "created_at": "string",
  "updated_at": "string"
}
```

> **Doc discrepancies (verified):**
> - Docs show `last_triggered_date` and `next_expected_date` — neither exists in actual responses.
> - Actual response has `initial_date` and `delible` instead.

### Update Reminder — `PUT /api/reminders/:id`

Same request body as Create. Returns updated Reminder object.

### Delete Reminder — `DELETE /api/reminders/:id`

### Upcoming Reminders — `GET /api/reminders/upcoming/{month}`

Returns scheduled reminder instances for a given month offset (0 = current month, 1 = next month, etc.).

Uses a different response shape (`ReminderOutbox`) than the standard Reminder object:

```jsonc
{
  "id": "int",                         // outbox row ID, NOT reminder ID
  "reminder_id": "int",               // the parent reminder's ID
  "object": "string",                 // nature of the outbox entry
  "planned_date": "string",           // YYYY-MM-DD scheduled date
  "title": "string",
  "description": "string|null",
  "frequency_type": "string",
  "frequency_number": "int",
  "initial_date": "string (ISO 8601)",
  "delible": "boolean",
  "account": { "id": "int" },
  "contact": "EmbeddedContact (short form)",
  "created_at": "string",
  "updated_at": "string"
}
```

---

## Notes

### List Notes — `GET /api/notes` or `GET /api/contacts/:id/notes`

Returns paginated array of Note objects.

### Get Note — `GET /api/notes/:id`

Returns `{ "data": <Note> }`.

### Create Note — `POST /api/notes`

**Request body:**
```jsonc
{
  "body": "string (required, max 100000)",
  "contact_id": "int (required)",
  "is_favorited": "boolean"            // optional; accepts true/false/1/0 (Laravel boolean rule)
}
```

**Response:** `{ "data": <Note> }`

**Note object:**
```jsonc
{
  "id": "int",
  "uuid": "string",
  "object": "note",
  "body": "string",
  "is_favorited": "boolean",            // response is boolean (cast via model $casts)
  "favorited_at": "string|null",
  "url": "string (API URL)",
  "account": { "id": "int" },
  "contact": "EmbeddedContact (short form)",
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

### Update Note — `PUT /api/notes/:id`

Same request body as Create. Returns updated Note object.

### Delete Note — `DELETE /api/notes/:id`

---

## Activities

### List Activities — `GET /api/activities` or `GET /api/contacts/:id/activities`

Returns paginated array of Activity objects. The `meta` object includes an extra `statistics` field:
```jsonc
"statistics": { "2026": 3, "2025": 12 }  // count of activities per year
```

### Get Activity — `GET /api/activities/:id`

Returns `{ "data": <Activity> }`.

### Create Activity — `POST /api/activities`

**Request body:**
```jsonc
{
  "activity_type_id": "int|null",           // from GET /api/activitytypes; optional per source code
  "summary": "string (required, max 255)",
  "description": "string (max 1000000)",
  "happened_at": "string (required)",     // format: YYYY-MM-DD
  "contacts": "int[] (required)",         // array of contact IDs
  "emotions": "int[]"                     // array of emotion IDs (optional)
}
```

**Response:** `{ "data": <Activity> }`

**Activity object:**
```jsonc
{
  "id": "int",
  "uuid": "string",
  "object": "activity",
  "summary": "string",
  "description": "string|null",
  "happened_at": "string",              // YYYY-MM-DD (date only, no time)
  "activity_type": {
    "id": "int",
    "uuid": "string",
    "object": "activityType",
    "name": "string",
    "location_type": "string|null",
    "activity_type_category": {
      "id": "int",
      "uuid": "string",
      "object": "activityTypeCategory",
      "name": "string",
      "account": { "id": "int" },
      "created_at": "string|null",
      "updated_at": "string|null"
    },
    "account": { "id": "int" },
    "created_at": "string|null",
    "updated_at": "string|null"
  },
  "attendees": {
    "total": "int",
    "contacts": "EmbeddedContact[]"      // array of short-form contacts
  },
  "emotions": "array",
  "url": "string (API URL)",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

### Activity Types — `GET /api/activitytypes`

Returns paginated list of activity types. Default categories include "Simple activities", "Sport", "Food", "Cultural activities".

### Update Activity — `PUT /api/activities/:id`

Same request body as Create. Returns updated Activity object.

### Delete Activity — `DELETE /api/activities/:id`

---

## Supporting Endpoints

### Genders — `GET /api/genders`

Required for contact creation (`gender_id` field). Returns paginated array of Gender objects. Default genders:

| name           | type | gender_type |
|----------------|------|-------------|
| Man            | M    | M           |
| Woman          | F    | F           |
| Rather not say | O    | O           |

**Gender object:**
```jsonc
{
  "id": "int",
  "object": "gender",
  "name": "string",
  "type": "string",             // "M", "F", "O"
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

---

## Relationships

### List Contact Relationships — `GET /api/contacts/:id/relationships`

Returns all relationships for a contact as a collection (not paginated; returns `{ "data": [...] }` directly without pagination meta).

### Get Relationship — `GET /api/relationships/:id`

Returns `{ "data": <Relationship> }`.

### Create Relationship — `POST /api/relationships`

**Request body:**
```jsonc
{
  "contact_is": "int (required)",           // contact ID of the subject
  "of_contact": "int (required)",           // contact ID of the related person
  "relationship_type_id": "int (required)"  // from GET /api/relationshiptypes
}
```

> **Note:** Creating a relationship also creates the reverse relationship automatically (e.g. if A is "parent" of B, B becomes "child" of A).

**Response:** `{ "data": <Relationship> }`

### Update Relationship — `PUT /api/relationships/:id`

**Request body:**
```jsonc
{
  "relationship_type_id": "int (required)"
}
```

**Response:** `{ "data": <Relationship> }`

### Delete Relationship — `DELETE /api/relationships/:id`

### Relationship Object (Full)

```jsonc
{
  "id": "int",
  "uuid": "string (UUID v4)",
  "object": "relationship",
  "contact_is": "EmbeddedContact (short form)",
  "relationship_type": "RelationshipType",
  "of_contact": "EmbeddedContact (short form)",
  "url": "string (API URL)",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

### RelationshipShort Object (Embedded in Full Contact)

Found in `information.relationships.{love,family,friend,work}.contacts[]`:

```jsonc
{
  "relationship": {
    "id": "int",
    "uuid": "string (UUID v4)",
    "name": "string"       // relationship type name, e.g. "partner", "child", "friend"
  },
  "contact": "EmbeddedContact (short form)"
}
```

### Relationship Types

#### List Relationship Types — `GET /api/relationshiptypes`

Returns paginated array of RelationshipType objects.

#### Get Relationship Type — `GET /api/relationshiptypes/:id`

Returns `{ "data": <RelationshipType> }`.

**RelationshipType object:**
```jsonc
{
  "id": "int",
  "object": "relationshiptype",
  "name": "string",
  "name_reverse_relationship": "string",
  "relationship_type_group_id": "int",
  "delible": "boolean",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

**Default relationship types by group:**

| Group  | name              | name_reverse_relationship |
|--------|-------------------|---------------------------|
| love   | partner           | partner                   |
| love   | spouse            | spouse                    |
| love   | date              | date                      |
| love   | lover             | lover                     |
| love   | ex-boyfriend      | ex-boyfriend              |
| love   | ex-girlfriend     | ex-girlfriend             |
| love   | ex-husband        | ex-husband                |
| love   | ex-wife           | ex-wife                   |
| family | child             | parent                    |
| family | parent            | child                     |
| family | sibling           | sibling                   |
| family | grandparent       | grandchild                |
| family | grandchild        | grandparent               |
| family | uncle             | nephew                    |
| family | nephew            | uncle                     |
| family | cousin            | cousin                    |
| family | godparent         | godchild                  |
| family | godchild          | godparent                 |
| family | stepparent        | stepchild                 |
| family | stepchild         | stepparent                |
| friend | friend            | friend                    |
| friend | bestfriend        | bestfriend                |
| work   | colleague         | colleague                 |
| work   | boss              | subordinate               |
| work   | subordinate       | boss                      |
| work   | mentor            | protege                   |
| work   | protege           | mentor                    |

> **Note:** These are read-only in V1. We only need them for reading relationship labels during contact resolution.

### Relationship Type Groups

#### List Relationship Type Groups — `GET /api/relationshiptypegroups`

Returns paginated array of RelationshipTypeGroup objects.

#### Get Relationship Type Group — `GET /api/relationshiptypegroups/:id`

Returns `{ "data": <RelationshipTypeGroup> }`.

**RelationshipTypeGroup object:**
```jsonc
{
  "id": "int",
  "object": "relationshiptypegroup",
  "name": "string",
  "delible": "boolean",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

**Default groups:** `love`, `family`, `friend`, `work`.

---

## Tags

### List Tags — `GET /api/tags`

Returns paginated array of Tag objects.

### Get Tag — `GET /api/tags/:id`

Returns `{ "data": <Tag> }`.

### List Contacts by Tag — `GET /api/tags/:id/contacts`

Returns paginated array of Contact objects associated with the given tag.

### Set Tags on Contact — `POST /api/contacts/:id/setTags`

**Request body:**
```jsonc
{
  "tags": "string[] (required)"    // array of tag name strings
}
```

Sets the given tags on a contact. Creates tags that don't already exist.

### Remove All Tags from Contact — `POST /api/contacts/:id/unsetTags`

Removes all tags from a contact. No request body required.

### Remove Specific Tag from Contact — `POST /api/contacts/:id/unsetTag`

**Request body:**
```jsonc
{
  "tags": "string[] (required)"    // array of tag name strings to remove
}
```

> **Note:** Tag mutation endpoints are documented for reference but not used in V1.

**Tag object:**
```jsonc
{
  "id": "int",
  "object": "tag",
  "name": "string",
  "name_slug": "string",
  "account": { "id": "int" },
  "created_at": "string (ISO 8601)",
  "updated_at": "string (ISO 8601)"
}
```

---

## ContactResolutionSummary Endpoint Mapping

This section documents which Monica API endpoints and fields feed into each field of the `ContactResolutionSummary` projection consumed by `ai-router`.

| ContactResolutionSummary Field | Monica Source Endpoint | Monica Source Fields | Notes |
|---|---|---|---|
| `contactId` | `GET /api/contacts` | `id` | Stable integer ID |
| `displayName` | `GET /api/contacts` | `complete_name` | Computed by Monica as "First Last (Nickname)" |
| `aliases[]` | `GET /api/contacts` | `nickname`, `first_name`, `last_name` | V1: aliases are limited to name-derived fields. The broader alias set (user-defined aliases, family labels) is deferred to a future version. |
| `relationshipLabels[]` | `GET /api/contacts` embedded relationships | `information.relationships.{love,family,friend,work}.contacts[].relationship.name` | From the contact's perspective. Only present for full contacts (`is_partial: false`). |
| `importantDates[]` | `GET /api/contacts` | `information.dates.birthdate.date`, `information.dates.birthdate.is_age_based`, `information.dates.birthdate.is_year_unknown` | V1 focuses on birthdate. Nullable when birthdate is unknown. |
| `lastInteractionAt` | `GET /api/contacts` | `last_activity_together` | Nullable. ISO 8601 datetime string or null. |

### Fetch Strategy

The contact projection cache is built from a full contact list fetch:

1. **Initial load:** Paginate through `GET /api/contacts?limit=100` to fetch all contacts.
2. **Projection extraction:** For each full contact, extract the fields listed above into a `ContactResolutionSummary`.
3. **Relationship labels:** Read directly from `information.relationships.{group}.contacts[].relationship.name` in the full contact response. No separate relationship endpoint call needed.
4. **Refresh:** Incremental refresh via `GET /api/contacts?sort=-updated_at` to detect recently changed contacts.

> **Note:** `information.relationships` is omitted for partial contacts (`is_partial: true`). Partial contacts will have an empty `relationshipLabels[]` array.

> **Rate limit consideration:** At 60 req/min and 100 contacts per page, a 1000-contact Monica instance requires 10 requests (10 seconds of rate budget). Implementation details including backoff strategy belong to the "Typed Monica Integration" task.

---

## Doc vs Actual Discrepancies Summary

| Area | Official Docs (monicahq.com/api) | Actual v4.1.1 Behavior |
|------|----------------------------------|------------------------|
| Pagination default | `per_page: 10` | `per_page: 15` |
| Pagination meta | no `links` array in `meta` | `meta.links[]` array present |
| Contact object | missing `uuid`, `hash_id`, `complete_name`, `initials`, `description`, `gender_type`, `is_starred`, `is_active`, `is_me`, `url` | all present |
| Contact `last_activity_together` | `{ date, timezone_type, timezone }` object | ISO 8601 string or null |
| Reminder create URL | `POST /reminder/` (singular) | `POST /reminders` (plural) |
| Reminder create field | `next_expected_date` | `initial_date` |
| Reminder response | has `last_triggered_date`, `next_expected_date` | has `initial_date`, `delible` — no triggered/expected fields |
| Contact field input/output | not clearly documented | input: `"data"`, output: `"content"` |
| Note `is_favorited` input | docs say integer required | Laravel `boolean` rule (accepts true/false/1/0), optional |
| Activity `activity_type_id` | docs say required | `nullable\|integer` — optional per source code |
| Activity `happened_at` | full ISO 8601 | date-only string `YYYY-MM-DD` |
| Activities meta | standard meta | includes `statistics` with per-year counts |

---

## Error Responses

Standard error format:
```jsonc
{
  "error": {
    "message": "string | string[]",
    "error_code": "int"            // Monica-specific error code
  }
}
```

Validation errors return an array of messages. Example:
```jsonc
{ "error": { "message": ["The initial date field is required."], "error_code": 32 } }
```

HTTP status codes: `200` (success), `201` (created), `404` (not found), `422` (validation error), `429` (rate limited).

---

## Source Code References (v4.1.1)

Source: [monicahq/monica v4.1.1](https://github.com/monicahq/monica/tree/v4.1.1).
Local copy: `references/remote/app/` (gitignored; see `AGENTS.md` for re-download instructions).

These files are the definitive source for response shapes and validation rules:

| Concern | Local path |
|---------|------------|
| Full contact shape | `references/remote/app/app/Http/Resources/Contact/ContactBase.php` |
| Embedded contact shape | `references/remote/app/app/Http/Resources/Contact/ContactShort.php` |
| Reminder response | `references/remote/app/app/Http/Resources/Reminder/Reminder.php` |
| Upcoming reminder response | `references/remote/app/app/Http/Resources/Reminder/ReminderOutbox.php` |
| Note response | `references/remote/app/app/Http/Resources/Note/Note.php` |
| Activity response | `references/remote/app/app/Http/Resources/Activity/Activity.php` |
| ContactField response | `references/remote/app/app/Http/Resources/ContactField/ContactField.php` |
| Address response | `references/remote/app/app/Http/Resources/Address/Address.php` |
| Reminder create validation | `references/remote/app/app/Services/Contact/Reminder/CreateReminder.php` |
| Activity create validation | `references/remote/app/app/Services/Account/Activity/Activity/CreateActivity.php` |
| ContactField create validation | `references/remote/app/app/Services/Contact/ContactField/CreateContactField.php` |
| Note create validation | `references/remote/app/app/Http/Controllers/Api/ApiNoteController.php` (inline) |
| Relationship response | `references/remote/app/app/Http/Resources/Relationship/Relationship.php` |
| RelationshipShort response | `references/remote/app/app/Http/Resources/Relationship/RelationshipShort.php` |
| Relationship controller | `references/remote/app/app/Http/Controllers/Api/ApiRelationshipController.php` |
| Relationship create validation | `references/remote/app/app/Services/Contact/Relationship/CreateRelationship.php` |
| RelationshipType response | `references/remote/app/app/Http/Resources/RelationshipType/RelationshipType.php` |
| RelationshipTypeGroup response | `references/remote/app/app/Http/Resources/RelationshipTypeGroup/RelationshipTypeGroup.php` |
| Tag response | `references/remote/app/app/Http/Resources/Tag/Tag.php` |
| Gender response | `references/remote/app/app/Http/Resources/Gender/Gender.php` |
| API routes | `references/remote/app/routes/api.php` |
| Pagination defaults | `references/remote/app/app/Http/Controllers/Api/ApiController.php` (`limitPerPage = 0` → Laravel default 15) |
