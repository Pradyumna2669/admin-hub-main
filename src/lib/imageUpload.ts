type CompressImageOptions = {
  maxWidth: number;
  maxHeight: number;
  quality?: number;
  targetType?: string;
  minBytesToCompress?: number;
};

const NON_COMPRESSIBLE_IMAGE_TYPES = new Set([
  'image/gif',
  'image/svg+xml',
]);

const DEFAULT_MIN_BYTES_TO_COMPRESS = 150 * 1024;

export const IMAGE_UPLOAD_PRESETS = {
  avatar: {
    maxWidth: 512,
    maxHeight: 512,
    quality: 0.78,
    targetType: 'image/webp',
  },
  screenshot: {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.72,
    targetType: 'image/webp',
  },
  paymentProof: {
    maxWidth: 1800,
    maxHeight: 1800,
    quality: 0.76,
    targetType: 'image/webp',
  },
} as const satisfies Record<string, CompressImageOptions>;

const replaceFileExtension = (fileName: string, nextExtension: string) => {
  const sanitizedExtension = nextExtension.replace(/^\./, '');
  const lastDotIndex = fileName.lastIndexOf('.');

  if (lastDotIndex === -1) {
    return `${fileName}.${sanitizedExtension}`;
  }

  return `${fileName.slice(0, lastDotIndex)}.${sanitizedExtension}`;
};

const loadImageFromFile = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not load image for compression.'));
    };

    image.src = objectUrl;
  });

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number
) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });

export const getUploadFileExtension = (file: File) => {
  const fromType = file.type.split('/')[1]?.split('+')[0]?.toLowerCase();
  if (fromType === 'jpeg') return 'jpg';
  if (fromType) return fromType;

  const fromName = file.name.split('.').pop()?.toLowerCase();
  return fromName || 'bin';
};

export const compressImageForUpload = async (
  file: File,
  options: CompressImageOptions
) => {
  if (!file.type.startsWith('image/')) {
    return file;
  }

  if (NON_COMPRESSIBLE_IMAGE_TYPES.has(file.type)) {
    return file;
  }

  try {
    const image = await loadImageFromFile(file);
    const widthRatio = options.maxWidth / image.width;
    const heightRatio = options.maxHeight / image.height;
    const scale = Math.min(widthRatio, heightRatio, 1);
    const targetWidth = Math.max(1, Math.round(image.width * scale));
    const targetHeight = Math.max(1, Math.round(image.height * scale));
    const requiresResize =
      targetWidth !== image.width || targetHeight !== image.height;
    const minBytesToCompress =
      options.minBytesToCompress ?? DEFAULT_MIN_BYTES_TO_COMPRESS;

    if (!requiresResize && file.size < minBytesToCompress) {
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const nextType = options.targetType || file.type || 'image/webp';
    const blob = await canvasToBlob(canvas, nextType, options.quality);

    if (!blob) {
      return file;
    }

    if (!requiresResize && blob.size >= file.size) {
      return file;
    }

    const extension = getUploadFileExtension(
      new File([blob], file.name, { type: blob.type })
    );

    return new File([blob], replaceFileExtension(file.name, extension), {
      type: blob.type,
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
};
