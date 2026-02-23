# Custom Quote Source API (HTTPS Only)

## Purpose

Quotify can use a custom quote dataset provided by a user-defined API endpoint.
This API must return a JSON body compatible with the app's internal quote format.

## Endpoint Requirements

- Method: `GET`
- Protocol: `HTTPS` only (`https://`)
- Response: JSON

Non-HTTPS endpoints are rejected by the app before any network request is made.

## Response Schema

Top-level JSON object:

- `quotes` (required): array of quote objects
- `metadata` (optional): object with any additional dataset metadata

### Minimum Valid Response

```json
{
  "quotes": [
    {
      "content": "Stay hungry, stay foolish.",
      "author": "Steve Jobs"
    }
  ]
}
```

### Full Example Response

```json
{
  "metadata": {
    "source": "My Custom Quotes",
    "description": "Personal quote collection",
    "updated_at": "2026-02-23T10:00:00.000Z"
  },
  "quotes": [
    {
      "_id": "quote-1",
      "author": "Thomas Edison",
      "content": "I never did a day's work in my life. It was all fun.",
      "tags": ["Humorous"],
      "authorSlug": "thomas-edison",
      "length": 52,
      "dateAdded": "2023-04-14",
      "dateModified": "2023-04-14"
    }
  ]
}
```

## Quote Object Fields

### Required

- `content`: non-empty string
- `author`: non-empty string

### Optional

- `_id`: string
- `tags`: array of strings
- `authorSlug`: string
- `length`: number
- `dateAdded`: string
- `dateModified`: string

## Validation and Compatibility Rules

The app validates and normalizes the response before switching data sources.

- `quotes` must exist and be an array
- Quotes missing valid `content` or `author` are discarded
- If `_id` is missing, the app generates a stable ID from quote content/author
- If `tags` is missing or invalid, it is normalized to `[]`
- If all quotes are discarded (0 valid quotes remain), the response is treated as invalid

## Error Conditions (Rejected Responses)

The app rejects the response and keeps using the previous valid dataset when:

- URL is not `https://`
- Network request fails or times out
- Response is not valid JSON
- Top-level `quotes` field is missing
- `quotes` is not an array
- No valid quote remains after normalization

## Recommendations

- Keep the dataset reasonably small for mobile startup and refresh performance
- Prefer stable `_id` values to improve consistency across refreshes
- Include `metadata.updated_at` to make source status clearer in the UI
