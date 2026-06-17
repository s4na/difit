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
    expect(screen.getByTitle('Code Diff')).toBeDefined();
    expect(screen.getByTitle('Diff Preview')).toBeDefined();
  });

  it('defaults to diff mode', () => {
    renderViewer();
    const diffButton = screen.getByTitle('Code Diff');
    expect(diffButton.className).toContain('text-github-text-primary');
  });

  it('switches to diff-preview mode on click', async () => {
    const user = userEvent.setup();
    renderViewer();

    await user.click(screen.getByTitle('Diff Preview'));

    const previewButton = screen.getByTitle('Diff Preview');
    expect(previewButton.className).toContain('text-github-text-primary');
  });

  it('shows empty message when no HTML content', async () => {
    const user = userEvent.setup();
    renderViewer({
      mergedChunks: makeMergedChunks([]),
    });

    await user.click(screen.getByTitle('Diff Preview'));
    expect(screen.getByText('No HTML content to preview.')).toBeDefined();
  });

  it('renders script-disabled iframe in diff-preview mode', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <WordHighlightProvider>
        <HtmlDiffViewer {...makeProps()} />
      </WordHighlightProvider>,
    );

    await user.click(screen.getByTitle('Diff Preview'));
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

    const fullPreviewButton = await screen.findByTitle('Full Preview');
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

  it('does not show full preview tab when content fails to load', async () => {
    renderViewer();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByTitle('Full Preview')).toBeNull();
  });
});
