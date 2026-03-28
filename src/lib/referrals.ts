const PENDING_REFERRAL_CODE_KEY = 'stoicops_pending_referral_code';

export const normalizeReferralCode = (value: string | null | undefined) =>
  (value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export const getPendingReferralCode = () => {
  if (typeof window === 'undefined') return '';
  return normalizeReferralCode(window.localStorage.getItem(PENDING_REFERRAL_CODE_KEY));
};

export const setPendingReferralCode = (value: string | null | undefined) => {
  if (typeof window === 'undefined') return;

  const normalized = normalizeReferralCode(value);
  if (!normalized) {
    window.localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
    return;
  }

  window.localStorage.setItem(PENDING_REFERRAL_CODE_KEY, normalized);
};

export const clearPendingReferralCode = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
};
