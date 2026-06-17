import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DiffFile } from '../../types/diff';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';
import type { MergedChunk } from '../hooks/useExpandedLines';

import { HtmlDiffViewer } from './HtmlDiffViewer';
import type { DiffViewerBodyProps } from './types';

const makeFile = (overrides: Partial<DiffFile> = {}): DiffFile => ({
  path: 'index.html',
  status: 'modified',
  additions: 1,
  deletions: 0,
  chunks: [],
  ...overrides,
});

const makeMergedChunks = (lines: Array<{ type: string; content: string }>): MergedChunk[] => [
  {
    header: '@@ -1 +1 @@',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: lines.map((l) => ({
      type: l.type as any,
      content: l.content,
      oldLineNumber: undefined,
      newLineNumber: undefined,
    })),
    originalIndices: [0],
    hiddenLinesBefore: 0,
    hiddenLinesAfter: 0,
  },
];

const makeProps = (overrides: Partial<DiffViewerBodyProps> = {}): DiffViewerBodyProps => ({
  file: makeFile(),
  threads: [],
  diffMode: 'unified',
  mergedChunks: makeMergedChunks([
    { type: 'add', content: '<h1>Hello</h1>' },
    { type: 'context', content: '<p>World</p>' },
  ]),
  isExpandLoading: false,
  expandHiddenLines: vi.fn(),
  expandAllBetweenChunks: vi.fn(),
  onAddComment: vi.fn(),
  onGenerateThreadPrompt: vi.fn().mockReturnValue(''),
  onRemoveThread: vi.fn(),
  onReplyToThread: vi.fn(),
  onRemoveMessage: vi.fn(),
  onUpdateMessage: vi.fn(),
  baseCommitish: 'abc123',
  targetCommitish: 'def456',
  ...overrides,
});

const renderViewer = (overrides: Partial<DiffViewerBodyProps> = {}) =>
  render(
    <WordHighlightProvider>
      <HtmlDiffViewer {...makeProps(overrides)} />
    </WordHighlightProvider>,
  );

const expectPreviewCsp = (srcdoc: string | null | undefined) => {
  expect(srcdoc).toContain('Content-Security-Policy');
  expect(srcdoc).toContain(`default-src 'none'`);
  expect(srcdoc).toContain(`style-src 'unsafe-inline'`);
  expect(srcdoc).toContain('img-src data: blob:');
};

const expectCspInDocumentHead = (
  srcdoc: string | null | undefined,
  options: { hasDoctype?: boolean } = {},
) => {
  const normalizedSrcdoc = srcdoc?.toLowerCase() ?? '';
  if (options.hasDoctype) {
    expect(normalizedSrcdoc.startsWith('<!doctype html>')).toBe(true);
  }
  const htmlIndex = normalizedSrcdoc.indexOf('<html');
  const headIndex = normalizedSrcdoc.indexOf('<head');
  const cspIndex = normalizedSrcdoc.indexOf('content-security-policy');
  const headEndIndex = normalizedSrcdoc.indexOf('</head>');
  const bodyIndex = normalizedSrcdoc.indexOf('<body');
  expect(htmlIndex).toBeGreaterThanOrEqual(options.hasDoctype ? '<!doctype html>'.length : 0);
  expect(headIndex).toBeGreaterThan(htmlIndex);
  expect(cspIndex).toBeGreaterThan(headIndex);
  expect(headEndIndex).toBeGreaterThan(cspIndex);
  expect(bodyIndex).toBeGreaterThan(headEndIndex);
};

describe('HtmlDiffViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      text: async () => '',
    });
  });

  it('renders with preview mode tabs', () => {
    renderViewer();
    expect(screen.getByRole('button', { name: 'Diff' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Rendered Preview' })).toBeDefined();
  });

  it('defaults to diff mode', () => {
    const { container } = renderViewer();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByText('Hello')).toBeDefined();
    expect(screen.getByText('World')).toBeDefined();
  });

  it('shows empty message when no HTML content', async () => {
    const user = userEvent.setup();
    renderViewer({
      mergedChunks: makeMergedChunks([]),
    });

    await user.click(screen.getByRole('button', { name: 'Rendered Preview' }));
    expect(screen.getByText('No HTML content to preview.')).toBeDefined();
  });

  it('renders script-disabled iframe after switching to rendered preview mode', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <WordHighlightProvider>
        <HtmlDiffViewer {...makeProps()} />
      </WordHighlightProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Rendered Preview' }));
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeDefined();
    expect(iframe?.getAttribute('sandbox')).toBe('');
    expect(iframe?.getAttribute('srcdoc')).toContain('<h1>Hello</h1>');
    expectPreviewCsp(iframe?.getAttribute('srcdoc'));
    expect(iframe?.getAttribute('srcdoc')).not.toContain('difit-iframe-height');
    expect(iframe?.getAttribute('title')).toBe('HTML Preview');
  });

  it('uses prefetched content when switching to full-preview mode', async () => {
    const fullHtml =
      '<!doctype html><html><head><title>Full</title></head><body>Full HTML</body></html>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const iframe = container.querySelector('iframe');
      const srcdoc = iframe?.getAttribute('srcdoc');
      expect(srcdoc).toContain('<head><meta http-equiv="Content-Security-Policy"');
      expect(srcdoc).toContain('<title>Full</title>');
      expect(srcdoc).toContain('<body>Full HTML</body>');
      expectPreviewCsp(srcdoc);
      expect(iframe?.getAttribute('sandbox')).toBe('');
    });
    expect(global.fetch).toHaveBeenCalledWith('/api/blob/index.html?ref=def456');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves doctype before injected CSP when previewing HTML without head', async () => {
    const fullHtml = '<!doctype html><html><body>Full HTML</body></html>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc, { hasDoctype: true });
      expect(srcdoc).toContain('<body>Full HTML</body>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('uses the parsed document head after leading comments when previewing full HTML', async () => {
    const fullHtml =
      '<!doctype html><!-- build --><html><head><title>Full</title></head><body>Full HTML</body></html>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc, { hasDoctype: true });
      expect(srcdoc).toContain('<title>Full</title>');
      expect(srcdoc).toContain('<body>Full HTML</body>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('ignores head tags nested inside body content when injecting CSP', async () => {
    const fullHtml =
      '<!doctype html><html><body><template><head><title>Nested</title></head></template>Full HTML</body></html>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc, { hasDoctype: true });
      expect(srcdoc).toContain('<body><template>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('preserves doctype before injected CSP when previewing a doctype fragment', async () => {
    const fullHtml = '<!doctype html><p>Full HTML</p>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc, { hasDoctype: true });
      expect(srcdoc).toContain('<p>Full HTML</p>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('preserves doctype before injected CSP when leading trivia precedes doctype', async () => {
    const fullHtml = '\uFEFF\n<!doctype html><html><body>Full HTML</body></html>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc, { hasDoctype: true });
      expect(srcdoc).toContain('<body>Full HTML</body>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('does not treat doctype text inside a fragment as the document doctype', async () => {
    const fullHtml = '<!-- <!doctype html> --><p>Full HTML</p>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc);
      expect(srcdoc?.toLowerCase().startsWith('<!doctype html>')).toBe(false);
      expect(srcdoc).toContain('<p>Full HTML</p>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('does not treat header as a document head tag', async () => {
    const fullHtml = '<header><img src="https://example.com/logo.png"></header>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc);
      const cspIndex = srcdoc?.indexOf('Content-Security-Policy') ?? -1;
      const headerIndex = srcdoc?.indexOf('<header>') ?? -1;
      expect(headerIndex).toBeGreaterThan(cspIndex);
      expect(srcdoc).toContain('<header><img src="https://example.com/logo.png"></header>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('does not treat custom elements prefixed with html as document html tags', async () => {
    const fullHtml = '<html-preview><p>Full HTML</p></html-preview>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc);
      const cspIndex = srcdoc?.indexOf('Content-Security-Policy') ?? -1;
      const customElementIndex = srcdoc?.indexOf('<html-preview>') ?? -1;
      expect(customElementIndex).toBeGreaterThan(cspIndex);
      expect(srcdoc).toContain('<html-preview><p>Full HTML</p></html-preview>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('does not use a head tag inside template content as the document head', async () => {
    const fullHtml =
      '<!doctype html><html><template><head><title>Nested</title></head></template><body><img src="https://example.com/x.png"></body></html>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc, { hasDoctype: true });
      expect(srcdoc).toContain('<img src="https://example.com/x.png">');
      expectPreviewCsp(srcdoc);
    });
  });

  it('handles quoted attribute values containing angle brackets before the body', async () => {
    const fullHtml = '<!doctype html><html data-x=">"><body>Full HTML</body></html>';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      text: async () => fullHtml,
    });
    const user = userEvent.setup();
    const { container } = renderViewer();

    const fullPreviewButton = await screen.findByRole('button', { name: 'Full Preview' });
    await user.click(fullPreviewButton);

    await waitFor(() => {
      const srcdoc = container.querySelector('iframe')?.getAttribute('srcdoc');
      expectCspInDocumentHead(srcdoc, { hasDoctype: true });
      expect(srcdoc).toContain('<html data-x=">">');
      expect(srcdoc).toContain('<body>Full HTML</body>');
      expectPreviewCsp(srcdoc);
    });
  });

  it('does not show full preview tab when content fails to load', async () => {
    renderViewer();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('button', { name: 'Full Preview' })).toBeNull();
  });
});
