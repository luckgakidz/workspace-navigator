import * as path from 'path';

/**
 * ファイルシステム上のパスを比較用に正規化する。
 * Windows のみ大文字小文字を区別せず、他OSのパス規則は保持する。
 */
export function normalizePathForComparison(input: string): string {
  const normalized = path.resolve(path.normalize(input));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isSameFileSystemPath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}
