export type WeaponKind = "rifle" | "pistol" | "shotgun";

export type WeaponConfig = {
  id: WeaponKind;
  label: string;
  fireMode: "auto" | "semi" | "spread";
  clipSize: number;
  damageHint: number;
  recoil: number;
  spread: number;
  color: string;
};

export const WEAPON_CONFIGS: Record<WeaponKind, WeaponConfig> = {
  rifle: {
    id: "rifle",
    label: "Rifle",
    fireMode: "auto",
    clipSize: 24,
    damageHint: 24,
    recoil: 0.06,
    spread: 0.01,
    color: "#6ee7f9",
  },
  pistol: {
    id: "pistol",
    label: "Pistol",
    fireMode: "semi",
    clipSize: 12,
    damageHint: 30,
    recoil: 0.03,
    spread: 0.005,
    color: "#facc15",
  },
  shotgun: {
    id: "shotgun",
    label: "Shotgun",
    fireMode: "spread",
    clipSize: 8,
    damageHint: 48,
    recoil: 0.1,
    spread: 0.06,
    color: "#f97316",
  },
};

export const getServerCompatibleWeapon = (index: number): WeaponConfig => {
  const sequence: WeaponKind[] = ["rifle", "pistol", "shotgun"];
  return WEAPON_CONFIGS[sequence[index % sequence.length]];
};
