export type QueryResult<T> = {
  data: T[];
  total: number;
  page: number;
};

// Dotted identifiers for word-boundary testing
export const config = {
  'api.baseUrl': 'https://example.com',
  'api.timeout': 5000,
  'app.name': 'search++',
};

// Regex metacharacters in actual code
export const PRICE_REGEX = /\$[\d,]+(\.\d{2})?/;
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Repeated patterns for submatch testing
export const colors = ['red', 'green', 'blue', 'red', 'green', 'blue'];
