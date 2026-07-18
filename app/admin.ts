const DEFAULT_ADMIN_EMAILS = "andreas@andreasmartensson.com";

export function isAdminEmail(email: string) {
  const configured = process.env.OSH26_ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS;
  return configured.split(",").some((entry) => entry.trim().toLowerCase() === email.trim().toLowerCase());
}
