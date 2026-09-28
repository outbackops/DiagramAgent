export type KeywordExpectation = string | string[];

export interface KeywordCoverage {
  total: number;
  matched: number;
  ratio: number;
  missing: KeywordExpectation[];
  matchedKeywords: KeywordExpectation[];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function alternatives(expectation: KeywordExpectation): string[] {
  return Array.isArray(expectation) ? expectation : [expectation];
}

export function matchesKeyword(haystack: string, expectation: KeywordExpectation): boolean {
  const normalizedHaystack = ` ${normalize(haystack)} `;
  return alternatives(expectation).some((keyword) => {
    const normalizedKeyword = normalize(keyword);
    return normalizedKeyword.length > 0 && normalizedHaystack.includes(` ${normalizedKeyword} `);
  });
}

export function calculateKeywordCoverage(code: string, keywords: KeywordExpectation[]): KeywordCoverage {
  const matchedKeywords: KeywordExpectation[] = [];
  const missing: KeywordExpectation[] = [];

  for (const keyword of keywords) {
    if (matchesKeyword(code, keyword)) {
      matchedKeywords.push(keyword);
    } else {
      missing.push(keyword);
    }
  }

  const total = keywords.length;
  const matched = matchedKeywords.length;
  return {
    total,
    matched,
    ratio: total === 0 ? 1 : matched / total,
    missing,
    matchedKeywords,
  };
}
