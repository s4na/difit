import { describe, expect, it } from 'vitest';

import { isHtmlFile } from './htmlUtils';

describe('htmlUtils', () => {
  describe('isHtmlFile', () => {
    it('identifies .html files', () => {
      expect(isHtmlFile('index.html')).toBe(true);
      expect(isHtmlFile('page.html')).toBe(true);
      expect(isHtmlFile('src/templates/layout.html')).toBe(true);
    });

    it('identifies .htm files', () => {
      expect(isHtmlFile('index.htm')).toBe(true);
      expect(isHtmlFile('src/page.htm')).toBe(true);
    });

    it('is case insensitive', () => {
      expect(isHtmlFile('PAGE.HTML')).toBe(true);
      expect(isHtmlFile('page.HTM')).toBe(true);
    });

    it('rejects non-HTML files', () => {
      expect(isHtmlFile('file.js')).toBe(false);
      expect(isHtmlFile('file.md')).toBe(false);
      expect(isHtmlFile('file.css')).toBe(false);
      expect(isHtmlFile('file.txt')).toBe(false);
    });

    it('handles edge cases', () => {
      expect(isHtmlFile('')).toBe(false);
      expect(isHtmlFile('file')).toBe(false);
      expect(isHtmlFile('html')).toBe(false);
      expect(isHtmlFile('path/to/html')).toBe(false);
      expect(isHtmlFile('file.')).toBe(false);
      expect(isHtmlFile('.html')).toBe(true);
      expect(isHtmlFile('path/to/deep.html')).toBe(true);
    });
  });
});
