# Monica API Contracts (Source-Mapped)

Date: 2026-02-17

This document defines the Monica route contracts for this project, derived from:

1. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\contacts\monica-contacts.service.ts`
2. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\contacts\monica-contacts.types.ts`
3. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\notes\monica-notes.service.ts`
4. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\notes\monica-notes.types.ts`
5. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\reminders\monica-reminders.service.ts`
6. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\reminders\monica-reminders.types.ts`
7. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\monica-common.types.ts`
8. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\monica.types.ts`
9. `C:\Users\Ivan\Documents\MEGA\StuffSync\Prog\personal-ai-assistant\services\agent-server\src\integrations\monica\monica.guards.ts`

## 1) Common Request Contract

- Base URL: `{MONICA_URL}`.
- Auth header: `Authorization: Bearer {MONICA_TOKEN}`.
- Content type: `application/json`.
- Accept: `application/json`.

## 2) Common Response Envelopes

### Paginated list envelope

```json
{
  "data": [],
  "links": {
    "first": "https://monica.example/api/contacts?page=1",
    "last": "https://monica.example/api/contacts?page=3",
    "prev": null,
    "next": "https://monica.example/api/contacts?page=2"
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 3,
    "path": "https://monica.example/api/contacts",
    "per_page": 10,
    "to": 10,
    "total": 24
  }
}
```

### Single-resource envelope

```json
{
  "data": {}
}
```

### Delete envelope

```json
{
  "deleted": true,
  "id": 123
}
```

### Error envelope (when provided)

```json
{
  "error": {
    "message": "Resource not found",
    "error_code": 404
  }
}
```

## 3) Resource Schemas Used by Routes

### MonicaContact (response object)

- `id: number`
- `uuid?: string`
- `object: "contact"`
- `hash_id?: string`
- `first_name: string | null`
- `last_name: string | null`
- `nickname: string | null`
- `complete_name?: string | null`
- `description?: string | null`
- `gender: string | null`
- `gender_type?: string | null`
- `is_starred?: boolean`
- `is_partial: boolean`
- `is_active?: boolean`
- `is_dead: boolean`
- `is_me?: boolean`
- `last_called: string | null`
- `last_activity_together: string | { date: string; timezone_type: number; timezone: string } | null`
- `stay_in_touch_frequency: number | null`
- `stay_in_touch_trigger_date: string | null`
- `information?: { relationships?, dates?, career?, avatar?, food_preferences?, food_preferencies?, how_you_met? }`
- `addresses?: MonicaAddress[]`
- `tags?: MonicaTag[]`
- `statistics?: MonicaContactStatistics`
- `account?: { id: number }`
- `created_at: string`
- `updated_at: string`
- `contactFields?: MonicaContactField[]`
- `notes?: MonicaNote[]`
- `url?: string`

### MonicaReminder (response object)

- `id: number`
- `uuid?: string`
- `object: "reminder"`
- `title: string`
- `description: string | null`
- `frequency_type: string`
- `frequency_number: number | null`
- `initial_date?: string | null`
- `last_triggered_date?: string | null`
- `next_expected_date?: string | null`
- `delible?: boolean`
- `account?: { id: number }`
- `contact: MonicaContactReference`
- `created_at: string`
- `updated_at: string`

### MonicaNote (response object)

- `id: number`
- `object: "note"`
- `body: string`
- `is_favorited: boolean`
- `favorited_at: string | null`
- `account: { id: number }`
- `contact: MonicaNoteContact`
- `created_at: string`
- `updated_at: string`

## 4) Contacts Routes

### GET `/contacts` (list)

Input:
- Query params:
  - `limit?: number`
  - `page?: number`
  - `sort?: "created_at" | "-created_at" | "updated_at" | "-updated_at"`
  - `query?: string`

Output:
- `MonicaPaginatedResponse<MonicaContact>`

Example:

```json
{
  "data": [
    {
      "id": 101,
      "object": "contact",
      "first_name": "Anna",
      "last_name": "Miller",
      "nickname": "Anya",
      "gender": "female",
      "gender_type": "F",
      "is_partial": false,
      "is_dead": false,
      "complete_name": "Anna Miller",
      "hash_id": "abc123",
      "url": "https://monica.example/api/contacts/101",
      "last_called": null,
      "last_activity_together": null,
      "stay_in_touch_frequency": null,
      "stay_in_touch_trigger_date": null,
      "information": {
        "dates": {
          "birthdate": {
            "is_age_based": false,
            "is_year_unknown": false,
            "date": "1991-05-14"
          }
        },
        "career": {
          "job": "Product Manager",
          "company": "Acme Inc."
        }
      },
      "created_at": "2026-02-10T11:40:00Z",
      "updated_at": "2026-02-15T09:00:00Z"
    }
  ],
  "links": {
    "first": "https://monica.example/api/contacts?page=1",
    "last": "https://monica.example/api/contacts?page=1",
    "prev": null,
    "next": null
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 1,
    "path": "https://monica.example/api/contacts",
    "per_page": 10,
    "to": 1,
    "total": 1
  }
}
```

### GET `/contacts` (search by name)

Input:
- Same endpoint as list.
- Query params:
  - `query: string` (required by integration service `searchContacts`)
  - Optional: `limit`, `page`, `sort`

Output:
- `MonicaPaginatedResponse<MonicaContact>`

### GET `/contacts/{contactId}` (get by id)

Input:
- Path param: `contactId: number`
- Query params:
  - `with=contactfields` when contact fields are requested.

Output:
- `{ "data": MonicaContact }`

Example:

```json
{
  "data": {
    "id": 101,
    "object": "contact",
    "first_name": "Anna",
    "last_name": "Miller",
    "nickname": "Anya",
    "gender": "female",
    "is_partial": false,
    "is_dead": false,
    "contactFields": [
      {
        "id": 44,
        "object": "contactfield",
        "content": "anna@example.com",
        "contact_field_type": {
          "id": 9,
          "object": "contactfieldtype",
          "name": "Email",
          "fontawesome_icon": "envelope",
          "protocol": "mailto",
          "delible": false,
          "type": "email",
          "account": { "id": 1 },
          "created_at": "2026-01-01T00:00:00Z",
          "updated_at": "2026-01-01T00:00:00Z"
        },
        "account": { "id": 1 },
        "contact": {
          "id": 101,
          "object": "contact",
          "first_name": "Anna",
          "last_name": "Miller",
          "nickname": null,
          "gender": "female",
          "is_partial": false
        },
        "created_at": "2026-02-01T00:00:00Z",
        "updated_at": "2026-02-01T00:00:00Z"
      }
    ],
    "created_at": "2026-02-10T11:40:00Z",
    "updated_at": "2026-02-15T09:00:00Z",
    "last_called": null,
    "last_activity_together": null,
    "stay_in_touch_frequency": null,
    "stay_in_touch_trigger_date": null
  }
}
```

### PUT `/contacts/{contactId}` (update basic details)

Input:
- Path param: `contactId: number`
- JSON body (`MonicaUpdateContactPayload`):
  - Required:
    - `first_name: string`
    - `gender_id: number`
    - `is_birthdate_known: boolean`
    - `is_deceased: boolean`
    - `is_deceased_date_known: boolean`
  - Optional:
    - `last_name?: string | null`
    - `nickname?: string | null`
    - `birthdate_day?: number | null`
    - `birthdate_month?: number | null`
    - `birthdate_year?: number | null`
    - `birthdate_is_age_based?: boolean`
    - `birthdate_age?: number | null`
    - `is_partial?: boolean`
    - `deceased_date_add_reminder?: boolean`
    - `deceased_date_day?: number | null`
    - `deceased_date_month?: number | null`
    - `deceased_date_year?: number | null`
    - `deceased_date_is_age_based?: boolean`
    - `deceased_date_is_year_unknown?: boolean`
    - `deceased_date_age?: number | null`

Example input:

```json
{
  "first_name": "Anna",
  "last_name": "Miller",
  "nickname": "Anya",
  "gender_id": 2,
  "birthdate_day": 14,
  "birthdate_month": 5,
  "birthdate_year": 1991,
  "birthdate_is_age_based": false,
  "is_birthdate_known": true,
  "birthdate_age": null,
  "is_partial": false,
  "is_deceased": false,
  "is_deceased_date_known": false,
  "deceased_date_add_reminder": false,
  "deceased_date_day": null,
  "deceased_date_month": null,
  "deceased_date_year": null,
  "deceased_date_is_age_based": false,
  "deceased_date_is_year_unknown": false,
  "deceased_date_age": null
}
```

Output:
- `{ "data": MonicaContact }`

### PUT `/contacts/{contactId}/work` (update career)

Input:
- Path param: `contactId: number`
- JSON body (`MonicaUpdateContactCareerPayload`):
  - `job?: string | null`
  - `company?: string | null`

Example input:

```json
{
  "job": "Senior Product Manager",
  "company": "Acme Inc."
}
```

Output:
- `{ "data": MonicaContact }`

## 5) Reminders Routes

### GET `/reminders` (list reminders)

Input:
- Query params used by integration:
  - `limit?: number` (service uses `100`)
  - `page?: number` (service iterates pages)

Output:
- `MonicaPaginatedResponse<MonicaReminder>`

Example:

```json
{
  "data": [
    {
      "id": 7001,
      "object": "reminder",
      "title": "Birthday",
      "description": null,
      "frequency_type": "year",
      "frequency_number": 1,
      "initial_date": "2020-05-14",
      "last_triggered_date": "2025-05-14",
      "next_expected_date": "2026-05-14",
      "contact": {
        "id": 101,
        "object": "contact",
        "first_name": "Anna",
        "last_name": "Miller",
        "nickname": null,
        "gender": "female",
        "is_partial": false,
        "complete_name": "Anna Miller",
        "hash_id": "abc123",
        "information": {
          "birthdate": {
            "is_age_based": false,
            "is_year_unknown": false,
            "date": "1991-05-14"
          },
          "avatar": {
            "url": "https://monica.example/avatar/101.png",
            "source": "gravatar"
          }
        },
        "url": "https://monica.example/api/contacts/101"
      },
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2026-01-01T00:00:00Z"
    }
  ],
  "links": {
    "first": "https://monica.example/api/reminders?page=1",
    "last": "https://monica.example/api/reminders?page=1",
    "prev": null,
    "next": null
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 1,
    "path": "https://monica.example/api/reminders",
    "per_page": 100,
    "to": 1,
    "total": 1
  }
}
```

## 6) Notes Routes

### GET `/notes` (list all notes)

Input:
- Query params:
  - `limit?: number`
  - `page?: number`

Output:
- `MonicaPaginatedResponse<MonicaNote>`

### GET `/contacts/{contactId}/notes` (list notes for one contact)

Input:
- Path param: `contactId: number`
- Query params:
  - `limit?: number`
  - `page?: number`

Output:
- `MonicaPaginatedResponse<MonicaNote>`

Example (for either list endpoint):

```json
{
  "data": [
    {
      "id": 9001,
      "object": "note",
      "body": "Prefers coffee meetings on Fridays.",
      "is_favorited": true,
      "favorited_at": "2026-02-10T10:00:00Z",
      "account": { "id": 1 },
      "contact": {
        "id": 101,
        "object": "contact",
        "first_name": "Anna",
        "last_name": "Miller",
        "gender": "female",
        "is_partial": false,
        "information": {
          "dates": [
            {
              "name": "birthday",
              "is_birthdate_approximate": null,
              "birthdate": "1991-05-14"
            }
          ]
        }
      },
      "created_at": "2026-02-10T09:59:00Z",
      "updated_at": "2026-02-10T10:00:00Z"
    }
  ],
  "links": {
    "first": "https://monica.example/api/notes?page=1",
    "last": "https://monica.example/api/notes?page=1",
    "prev": null,
    "next": null
  },
  "meta": {
    "current_page": 1,
    "from": 1,
    "last_page": 1,
    "path": "https://monica.example/api/notes",
    "per_page": 25,
    "to": 1,
    "total": 1
  }
}
```

### GET `/notes/{noteId}` (get one note)

Input:
- Path param: `noteId: number`

Output:
- `{ "data": MonicaNote }`

### POST `/notes` (create note)

Input:
- JSON body (`MonicaCreateNotePayload`):
  - `body: string`
  - `contact_id: number`
  - `is_favorited: 0 | 1`

Example input:

```json
{
  "body": "Met at product meetup, follow up next week.",
  "contact_id": 101,
  "is_favorited": 0
}
```

Output:
- `{ "data": MonicaNote }`

### PUT `/notes/{noteId}` (update note)

Input:
- Path param: `noteId: number`
- JSON body (`MonicaUpdateNotePayload`):
  - `body: string`
  - `contact_id: number`
  - `is_favorited: 0 | 1`

Example input:

```json
{
  "body": "Met at product meetup, prefers morning calls.",
  "contact_id": 101,
  "is_favorited": 1
}
```

Output:
- `{ "data": MonicaNote }`

### DELETE `/notes/{noteId}` (delete note)

Input:
- Path param: `noteId: number`

Output:

```json
{
  "deleted": true,
  "id": 9001
}
```

## 7) Implementation Notes for This Repo

1. Search contacts is implemented as `GET /contacts` with `query=...`.
2. All list routes are treated as paginated and must parse `links` + `meta`.
3. Contract parsing should fail closed (invalid payload shape should raise an error).
4. Tests must use mocked Monica payloads based on this document.
