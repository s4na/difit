import { getFileExtension } from '../../utils/fileUtils';

const HTML_EXTENSIONS = ['html', 'htm'];

export function isHtmlFile(filename: string): boolean {
  if (!filename) return false;

  const basename = filename.split('/').pop() ?? filename;
  if (!basename.includes('.')) return false;

  const extension = getFileExtension(filename);
  return extension ? HTML_EXTENSIONS.includes(extension) : false;
}
