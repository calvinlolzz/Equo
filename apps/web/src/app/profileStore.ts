import { UI_TEXT } from "./uiText";
export type ProfileData = {
  name: string;
  avatarDataUrl?: string;
};

export const PROFILE_KEY = "equo.clean.profile";

export const DEFAULT_PROFILE: ProfileData = { name: UI_TEXT.misc.defaultProfileName };

export function normalizeProfile(value: Partial<ProfileData> | null | undefined): ProfileData {
  const name = value?.name?.trim();
  return {
    name: name || DEFAULT_PROFILE.name,
    avatarDataUrl: value?.avatarDataUrl || undefined,
  };
}

export function readProfile(readJson: <T>(key: string, fallback: T) => T): ProfileData {
  return normalizeProfile(readJson<Partial<ProfileData>>(PROFILE_KEY, DEFAULT_PROFILE));
}
