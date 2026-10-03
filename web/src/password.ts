/** Password rules of the instance's user pool, from `/config.json`. */
export interface PasswordPolicy {
  minLength: number;
  lowercase: boolean;
  uppercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

/** Cognito's own default, used when an instance's config doesn't say. */
export const defaultPasswordPolicy: PasswordPolicy = { minLength: 8, lowercase: false, uppercase: false, numbers: false, symbols: false };

export type PasswordRule = "length" | "lowercase" | "uppercase" | "numbers" | "symbols";

/** The rules this policy has, each with whether the password meets it. */
export function checkPassword(password: string, policy: PasswordPolicy): { rule: PasswordRule; ok: boolean }[] {
  const rules: { rule: PasswordRule; ok: boolean }[] = [{ rule: "length", ok: password.length >= policy.minLength }];
  if (policy.lowercase) rules.push({ rule: "lowercase", ok: /\p{Ll}/u.test(password) });
  if (policy.uppercase) rules.push({ rule: "uppercase", ok: /\p{Lu}/u.test(password) });
  if (policy.numbers) rules.push({ rule: "numbers", ok: /[0-9]/.test(password) });
  // Cognito counts these as special characters (and a space between other characters).
  if (policy.symbols) rules.push({ rule: "symbols", ok: /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`=+-]|\S \S/.test(password) });
  return rules;
}
