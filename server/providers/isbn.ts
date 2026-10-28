/**
 * Turns what a person or a source writes as an ISBN into the 13-digit form, or null when it is not
 * one. Hyphens and spaces are ignored, an ISBN-10 is converted to ISBN-13, and the check digit
 * must be right, so a random number is not taken for a book. Shared by every book source.
 */
export function normalizeIsbn(raw: string): string | null {
  const text = raw.replace(/[\s-]/g, "").toUpperCase();

  if (/^[0-9]{9}[0-9X]$/.test(text)) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      const digit = text[i] === "X" ? 10 : Number(text[i]);
      sum += digit * (10 - i);
    }
    if (sum % 11 !== 0) return null;
    const body = `978${text.slice(0, 9)}`;
    return `${body}${isbn13CheckDigit(body)}`;
  }

  if (/^97[89][0-9]{10}$/.test(text)) {
    return isbn13CheckDigit(text.slice(0, 12)) === text[12] ? text : null;
  }

  return null;
}

function isbn13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}
