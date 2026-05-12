import { describe, it, expect } from 'vitest';
import { BayesianCategorizer } from '../bayesian-categorizer';
import type { TransactionRow } from '../../../shared/ipc-types';
import type { ParsedCsvRow } from '../../../shared/csv-import-types';

function makeTx(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: crypto.randomUUID(),
    date: '2024-01-15',
    description: 'Coffee shop',
    amount: '4.50',
    type: 'expense',
    status: '--',
    sheet: 'Main',
    category: null,
    party: null,
    reference: null,
    activity: null,
    notes: null,
    version: 1,
    created_at: '2024-01-15T00:00:00Z',
    modified_at: null,
    modified_by: null,
    ...overrides,
  };
}

function makeParsed(overrides: Partial<ParsedCsvRow> = {}): ParsedCsvRow {
  return {
    rowIndex: 0,
    rawValues: [],
    date: '2024-01-15',
    description: 'Coffee shop',
    amount: 4.50,
    type: 'expense',
    reference: null,
    party: null,
    notes: null,
    category: null,
    parseErrors: [],
    ...overrides,
  };
}

describe('BayesianCategorizer', () => {
  it('predicts nothing with no training data', () => {
    const c = new BayesianCategorizer();
    const result = c.predict(makeParsed());
    expect(result.category).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.source).toBe('none');
  });

  it('predicts based on description tokens', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'Coffee shop downtown', category: 'Food & Drink' }),
      makeTx({ description: 'Coffee morning break', category: 'Food & Drink' }),
      makeTx({ description: 'Office supplies store', category: 'Equipment' }),
    ]);

    const result = c.predict(makeParsed({ description: 'Coffee at the office' }));
    expect(result.category).toBe('Food & Drink');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.source).toBe('bayesian');
  });

  it('uses party mapping when party matches', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'Payment', party: 'Starbucks', category: 'Food & Drink', type: 'expense' }),
      makeTx({ description: 'Something else', party: 'Amazon', category: 'Equipment', type: 'expense' }),
    ]);

    const result = c.predict(makeParsed({ party: 'Starbucks', description: 'Random text' }));
    expect(result.category).toBe('Food & Drink');
    expect(result.confidence).toBe(0.9);
    expect(result.source).toBe('party-mapping');
  });

  it('serialize and deserialize round-trip', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'Coffee shop', category: 'Food & Drink' }),
      makeTx({ description: 'Office supplies', category: 'Equipment' }),
    ]);

    const json = c.serialize();
    const restored = BayesianCategorizer.deserialize(json);
    const result = restored.predict(makeParsed({ description: 'Coffee order' }));
    expect(result.category).toBe('Food & Drink');
    expect(result.source).toBe('bayesian');
  });

  it('handles deserialization of invalid JSON gracefully', () => {
    const restored = BayesianCategorizer.deserialize('invalid json');
    const result = restored.predict(makeParsed());
    expect(result.category).toBeNull();
    expect(result.source).toBe('none');
  });

  it('infers type from category history', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'Salary payment', category: 'Salary', type: 'income' }),
      makeTx({ description: 'Salary bonus', category: 'Salary', type: 'income' }),
      makeTx({ description: 'Salary regular', category: 'Salary', type: 'income' }),
    ]);

    const result = c.predict(makeParsed({ description: 'Salary payment', type: 'expense' }));
    expect(result.category).toBe('Salary');
    expect(result.type).toBe('income'); // Overrides parsed type because 100% income
  });

  it('skips transactions without category during training', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'No category', category: null }),
      makeTx({ description: 'Has category', category: 'Food' }),
    ]);

    const result = c.predict(makeParsed({ description: 'Has category similar' }));
    expect(result.category).toBe('Food');
  });

  it('uses description mapping with highest priority', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'Coffee shop', category: 'Food & Drink', type: 'expense' }),
    ]);

    // Learn a description mapping
    c.learnDescriptionMapping(
      'WM MORRISONS STORE',
      'Morrisons',
      'Morrisons',
      'Groceries',
      'expense',
    );

    const result = c.predict(makeParsed({ description: 'WM MORRISONS STORE' }));
    expect(result.category).toBe('Groceries');
    expect(result.suggestedDescription).toBe('Morrisons');
    expect(result.suggestedParty).toBe('Morrisons');
    expect(result.confidence).toBe(0.95);
    expect(result.source).toBe('description-mapping');
  });

  it('description mapping survives train() rebuild', () => {
    const c = new BayesianCategorizer();
    c.learnDescriptionMapping('SumUp *st andrews', 'St Andrews Coffee', null, 'Food & Drink', 'expense');

    // Retrain — should preserve description mappings
    c.train([
      makeTx({ description: 'Something', category: 'Other' }),
    ]);

    const result = c.predict(makeParsed({ description: 'SumUp *st andrews' }));
    expect(result.source).toBe('description-mapping');
    expect(result.suggestedDescription).toBe('St Andrews Coffee');
  });

  it('description mapping survives serialize/deserialize', () => {
    const c = new BayesianCategorizer();
    c.learnDescriptionMapping('SHELL 3 BRIDGE STR', 'Shell petrol', null, 'Transport', 'expense');

    const json = c.serialize();
    const restored = BayesianCategorizer.deserialize(json);

    const result = restored.predict(makeParsed({ description: 'SHELL 3 BRIDGE STR' }));
    expect(result.source).toBe('description-mapping');
    expect(result.suggestedDescription).toBe('Shell petrol');
    expect(result.category).toBe('Transport');
  });

  it('suggests description and party from existing transaction conventions', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'Morrisons', party: 'Morrisons', category: 'Groceries', type: 'expense' }),
      makeTx({ description: 'Morrisons', party: 'Morrisons', category: 'Groceries', type: 'expense' }),
      makeTx({ description: 'Shell petrol', party: 'Shell', category: 'Transport', type: 'expense' }),
    ]);

    // Bank description "WM MORRISONS STORE" should fuzzy-match existing "Morrisons"
    const result = c.predict(makeParsed({ description: 'WM MORRISONS STORE' }));
    expect(result.suggestedDescription).toBe('Morrisons');
    expect(result.suggestedParty).toBe('Morrisons');
    expect(result.category).toBe('Groceries');
  });

  it('suggests party from exact convention match', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'BMA Association', party: 'BMA', category: 'Education & study', type: 'expense' }),
      makeTx({ description: 'BMA Association', party: 'BMA', category: 'Education & study', type: 'expense' }),
    ]);

    const result = c.predict(makeParsed({ description: 'BMA ASSOCIATION' }));
    expect(result.suggestedDescription).toBe('BMA Association');
    expect(result.suggestedParty).toBe('BMA');
    expect(result.category).toBe('Education & study');
  });

  it('matches bank description against existing party field', () => {
    const c = new BayesianCategorizer();
    c.train([
      // Description is "Weekly shop" but party is "Morrisons" — the party should be the match key
      makeTx({ description: 'Weekly shop', party: 'Morrisons', category: 'Groceries', type: 'expense' }),
      makeTx({ description: 'Weekly shop', party: 'Morrisons', category: 'Groceries', type: 'expense' }),
    ]);

    // "WM MORRISONS STORE" should match against party "Morrisons"
    const result = c.predict(makeParsed({ description: 'WM MORRISONS STORE' }));
    expect(result.suggestedDescription).toBe('Weekly shop');
    expect(result.suggestedParty).toBe('Morrisons');
    expect(result.category).toBe('Groceries');
  });

  it('convention match carries description/party through to bayesian prediction', () => {
    const c = new BayesianCategorizer();
    c.train([
      // Tesco with party but no category — convention has no category
      makeTx({ description: 'Tesco', party: 'Tesco', category: null }),
      // Other categorized transactions for Bayesian to work with
      makeTx({ description: 'Coffee shop', category: 'Food & Drink' }),
      makeTx({ description: 'Office supplies', category: 'Equipment' }),
    ]);

    // "TESCO STORES 3196" should fuzzy-match "Tesco", get suggested description/party,
    // and category should come from Bayesian prediction
    const result = c.predict(makeParsed({ description: 'TESCO STORES 3196' }));
    expect(result.suggestedDescription).toBe('Tesco');
    expect(result.suggestedParty).toBe('Tesco');
    // Category comes from Bayesian — won't be null since there are trained categories
    expect(result.category).not.toBeNull();
  });

  it('convention matching works when bank text is in party field instead of description', () => {
    const c = new BayesianCategorizer();
    c.train([
      makeTx({ description: 'Morrisons', party: 'Morrisons', category: 'Groceries', type: 'expense' }),
    ]);

    // CSV column mapped as party, not description
    const result = c.predict(makeParsed({ description: null, party: 'WM MORRISONS STORE' }));
    expect(result.suggestedDescription).toBe('Morrisons');
    expect(result.suggestedParty).toBe('Morrisons');
    expect(result.category).toBe('Groceries');
  });

  it('description mapping normalizes asterisks and whitespace', () => {
    const c = new BayesianCategorizer();
    c.learnDescriptionMapping('SumUp  *st andrews', 'St Andrews Cafe', null, 'Food', 'expense');

    // Same description with different spacing should still match
    const result = c.predict(makeParsed({ description: 'SumUp *st andrews' }));
    expect(result.source).toBe('description-mapping');
    expect(result.suggestedDescription).toBe('St Andrews Cafe');
  });
});
