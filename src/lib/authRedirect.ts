const DEFAULT_AUTH_PATH = '/login';

export const getSiteUrl = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  return window.location.origin.replace(/\/$/, '');
};

export const getAuthRedirectUrl = (path = DEFAULT_AUTH_PATH) => {
  const baseUrl = getSiteUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `${baseUrl}${normalizedPath}`;
};
