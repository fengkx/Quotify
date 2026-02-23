const DEFAULT_METADATA = {};

const hashString = (input) => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash).toString(36);
};

const normalizeTags = (tags) => {
  if (!Array.isArray(tags)) {
    return [];
  }

  return Array.from(new Set(tags
    .filter(tag => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean)));
};

const normalizeQuote = (quote, index) => {
  if (!quote || typeof quote !== 'object') {
    return null;
  }

  const content = typeof quote.content === 'string' ? quote.content.trim() : '';
  const author = typeof quote.author === 'string' ? quote.author.trim() : '';

  if (!content || !author) {
    return null;
  }

  const id = typeof quote._id === 'string' && quote._id.trim()
    ? quote._id.trim()
    : `generated-${hashString(`${author}:${content}:${index}`)}`;

  return {
    ...quote,
    _id: id,
    content,
    author,
    tags: normalizeTags(quote.tags),
  };
};

export const VALIDATION_ERROR_CODES = {
  INVALID_JSON: 'INVALID_JSON',
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  NO_VALID_QUOTES: 'NO_VALID_QUOTES',
};

export function validateAndNormalizeQuotePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      error: {
        code: VALIDATION_ERROR_CODES.INVALID_SCHEMA,
        message: 'Response body must be a JSON object.',
      },
    };
  }

  if (!Array.isArray(payload.quotes)) {
    return {
      ok: false,
      error: {
        code: VALIDATION_ERROR_CODES.INVALID_SCHEMA,
        message: 'Response JSON must contain a "quotes" array.',
      },
    };
  }

  const normalizedQuotes = payload.quotes
    .map((quote, index) => normalizeQuote(quote, index))
    .filter(Boolean);

  if (normalizedQuotes.length === 0) {
    return {
      ok: false,
      error: {
        code: VALIDATION_ERROR_CODES.NO_VALID_QUOTES,
        message: 'Response does not contain any valid quotes after normalization.',
      },
      stats: {
        total: payload.quotes.length,
        valid: 0,
        dropped: payload.quotes.length,
      },
    };
  }

  return {
    ok: true,
    data: {
      metadata: payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
        ? payload.metadata
        : DEFAULT_METADATA,
      quotes: normalizedQuotes,
    },
    stats: {
      total: payload.quotes.length,
      valid: normalizedQuotes.length,
      dropped: payload.quotes.length - normalizedQuotes.length,
    },
  };
}
