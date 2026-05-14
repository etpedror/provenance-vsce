import { AiContextAnnotation } from './types';
import * as parser from './parser';

function makeDoc(source: string) {
  const lines = source.split('\n');
  return {
    getText: () => source,
    get lineCount() { return lines.length; },
    lineAt: (i: number) => ({ text: lines[i] ?? '' }),
    positionAt: (offset: number) => {
      const before = source.slice(0, offset).split('\n');
      return { line: before.length - 1, character: before[before.length - 1].length };
    },
    offsetAt: (pos: { line: number; character: number }) => {
      let off = 0;
      for (let i = 0; i < pos.line; i++) off += (lines[i]?.length ?? 0) + 1;
      return off + pos.character;
    },
    version: 1,
    uri: { toString: () => `test://${Math.random()}` },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parse = (src: string): AiContextAnnotation[] => parser.parseDocument(makeDoc(src) as any);

// ── XML block format ──────────────────────────────────────────────────────────

describe('XML block — basics', () => {
  it('parses requirement, reason, source', () => {
    const src = `
      <pvnc>
          requirement: USER-42 (jira, 2024-Q1)
          reason: Initial implementation
          source: human
      </pvnc>
      pass
    `;
    const [ann] = parse(src);
    expect(ann.blocks).toHaveLength(1);
    const b = ann.blocks[0];
    expect(b.requirements[0]).toMatchObject({ id: 'USER-42', system: 'jira', date: '2024-Q1' });
    expect(b.reasons[0]).toBe('Initial implementation');
    expect(b.source).toBe('human');
    expect(b.doNotChange).toBeUndefined();
  });

  it('parses requirement with id only (no parens)', () => {
    const src = `<pvnc>\nrequirement: TICKET-7\n</pvnc>`;
    const b = parse(src)[0].blocks[0];
    expect(b.requirements[0].id).toBe('TICKET-7');
    expect(b.requirements[0].system).toBeUndefined();
  });

  it('parses do-not-change and sets hasDoNotChange', () => {
    const src = `
      <pvnc>
          requirement: TAX-99 (ado)
          do-not-change: HMRC compliance — audited 2024-03
      </pvnc>
    `;
    const ann = parse(src)[0];
    expect(ann.hasDoNotChange).toBe(true);
    expect(ann.blocks[0].doNotChange).toBe('HMRC compliance — audited 2024-03');
  });

  it('parses invariant', () => {
    const src = `<pvnc>\ninvariant: Result must never be negative\n</pvnc>`;
    expect(parse(src)[0].blocks[0].invariants[0]).toBe('Result must never be negative');
  });

  it('parses see-also as a comma-separated list', () => {
    const src = `<pvnc>\nsee-also: billing/calc.py#round_tax, USER-1062\n</pvnc>`;
    expect(parse(src)[0].blocks[0].seeAlso).toEqual(['billing/calc.py#round_tax', 'USER-1062']);
  });

  it('strips leading * comment markers', () => {
    const src = `
      /**
       * <pvnc>
       * requirement: DOC-1 (github, 2025-01)
       * reason: Inside a JSDoc block
       * source: ai.claude
       * </pvnc>
       */
    `;
    const b = parse(src)[0].blocks[0];
    expect(b.requirements[0].id).toBe('DOC-1');
    expect(b.reasons[0]).toBe('Inside a JSDoc block');
    expect(b.source).toBe('ai.claude');
  });
});

describe('XML block — independence', () => {
  it('keeps consecutive blocks as separate annotations (no grouping)', () => {
    const src = `
      """
      <pvnc>
          requirement: USER-1062 (jira, 2024-Q1)
          reason: HMRC food exemptions
          source: human
      </pvnc>
      <pvnc>
          requirement: USER-1092 (jira, 2025-Q3)
          reason: Sugar threshold added
      </pvnc>
      """
      if order.category == "food":
          pass
    `;
    const anns = parse(src);
    // Each XML block is its own annotation — gutter icons are independent
    expect(anns).toHaveLength(2);
    expect(anns[0].blocks[0].requirements[0].id).toBe('USER-1062');
    expect(anns[0].blocks[0].source).toBe('human');
    expect(anns[1].blocks[0].requirements[0].id).toBe('USER-1092');
    expect(anns[1].blocks[0].source).toBeUndefined(); // does not inherit from sibling
  });

  it('keeps non-consecutive blocks separate', () => {
    const src = `
      <pvnc>
          requirement: A-1 (jira)
      </pvnc>
      def foo(): pass

      <pvnc>
          requirement: B-2 (jira)
      </pvnc>
      def bar(): pass
    `;
    const anns = parse(src);
    expect(anns).toHaveLength(2);
    expect(anns[0].blocks[0].requirements[0].id).toBe('A-1');
    expect(anns[1].blocks[0].requirements[0].id).toBe('B-2');
  });
});

// ── pvnc inline format ────────────────────────────────────────────────────────

describe('pvnc inline — basics', () => {
  it('parses a single pvnc run', () => {
    const src = [
      '# pvnc.req: USER-1092 (jira, 2025-Q3)',
      '# pvnc.reason: Sugar threshold — high sugar foods excluded',
      '# pvnc.do-not-change: HMRC compliance',
      '# pvnc.source: ai.claude',
      'if order.sugar_content <= 2:',
      '    pass',
    ].join('\n');
    const [ann] = parse(src);
    expect(ann.blocks).toHaveLength(1);
    const b = ann.blocks[0];
    expect(b.requirements[0]).toMatchObject({ id: 'USER-1092', system: 'jira', date: '2025-Q3' });
    expect(b.reasons[0]).toBe('Sugar threshold — high sugar foods excluded');
    expect(b.doNotChange).toBe('HMRC compliance');
    expect(b.source).toBe('ai.claude');
    expect(ann.hasDoNotChange).toBe(true);
  });

  it('supports pvnc shorthands (req, dnc, inv)', () => {
    const src = [
      '# pvnc.req: SHORT-1',
      '# pvnc.dnc: do not touch',
      '# pvnc.inv: must not be negative',
      'x = 1',
    ].join('\n');
    const b = parse(src)[0].blocks[0];
    expect(b.requirements[0].id).toBe('SHORT-1');
    expect(b.doNotChange).toBe('do not touch');
    expect(b.invariants[0]).toBe('must not be negative');
  });

  it('works with // comment style (Go, Rust, TypeScript…)', () => {
    const src = [
      '// pvnc.req: PAY-88 (github, 2025-01)',
      '// pvnc.source: human',
      'func verify() {}',
    ].join('\n');
    const b = parse(src)[0].blocks[0];
    expect(b.requirements[0].id).toBe('PAY-88');
    expect(b.source).toBe('human');
  });

  it('parses see-also in pvnc format', () => {
    const src = '# pvnc.see: billing/calc.py#round_tax, USER-1062\nx = 1';
    expect(parse(src)[0].blocks[0].seeAlso).toEqual(['billing/calc.py#round_tax', 'USER-1062']);
  });

  it('guarded zone starts on the line after the run', () => {
    const src = [
      '# pvnc.req: G-1',
      'def foo():',
      '    pass',
    ].join('\n');
    const ann = parse(src)[0];
    expect(ann.annotationEndLine).toBe(0);
    expect(ann.guardedStartLine).toBe(1);
  });
});

describe('pvnc inline — grouping', () => {
  it('merges two runs separated by a blank line into one annotation', () => {
    const src = [
      '# pvnc.req: USER-1062',
      '# pvnc.reason: HMRC food exemptions',
      '',
      '# pvnc.req: USER-1092',
      '# pvnc.reason: Sugar threshold added',
      'if order.category == "food":',
      '    pass',
    ].join('\n');
    const anns = parse(src);
    expect(anns).toHaveLength(1);
    expect(anns[0].blocks).toHaveLength(2);
    expect(anns[0].blocks[0].requirements[0].id).toBe('USER-1062');
    expect(anns[0].blocks[1].requirements[0].id).toBe('USER-1092');
  });

  it('does not merge runs separated by non-comment code', () => {
    const src = [
      '# pvnc.req: A-1',
      'x = 1',
      '# pvnc.req: B-2',
      'y = 2',
    ].join('\n');
    expect(parse(src)).toHaveLength(2);
  });
});

// ── Coexistence ───────────────────────────────────────────────────────────────

describe('XML and pvnc coexistence', () => {
  it('parses both formats in the same file', () => {
    const src = [
      '<pvnc>',
      '    requirement: XML-1',
      '</pvnc>',
      'def foo(): pass',
      '',
      '# pvnc.req: PVNC-2',
      '# pvnc.source: ai.claude',
      'def bar(): pass',
    ].join('\n');
    const anns = parse(src);
    expect(anns).toHaveLength(2);
    expect(anns[0].blocks[0].requirements[0].id).toBe('XML-1');
    expect(anns[1].blocks[0].requirements[0].id).toBe('PVNC-2');
    expect(anns[1].blocks[0].source).toBe('ai.claude');
  });
});

// ── <provenance> tag alias ────────────────────────────────────────────────────

describe('<provenance> tag alias', () => {
  it('parses <provenance>...</provenance> identically to <pvnc>', () => {
    const src = `
      <provenance>
          requirement: USER-99 (jira, 2025-Q2)
          reason: Alternative tag form
          source: human
      </provenance>
      pass
    `;
    const [ann] = parse(src);
    expect(ann.blocks).toHaveLength(1);
    const b = ann.blocks[0];
    expect(b.requirements[0]).toMatchObject({ id: 'USER-99', system: 'jira', date: '2025-Q2' });
    expect(b.reasons[0]).toBe('Alternative tag form');
    expect(b.source).toBe('human');
  });

  it('treats mixed <pvnc> and <provenance> blocks as independent annotations', () => {
    const src = `
      """
      <pvnc>
          requirement: A-1 (jira, 2024-Q1)
          reason: First entry
          source: human
      </pvnc>
      <provenance>
          requirement: A-2 (jira, 2025-Q1)
          reason: Second entry
          source: ai.claude
      </provenance>
      """
      def foo(): pass
    `;
    const anns = parse(src);
    expect(anns).toHaveLength(2);
    expect(anns[0].blocks[0].requirements[0].id).toBe('A-1');
    expect(anns[0].blocks[0].source).toBe('human');
    expect(anns[1].blocks[0].requirements[0].id).toBe('A-2');
    expect(anns[1].blocks[0].source).toBe('ai.claude');
  });
});

// ── Contract ──────────────────────────────────────────────────────────────────

describe('ALLOWED_KEYS', () => {
  it('covers all six keys', () => {
    expect(parser.ALLOWED_KEYS).toEqual(
      expect.arrayContaining(['requirement', 'reason', 'invariant', 'do-not-change', 'source', 'see-also']),
    );
  });
});
