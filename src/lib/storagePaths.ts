export type StorageObjectRef = {
  bucket: string;
  path: string;
};

const KNOWN_STORAGE_BUCKETS = [
  'user_uploads',
  'task-submissions',
  'user_avatars',
] as const;

const removeQueryAndHash = (value: string) =>
  value.split('?')[0]?.split('#')[0] || value;

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const getStorageObjectRef = (
  value: string | null | undefined
): StorageObjectRef | null => {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (!trimmed.includes('://') && !trimmed.startsWith('/')) {
    for (const bucket of KNOWN_STORAGE_BUCKETS) {
      const prefix = `${bucket}/`;
      if (trimmed.startsWith(prefix)) {
        const path = trimmed.slice(prefix.length);
        return path ? { bucket, path } : null;
      }
    }

    return { bucket: 'user_uploads', path: trimmed };
  }

  const normalized = removeQueryAndHash(trimmed);
  const match = normalized.match(
    /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/i
  );

  if (!match) {
    return null;
  }

  const bucket = safeDecode(match[1] || '');
  const path = safeDecode(match[2] || '');

  if (!bucket || !path) {
    return null;
  }

  return { bucket, path };
};

export const toStorageObjectValue = (bucket: string, path: string) =>
  `${bucket}/${path}`;

export const getUserUploadsObjectPath = (value: string | null | undefined): string | null => {
  const ref = getStorageObjectRef(value);
  if (!ref || ref.bucket !== 'user_uploads') {
    return null;
  }

  return ref.path;
};
