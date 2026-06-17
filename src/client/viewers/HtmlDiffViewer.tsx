import { useEffect, useMemo, useState } from 'react';

import type { MergedChunk } from '../hooks/useExpandedLines';

import { PreviewModeTabs, type PreviewMode } from './PreviewModeTabs';
import { TextDiffViewer } from './TextDiffViewer';
import type { DiffViewerBodyProps } from './types';

const isFetchableRef = (ref?: string) => Boolean(ref && ref !== 'stdin');

const buildAfterContent = (chunks: MergedChunk[]): string => {
  const lines: string[] = [];
  for (const chunk of chunks) {
    for (const line of chunk.lines) {
      if (line.type === 'header' || line.type === 'hunk') continue;
      if (line.type === 'delete' || line.type === 'remove') continue;
      lines.push(line.content);
    }
  }
  return lines.join('\n');
};

const PREVIEW_CSP =
  `<meta http-equiv="Content-Security-Policy" ` +
  `content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:;">`;

const wrapHtmlForPreview = (html: string): string => {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${PREVIEW_CSP}`);
  }
  return `${PREVIEW_CSP}${html}`;
};

const HtmlIframePreview = ({ html }: { html: string }) => (
  <iframe
    srcDoc={wrapHtmlForPreview(html)}
    sandbox=""
    referrerPolicy="no-referrer"
    className="w-full border-0 bg-white rounded"
    style={{ height: 'min(70vh, 720px)', minHeight: '320px' }}
    title="HTML Preview"
  />
);

export function HtmlDiffViewer(props: DiffViewerBodyProps) {
  const { file, baseCommitish, targetCommitish, mergedChunks } = props;
  const [mode, setMode] = useState<PreviewMode>('diff');
  const [fullContent, setFullContent] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadedSourceKey, setLoadedSourceKey] = useState<string | null>(null);

  const diffPreviewContent = useMemo(() => buildAfterContent(mergedChunks), [mergedChunks]);

  const previewSource = useMemo(() => {
    if (!baseCommitish && !targetCommitish) return null;

    if (file.status === 'added') {
      return targetCommitish ? { path: file.path, ref: targetCommitish } : null;
    }

    if (file.status === 'deleted') {
      return baseCommitish ? { path: file.oldPath || file.path, ref: baseCommitish } : null;
    }

    if (targetCommitish) {
      return { path: file.path, ref: targetCommitish };
    }

    return baseCommitish ? { path: file.oldPath || file.path, ref: baseCommitish } : null;
  }, [baseCommitish, targetCommitish, file.path, file.oldPath, file.status]);

  const previewSourceKey = useMemo(
    () => (previewSource ? `${previewSource.ref}:${previewSource.path}` : null),
    [previewSource],
  );

  useEffect(() => {
    if (!previewSource || !previewSourceKey || !isFetchableRef(previewSource.ref)) {
      setFullContent(null);
      setLoadedSourceKey(null);
      setPreviewError(null);
      setIsPreviewLoading(false);
      return;
    }

    let isCanceled = false;

    const fetchContent = async () => {
      if (previewSourceKey !== loadedSourceKey) {
        setFullContent(null);
      }
      setIsPreviewLoading(true);
      setPreviewError(null);
      try {
        const encodedPath = encodeURIComponent(previewSource.path);
        const response = await fetch(
          `/api/blob/${encodedPath}?ref=${encodeURIComponent(previewSource.ref)}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch preview: ${response.statusText}`);
        }
        const text = await response.text();
        if (!isCanceled) {
          setFullContent(text);
          setLoadedSourceKey(previewSourceKey);
        }
      } catch (error) {
        if (!isCanceled) {
          setFullContent(null);
          setLoadedSourceKey(null);
          setPreviewError(error instanceof Error ? error.message : 'Failed to load preview');
        }
      } finally {
        if (!isCanceled) {
          setIsPreviewLoading(false);
        }
      }
    };

    if (previewSourceKey !== loadedSourceKey || fullContent === null) {
      void fetchContent();
    }

    return () => {
      isCanceled = true;
    };
  }, [fullContent, loadedSourceKey, previewSource, previewSourceKey]);

  const hasFullPreview = useMemo(
    () => previewSourceKey === loadedSourceKey && fullContent !== null,
    [fullContent, loadedSourceKey, previewSourceKey],
  );

  useEffect(() => {
    if (mode === 'full-preview' && !hasFullPreview) {
      setMode('diff-preview');
    }
  }, [hasFullPreview, mode]);

  return (
    <div className="bg-github-bg-primary">
      <div className="flex items-center justify-between border-b border-github-border px-4 py-2">
        <PreviewModeTabs
          mode={mode}
          hasFullPreview={hasFullPreview}
          onModeChange={setMode}
          diffPreviewLabel="Rendered Preview"
        />
      </div>

      {mode === 'diff' && <TextDiffViewer {...props} />}

      {mode === 'diff-preview' && (
        <div className="p-4">
          {diffPreviewContent.trim() ? (
            <HtmlIframePreview html={diffPreviewContent} />
          ) : (
            <div className="text-sm text-github-text-muted">No HTML content to preview.</div>
          )}
        </div>
      )}

      {mode === 'full-preview' && (
        <div className="p-4">
          {isPreviewLoading && (
            <div className="text-sm text-github-text-muted mb-3">Loading preview...</div>
          )}
          {previewError && <div className="text-sm text-github-danger mb-3">{previewError}</div>}
          {!isPreviewLoading && !previewError && fullContent !== null && (
            <HtmlIframePreview html={fullContent} />
          )}
          {!isPreviewLoading && !previewError && fullContent === null && (
            <div className="text-sm text-github-text-muted">Preview unavailable.</div>
          )}
        </div>
      )}
    </div>
  );
}
