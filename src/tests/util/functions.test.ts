import { contactToArray, normalizePhoneNumber } from '../../util/functions';

describe('normalizePhoneNumber', () => {
  const CC = '212';

  it('returns input unchanged when no default country code is configured', () => {
    expect(normalizePhoneNumber('0612345678', undefined)).toBe('0612345678');
  });

  it('keeps a number that already starts with the country code', () => {
    expect(normalizePhoneNumber('212612345678', CC)).toBe('212612345678');
  });

  it('strips a "+" prefix and keeps the international number', () => {
    expect(normalizePhoneNumber('+212612345678', CC)).toBe('212612345678');
  });

  it('strips a leading 0 and prepends the country code', () => {
    expect(normalizePhoneNumber('0612345678', CC)).toBe('212612345678');
  });

  it('prepends the country code to a bare 9-digit local number', () => {
    expect(normalizePhoneNumber('612345678', CC)).toBe('212612345678');
  });

  it('leaves a foreign international number alone', () => {
    // Spanish mobile, already in international form
    expect(normalizePhoneNumber('34611112222', CC)).toBe('34611112222');
  });

  it('discards formatting characters (spaces, dashes, parentheses)', () => {
    expect(normalizePhoneNumber('+212 (6) 12-34-56-78', CC)).toBe(
      '212612345678'
    );
  });

  it('returns the original input when stripped digits are empty', () => {
    expect(normalizePhoneNumber('not-a-number', CC)).toBe('not-a-number');
  });
});

describe('contactToArray', () => {
  it('builds @c.us JIDs from a normalized Moroccan local number', () => {
    expect(contactToArray('0612345678')).toEqual(['212612345678@c.us']);
  });

  it('accepts a comma-separated list and normalizes each entry', () => {
    expect(contactToArray('0612345678, +212712345678')).toEqual([
      '212612345678@c.us',
      '212712345678@c.us',
    ]);
  });

  it('accepts an array input', () => {
    expect(contactToArray(['0612345678', '212712345678'])).toEqual([
      '212612345678@c.us',
      '212712345678@c.us',
    ]);
  });

  it('routes group numbers to @g.us without normalization', () => {
    expect(contactToArray('120363012345678901', true)).toEqual([
      '120363012345678901@g.us',
    ]);
  });

  it('routes newsletter ids to @newsletter without normalization', () => {
    expect(contactToArray('120363098765432109', false, true)).toEqual([
      '120363098765432109@newsletter',
    ]);
  });

  it('routes explicit LIDs to @lid without normalization', () => {
    expect(contactToArray('123456789012345', false, false, true)).toEqual([
      '123456789012345@lid',
    ]);
  });

  it('falls back to @lid when the contact id exceeds 14 digits', () => {
    // 15-digit number — LID territory
    expect(contactToArray('123456789012345')).toEqual(['123456789012345@lid']);
  });
});
