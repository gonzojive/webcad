export type ASTNode =
  | { const: number }
  | { symbol: string }
  | [ '+' | '-' | '*' | '/' , ASTNode, ASTNode ]; // Using binary nodes for simplicity

export type Token =
  | { type: 'NUMBER'; value: number }
  | { type: 'SYMBOL'; value: string }
  | { type: 'OPERATOR'; value: '+' | '-' | '*' | '/' | '(' | ')' }
  | { type: 'EOF' };

type NumberToken = { type: 'NUMBER'; value: number };
type SymbolToken = { type: 'SYMBOL'; value: string };
type OperatorToken = { type: 'OPERATOR'; value: '+' | '-' | '*' | '/' | '(' | ')' };


export function tokenize(str: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < str.length) {
    const char = str[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (/[+\-*/()]/.test(char)) {
      tokens.push({ type: 'OPERATOR', value: char as any });
      i++;
      continue;
    }
    if (/[0-9.]/.test(char)) {
      let valStr = '';
      if (char === '.') {
         if (i + 1 < str.length && /[0-9]/.test(str[i+1])) {
           valStr += char;
           i++;
         } else {
           throw new Error(`Unexpected character: ${char}`);
         }
      }
      while (i < str.length && /[0-9.]/.test(str[i])) {
        if (str[i] === '.' && valStr.includes('.')) {
          break;
        }
        valStr += str[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(valStr) });
      continue;
    }
    if (/[a-zA-Z'"]/.test(char)) {
      let valStr = '';
      if (char === "'" || char === '"') {
        valStr = char;
        i++;
      } else {
        while (i < str.length && /[a-zA-Z]/.test(str[i])) {
          valStr += str[i];
          i++;
        }
      }
      tokens.push({ type: 'SYMBOL', value: valStr });
      continue;
    }
    throw new Error(`Unexpected character: ${char} at index ${i}`);
  }
  tokens.push({ type: 'EOF' });
  return tokens;
}

class Parser {
  private tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): ASTNode {
    const expr = this.parseExpr();
    if (!this.isAtEnd()) {
      throw new Error(`Unexpected token at end of expression: ${JSON.stringify(this.peek())}`);
    }
    return expr;
  }

  private parseExpr(): ASTNode {
    let node = this.parseImplAddExpr();

    while (this.match('+', '-')) {
      const operator = (this.previous() as OperatorToken).value as '+' | '-';
      const right = this.parseImplAddExpr();
      node = [operator, node, right];
    }

    return node;
  }

  // Implicit addition: e.g. "1ft 3in" -> "1ft + 3in"
  private parseImplAddExpr(): ASTNode {
    let node = this.parseTerm();

    while (this.checkStartOfImplicitAdd()) {
      const right = this.parseTerm();
      node = ['+', node, right];
    }

    return node;
  }

  private checkStartOfImplicitAdd(): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    if (token.type === 'NUMBER' || token.type === 'SYMBOL') {
      return true;
    }
    if (token.type === 'OPERATOR' && token.value === '(') {
      return true;
    }
    return false;
  }

  private parseTerm(): ASTNode {
    let node = this.parseFactor();

    while (this.match('*', '/')) {
      const operator = (this.previous() as OperatorToken).value as '*' | '/';
      const right = this.parseFactor();
      node = [operator, node, right];
    }

    return node;
  }

  private parseFactor(): ASTNode {
    return this.parseUnary();
  }

  private parseUnary(): ASTNode {
    if (this.match('+', '-')) {
      const operator = (this.previous() as OperatorToken).value as '+' | '-';
      const right = this.parseUnary();
      // We can represent unary minus as 0 - right, or we can use a helper.
      // But actually, we can just use negative constants if it is a constant.
      // For general expressions, we can use a special unary operator in AST,
      // or we can simulate it with binary operator: ['-', {const: 0}, right].
      // Let's use ['-', {const: 0}, right] for simplicity, or just support it in evaluator.
      // Actually, if we have "-1ft", it is parsed as unary '-' then Primary(1ft).
      // Primary(1ft) -> ['*', 1, ft].
      // So unary '-' on that -> ['-', {const: 0}, ['*', 1, ft]].
      // This is correct: 0 - 1ft.
      return [operator, { const: 0 }, right];
    }

    return this.parsePrimary();
  }

  private parsePrimary(): ASTNode {
    if (this.matchType('NUMBER')) {
      const numToken = this.previous() as NumberToken;
      const constNode: ASTNode = { const: numToken.value };
      
      // Check for implicit multiplication: NUMBER followed by SYMBOL (e.g. 1ft)
      if (this.matchType('SYMBOL')) {
        const symbolToken = this.previous() as SymbolToken;
        return ['*', constNode, { symbol: symbolToken.value }];
      }
      
      return constNode;
    }

    if (this.matchType('SYMBOL')) {
      return { symbol: (this.previous() as SymbolToken).value };
    }

    if (this.match('(')) {
      const expr = this.parseExpr();
      this.consume(')', "Expect ')' after expression.");
      return expr;
    }

    throw new Error(`Expect expression at token: ${JSON.stringify(this.peek())}`);
  }

  private checkStartOfExpression(): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    
    // A new expression can start with NUMBER, SYMBOL, '(', or unary '+', '-'
    if (token.type === 'NUMBER' || token.type === 'SYMBOL') {
      return true;
    }
    if (token.type === 'OPERATOR') {
      return token.value === '(' || token.value === '+' || token.value === '-';
    }
    return false;
  }

  private match(...operators: string[]): boolean {
    for (const op of operators) {
      if (this.checkOperator(op)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  private matchType(type: Token['type']): boolean {
    if (this.checkType(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private checkOperator(op: string): boolean {
    if (this.isAtEnd()) return false;
    const token = this.peek();
    return token.type === 'OPERATOR' && token.value === op;
  }

  private checkType(type: Token['type']): boolean {
    if (this.isAtEnd()) return false;
    return this.peek().type === type;
  }

  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.peek().type === 'EOF';
  }

  private peek(): Token {
    return this.tokens[this.current];
  }

  private previous(): Token {
    return this.tokens[this.current - 1];
  }

  private consume(op: string, message: string): Token {
    if (this.checkOperator(op)) return this.advance();
    throw new Error(message);
  }
}

export function parse(str: string): ASTNode {
  const tokens = tokenize(str);
  const parser = new Parser(tokens);
  return parser.parse();
}

export interface EvalResult {
  value: number;
  dim: number;
}

export function evaluate(
  node: ASTNode,
  context: Record<string, number>,
  defaultUnitValue: number,
  isDimensionless = false
): EvalResult {
  if ('const' in node) {
    if (isDimensionless) {
      return { value: node.const, dim: 0 };
    } else {
      return { value: node.const * defaultUnitValue, dim: 1 };
    }
  }
  if ('symbol' in node) {
    const val = context[node.symbol.toLowerCase()]; // Case-insensitive symbol lookup
    if (val === undefined) {
      throw new Error(`Unknown symbol: ${node.symbol}`);
    }
    return { value: val, dim: 1 };
  }

  const [op, left, right] = node;
  
  if (op === '+' || op === '-') {
    const leftRes = evaluate(left, context, defaultUnitValue, false);
    const rightRes = evaluate(right, context, defaultUnitValue, false);
    if (leftRes.dim !== rightRes.dim) {
      throw new Error(`Dimension mismatch: cannot ${op === '+' ? 'add' : 'subtract'} dimension ${leftRes.dim} and ${rightRes.dim}`);
    }
    return {
      value: op === '+' ? leftRes.value + rightRes.value : leftRes.value - rightRes.value,
      dim: leftRes.dim
    };
  } else if (op === '*' || op === '/') {
    const leftRes = evaluate(left, context, defaultUnitValue, true);
    const rightRes = evaluate(right, context, defaultUnitValue, true);
    return {
      value: op === '*' ? leftRes.value * rightRes.value : leftRes.value / rightRes.value,
      dim: op === '*' ? leftRes.dim + rightRes.dim : leftRes.dim - rightRes.dim
    };
  }

  throw new Error(`Unknown operator: ${op}`);
}

