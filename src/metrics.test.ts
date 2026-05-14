import { computeDocumentMetrics, aggregateWorkspaceMetrics } from './metrics';
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

function metricsFor(source: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = makeDoc(source) as any;
  return computeDocumentMetrics(doc, parser.parseDocument(doc));
}

describe('provenance metrics', () => {
  it('counts AI-authored guarded code lines', () => {
    const metrics = metricsFor([
      '<pvnc>',
      '  requirement: AI-1',
      '  reason: generated implementation',
      '  source: ai.codex',
      '</pvnc>',
      'function generated() {',
      '  return 1;',
      '}',
    ].join('\n'));

    expect(metrics.hasAi).toBe(true);
    expect(metrics.aiBlockCount).toBe(1);
    expect(metrics.aiLineCount).toBe(3);
    expect(metrics.annotatedLineCount).toBe(3);
  });

  it('keeps human, AI, and unknown file totals separate', () => {
    const human = metricsFor([
      '# pvnc.req: H-1',
      '# pvnc.source: human',
      'def human():',
      '    pass',
    ].join('\n'));
    const ai = metricsFor([
      '# pvnc.req: A-1',
      '# pvnc.source: ai.claude',
      'def ai():',
      '    pass',
    ].join('\n'));
    const unknown = metricsFor([
      '# pvnc.req: U-1',
      'def unknown():',
      '    pass',
    ].join('\n'));

    const total = aggregateWorkspaceMetrics([human, ai, unknown]);
    expect(total.scannedFileCount).toBe(3);
    expect(total.provenanceFileCount).toBe(3);
    expect(total.humanFileCount).toBe(1);
    expect(total.aiFileCount).toBe(1);
    expect(total.unknownFileCount).toBe(1);
  });

  it('flags weak annotation blocks', () => {
    const metrics = metricsFor([
      '<pvnc>',
      '  source: ai.other',
      '</pvnc>',
      'x = 1',
    ].join('\n'));

    expect(metrics.missingRequirementCount).toBe(1);
    expect(metrics.missingReasonCount).toBe(1);
  });
});
