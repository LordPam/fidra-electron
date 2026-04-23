import type { TransactionRow } from '../../shared/ipc-types';

enum TokenType {
  TERM = 'TERM',
  AND = 'AND',
  OR = 'OR',
  NOT = 'NOT',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
}

interface Token {
  type: TokenType;
  value: string;
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  query = query.trim();

  while (i < query.length) {
    if (query[i] === ' ' || query[i] === '\t') {
      i++;
      continue;
    }

    if (query[i] === '(') {
      tokens.push({ type: TokenType.LPAREN, value: '(' });
      i++;
      continue;
    }

    if (query[i] === ')') {
      tokens.push({ type: TokenType.RPAREN, value: ')' });
      i++;
      continue;
    }

    if (query[i] === '"') {
      i++; // skip opening quote
      const start = i;
      while (i < query.length && query[i] !== '"') i++;
      const phrase = query.slice(start, i);
      if (i < query.length) i++; // skip closing quote
      if (phrase) tokens.push({ type: TokenType.TERM, value: phrase });
      continue;
    }

    const start = i;
    while (i < query.length && query[i] !== ' ' && query[i] !== '\t' && !'()"'.includes(query[i])) {
      i++;
    }

    const word = query.slice(start, i);
    const upper = word.toUpperCase();

    if (upper === 'AND') tokens.push({ type: TokenType.AND, value: 'AND' });
    else if (upper === 'OR') tokens.push({ type: TokenType.OR, value: 'OR' });
    else if (upper === 'NOT') tokens.push({ type: TokenType.NOT, value: 'NOT' });
    else tokens.push({ type: TokenType.TERM, value: word });
  }

  return tokens;
}

const PRECEDENCE: Record<string, number> = {
  [TokenType.NOT]: 3,
  [TokenType.AND]: 2,
  [TokenType.OR]: 1,
};

function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const ops: Token[] = [];

  for (const token of tokens) {
    if (token.type === TokenType.TERM) {
      output.push(token);
    } else if (
      token.type === TokenType.AND ||
      token.type === TokenType.OR ||
      token.type === TokenType.NOT
    ) {
      while (
        ops.length > 0 &&
        ops[ops.length - 1].type !== TokenType.LPAREN &&
        (PRECEDENCE[ops[ops.length - 1].type] ?? 0) >= PRECEDENCE[token.type]
      ) {
        output.push(ops.pop()!);
      }
      ops.push(token);
    } else if (token.type === TokenType.LPAREN) {
      ops.push(token);
    } else if (token.type === TokenType.RPAREN) {
      while (ops.length > 0 && ops[ops.length - 1].type !== TokenType.LPAREN) {
        output.push(ops.pop()!);
      }
      if (ops.length > 0) ops.pop(); // remove LPAREN
    }
  }

  while (ops.length > 0) output.push(ops.pop()!);
  return output;
}

function getSearchableText(t: TransactionRow): string {
  const parts = [t.description, t.amount, t.type, t.status];
  if (t.category) parts.push(t.category);
  if (t.party) parts.push(t.party);
  if (t.reference) parts.push(t.reference);
  if (t.activity) parts.push(t.activity);
  if (t.notes) parts.push(t.notes);
  return parts.join(' ');
}

function compileMatcher(rpn: Token[]): (t: TransactionRow) => boolean {
  return (transaction: TransactionRow) => {
    const stack: boolean[] = [];
    const text = getSearchableText(transaction).toLowerCase();

    for (const token of rpn) {
      if (token.type === TokenType.TERM) {
        stack.push(text.includes(token.value.toLowerCase()));
      } else if (token.type === TokenType.AND) {
        if (stack.length < 2) return false;
        const right = stack.pop()!;
        const left = stack.pop()!;
        stack.push(left && right);
      } else if (token.type === TokenType.OR) {
        if (stack.length < 2) return false;
        const right = stack.pop()!;
        const left = stack.pop()!;
        stack.push(left || right);
      } else if (token.type === TokenType.NOT) {
        if (stack.length < 1) return false;
        stack.push(!stack.pop()!);
      }
    }

    return stack.length > 0 ? stack[0] : false;
  };
}

export function searchTransactions(
  transactions: TransactionRow[],
  query: string,
): TransactionRow[] {
  if (!query || !query.trim()) return transactions;

  try {
    const tokens = tokenize(query);
    const rpn = toRPN(tokens);
    const matcher = compileMatcher(rpn);
    return transactions.filter(matcher);
  } catch {
    return transactions;
  }
}
