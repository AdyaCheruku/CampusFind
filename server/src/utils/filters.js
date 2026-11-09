/**
 * Tiny helper to build parameterised WHERE clauses safely.
 *   const f = new Filter();
 *   f.add('status = ANY($)', ['A','B']);
 *   `SELECT ... ${f.where()}`, f.params
 * Every value goes through a $n placeholder — never string concatenation.
 */
export class Filter {
  constructor() {
    this.parts = [];
    this.params = [];
  }

  add(sqlWithDollar, value) {
    if (value === undefined || value === null || value === '') return this;
    this.params.push(value);
    this.parts.push(sqlWithDollar.replaceAll('$', `$${this.params.length}`));
    return this;
  }

  where() {
    return this.parts.length ? `WHERE ${this.parts.join(' AND ')}` : '';
  }

  /** Append a parameter (e.g. LIMIT) and return its placeholder. */
  param(value) {
    this.params.push(value);
    return `$${this.params.length}`;
  }
}
