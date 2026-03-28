export const DEFAULT_CREDITS_PER_INR = 10;
export const DEFAULT_REFERRAL_REWARD_CREDITS = 200;

export const creditsToInr = (credits: number, creditsPerInr = DEFAULT_CREDITS_PER_INR) => {
  if (!Number.isFinite(credits) || !Number.isFinite(creditsPerInr) || creditsPerInr <= 0) {
    return 0;
  }

  return credits / creditsPerInr;
};

export const inrToCredits = (inr: number, creditsPerInr = DEFAULT_CREDITS_PER_INR) => {
  if (!Number.isFinite(inr) || !Number.isFinite(creditsPerInr) || creditsPerInr <= 0) {
    return 0;
  }

  return Math.round(inr * creditsPerInr);
};

export const formatCreditsInrHint = (creditsPerInr = DEFAULT_CREDITS_PER_INR) =>
  `${creditsPerInr} credits = Rs 1`;
