import { safePath } from './files';

/** Expand ~ and normalise separators for cross-platform use. */
export function resolvePath(p: string): string {
  return safePath(p || '~');
}
