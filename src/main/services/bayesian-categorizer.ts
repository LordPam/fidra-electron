import type { TransactionRow } from '../../shared/ipc-types';
import type { ParsedCsvRow, CategoryPrediction } from '../../shared/csv-import-types';

// ─── Tokenization ────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'that', 'this', 'was', 'are', 'has', 'had',
  'not', 'but', 'have', 'been', 'will', 'can', 'our', 'your', 'all', 'any',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-\/\\.,;:!?()"']+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/** Normalize bank description for mapping lookup: lowercase, collapse whitespace, strip trailing wildcards like asterisks */
function normalizeForMapping(desc: string): string {
  return desc.toLowerCase().replace(/[*]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Normalize for fuzzy matching: lowercase, strip punctuation, collapse whitespace */
function normalizeForMatch(desc: string): string {
  return desc.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/** Check if needle tokens are a substring/subset of haystack */
function fuzzyContains(haystack: string, needle: string): number {
  const h = normalizeForMatch(haystack);
  const n = normalizeForMatch(needle);
  // Exact match
  if (h === n) return 1.0;
  // One contains the other
  if (h.includes(n) || n.includes(h)) return 0.85;
  // Token overlap: what fraction of needle tokens appear in haystack?
  const hTokens = new Set(h.split(' ').filter((t) => t.length >= 3));
  const nTokens = n.split(' ').filter((t) => t.length >= 3);
  if (nTokens.length === 0) return 0;
  let matches = 0;
  for (const t of nTokens) {
    for (const ht of hTokens) {
      if (ht.includes(t) || t.includes(ht)) { matches++; break; }
    }
  }
  return matches / Math.max(nTokens.length, hTokens.size);
}

// ─── Model Types ─────────────────────────────────────────────────────

/** Maps a normalized bank description to user-preferred field values */
interface DescriptionMapping {
  description: string;
  party: string | null;
  category: string | null;
  type: 'income' | 'expense';
}

/** A convention learned from existing transactions: how the user describes this entity */
interface ConventionEntry {
  description: string;
  party: string | null;
  category: string | null;
  type: 'income' | 'expense';
  count: number;
}

interface TokenFrequencyTable {
  /** token → { category → count } */
  tokens: Record<string, Record<string, number>>;
  /** party → most recent category+type */
  partyMap: Record<string, { category: string; type: 'income' | 'expense' }>;
  /** category → total transaction count */
  categoryCounts: Record<string, number>;
  /** category → type distribution { income: number, expense: number } */
  categoryTypes: Record<string, { income: number; expense: number }>;
  /** normalized bank description → user-preferred values (learned from user edits during import) */
  descriptionMap: Record<string, DescriptionMapping>;
  totalTransactions: number;
}

// Not serialized — rebuilt each train() call from existing transactions
type ConventionIndex = Map<string, ConventionEntry>;

// ─── Bayesian Categorizer ────────────────────────────────────────────

export class BayesianCategorizer {
  private model: TokenFrequencyTable;
  /** Convention index: normalized description → most common {description, party, category, type}.
   *  Not serialized — rebuilt each train() from existing transactions. */
  private conventionIndex: ConventionIndex = new Map();

  constructor() {
    this.model = {
      tokens: {},
      partyMap: {},
      categoryCounts: {},
      categoryTypes: {},
      descriptionMap: {},
      totalTransactions: 0,
    };
  }

  train(transactions: TransactionRow[]): void {
    // Preserve descriptionMap across retrains — it's learned from user edits, not from tx data
    const preservedDescriptionMap = this.model.descriptionMap ?? {};
    this.model = {
      tokens: {},
      partyMap: {},
      categoryCounts: {},
      categoryTypes: {},
      descriptionMap: preservedDescriptionMap,
      totalTransactions: 0,
    };
    this.conventionIndex = new Map();

    // Group transactions by normalized description AND party to find conventions.
    // Both are indexed so that a bank description like "WM MORRISONS STORE" can match
    // either an existing description "Morrisons" or an existing party "Morrisons".
    const descGroups = new Map<string, ConventionEntry>();

    const upsertConvention = (key: string, tx: TransactionRow) => {
      const existing = descGroups.get(key);
      if (existing) {
        existing.count++;
        if (tx.category && !existing.category) {
          existing.category = tx.category;
          existing.type = tx.type;
        }
        if (tx.party && !existing.party) {
          existing.party = tx.party;
        }
      } else {
        descGroups.set(key, {
          description: tx.description,
          party: tx.party,
          category: tx.category,
          type: tx.type,
          count: 1,
        });
      }
    };

    for (const tx of transactions) {
      // Index by normalized description
      const normDesc = normalizeForMatch(tx.description);
      if (normDesc.length >= 3) {
        upsertConvention(normDesc, tx);
      }

      // Also index by normalized party (so "WM MORRISONS STORE" can match party "Morrisons")
      if (tx.party) {
        const normParty = normalizeForMatch(tx.party);
        if (normParty.length >= 3 && normParty !== normDesc) {
          upsertConvention(normParty, tx);
        }
      }

      if (!tx.category) continue;

      this.model.totalTransactions++;
      this.model.categoryCounts[tx.category] = (this.model.categoryCounts[tx.category] ?? 0) + 1;

      // Type distribution
      if (!this.model.categoryTypes[tx.category]) {
        this.model.categoryTypes[tx.category] = { income: 0, expense: 0 };
      }
      this.model.categoryTypes[tx.category][tx.type]++;

      // Tokenize description
      const tokens = tokenize(tx.description);
      for (const token of tokens) {
        if (!this.model.tokens[token]) this.model.tokens[token] = {};
        this.model.tokens[token][tx.category] = (this.model.tokens[token][tx.category] ?? 0) + 1;
      }

      // Party mapping (last one wins — most recent category for this party)
      if (tx.party) {
        const normParty = tx.party.toLowerCase().trim();
        this.model.partyMap[normParty] = { category: tx.category, type: tx.type };
      }
    }

    this.conventionIndex = descGroups;
  }

  predict(parsed: ParsedCsvRow): CategoryPrediction {
    const emptyResult: CategoryPrediction = {
      category: null, type: null, confidence: 0, source: 'none',
      suggestedDescription: null, suggestedParty: null,
    };

    // The bank's text to match against — could be in description or party column
    const matchText = parsed.description || parsed.party;

    // Priority 0: Description mapping (learned from user edits during import)
    if (matchText && this.model.descriptionMap) {
      const normDesc = normalizeForMapping(matchText);
      const descMapping = this.model.descriptionMap[normDesc];
      if (descMapping) {
        return {
          category: descMapping.category,
          type: descMapping.type,
          confidence: 0.95,
          source: 'description-mapping',
          suggestedDescription: descMapping.description,
          suggestedParty: descMapping.party,
        };
      }
    }

    // Priority 0.5: Convention matching — fuzzy match bank text against existing transactions
    if (matchText && this.conventionIndex.size > 0) {
      const conventionMatch = this.findConventionMatch(matchText);
      if (conventionMatch) {
        // Use convention for description/party suggestions, but still run category prediction below
        // unless the convention itself has a category
        if (conventionMatch.entry.category) {
          return {
            category: conventionMatch.entry.category,
            type: conventionMatch.entry.type,
            confidence: conventionMatch.confidence,
            source: 'bayesian',
            suggestedDescription: conventionMatch.entry.description,
            suggestedParty: conventionMatch.entry.party,
          };
        }
        // Convention found but no category — carry suggestions through to Bayesian prediction
        emptyResult.suggestedDescription = conventionMatch.entry.description;
        emptyResult.suggestedParty = conventionMatch.entry.party;
      }
    }

    if (this.model.totalTransactions === 0) {
      return emptyResult;
    }

    // Priority 1: Party mapping
    if (parsed.party) {
      const normParty = parsed.party.toLowerCase().trim();
      const partyMatch = this.model.partyMap[normParty];
      if (partyMatch) {
        return {
          category: partyMatch.category,
          type: partyMatch.type,
          confidence: 0.9,
          source: 'party-mapping',
          suggestedDescription: emptyResult.suggestedDescription,
          suggestedParty: emptyResult.suggestedParty,
        };
      }
    }

    // Also try bank text as party lookup (bank descriptions often match party names)
    if (matchText) {
      const normText = matchText.toLowerCase().trim();
      const textPartyMatch = this.model.partyMap[normText];
      if (textPartyMatch) {
        return {
          category: textPartyMatch.category,
          type: textPartyMatch.type,
          confidence: 0.85,
          source: 'party-mapping',
          suggestedDescription: emptyResult.suggestedDescription,
          suggestedParty: emptyResult.suggestedParty,
        };
      }
    }

    // Priority 2: Bayesian prediction from description tokens
    if (!matchText) {
      return emptyResult;
    }

    const tokens = tokenize(matchText);
    if (tokens.length === 0) {
      return emptyResult;
    }

    const categories = Object.keys(this.model.categoryCounts);
    if (categories.length === 0) {
      return emptyResult;
    }

    const vocabSize = Object.keys(this.model.tokens).length;
    const logScores: Record<string, number> = {};

    for (const cat of categories) {
      // Prior: P(category)
      const prior = this.model.categoryCounts[cat] / this.model.totalTransactions;
      let logScore = Math.log(prior);

      // Likelihood: P(token | category) with Laplace smoothing
      const catTotal = this.model.categoryCounts[cat];
      for (const token of tokens) {
        const tokenCatCount = this.model.tokens[token]?.[cat] ?? 0;
        const likelihood = (tokenCatCount + 1) / (catTotal + vocabSize);
        logScore += Math.log(likelihood);
      }

      logScores[cat] = logScore;
    }

    // Convert log scores to probabilities
    const maxLog = Math.max(...Object.values(logScores));
    let sumExp = 0;
    const expScores: Record<string, number> = {};
    for (const cat of categories) {
      expScores[cat] = Math.exp(logScores[cat] - maxLog);
      sumExp += expScores[cat];
    }

    let bestCat = categories[0];
    let bestProb = 0;
    for (const cat of categories) {
      const prob = expScores[cat] / sumExp;
      if (prob > bestProb) {
        bestProb = prob;
        bestCat = cat;
      }
    }

    // Infer type from category's historical distribution
    let type: 'income' | 'expense' | null = null;
    const typeDistrib = this.model.categoryTypes[bestCat];
    if (typeDistrib) {
      const total = typeDistrib.income + typeDistrib.expense;
      if (total > 0) {
        if (typeDistrib.income / total > 0.8) type = 'income';
        else if (typeDistrib.expense / total > 0.8) type = 'expense';
        else type = parsed.type; // Use amount sign
      }
    }
    if (!type) type = parsed.type;

    return {
      category: bestCat,
      type,
      confidence: Math.round(bestProb * 100) / 100,
      source: 'bayesian',
      suggestedDescription: emptyResult.suggestedDescription,
      suggestedParty: emptyResult.suggestedParty,
    };
  }

  /** Find the best matching convention from existing transactions */
  private findConventionMatch(bankDescription: string): { entry: ConventionEntry; confidence: number } | null {
    const normBank = normalizeForMatch(bankDescription);
    if (normBank.length < 3) return null;

    // Exact normalized match
    const exact = this.conventionIndex.get(normBank);
    if (exact) {
      return { entry: exact, confidence: 0.9 };
    }

    // Fuzzy match: find best overlap
    let bestMatch: ConventionEntry | null = null;
    let bestScore = 0;

    for (const [normExisting, entry] of this.conventionIndex) {
      const score = fuzzyContains(normBank, normExisting);
      // Weight by count to prefer more frequent conventions
      const weighted = score * (1 + Math.min(entry.count - 1, 4) * 0.05);
      if (weighted > bestScore && score >= 0.5) {
        bestScore = weighted;
        bestMatch = entry;
      }
    }

    if (bestMatch && bestScore >= 0.5) {
      const confidence = Math.min(Math.round(bestScore * 85) / 100, 0.85);
      return { entry: bestMatch, confidence };
    }

    return null;
  }

  /** Learn a description mapping from user edits during import */
  learnDescriptionMapping(
    bankDescription: string,
    userDescription: string,
    party: string | null,
    category: string | null,
    type: 'income' | 'expense',
  ): void {
    if (!this.model.descriptionMap) this.model.descriptionMap = {};
    const normDesc = normalizeForMapping(bankDescription);
    this.model.descriptionMap[normDesc] = {
      description: userDescription,
      party,
      category,
      type,
    };
  }

  serialize(): string {
    return JSON.stringify(this.model);
  }

  static deserialize(json: string): BayesianCategorizer {
    const instance = new BayesianCategorizer();
    try {
      instance.model = JSON.parse(json);
    } catch {
      // Invalid JSON — return empty model
    }
    return instance;
  }
}
