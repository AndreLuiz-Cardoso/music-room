// Minimal HTML pages opened from the links sent by email.

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'";

export function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} - Music Room</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 16px;color:#111}
h1{font-size:22px}input{display:block;width:100%;box-sizing:border-box;padding:10px;margin:6px 0 14px;font-size:16px}
button{padding:10px 18px;font-size:16px;background:#1db954;color:#fff;border:0;border-radius:6px}</style>
</head><body><h1>${escape(title)}</h1>${body}</body></html>`;
}

export function messagePage(title: string, message: string): string {
  return page(title, `<p>${escape(message)}</p>`);
}

export function resetPasswordForm(token: string, error?: string): string {
  return page(
    'Choose a new password',
    `${error ? `<p style="color:#c00">${escape(error)}</p>` : ''}
<form method="post" action="/auth/reset-password">
<input type="hidden" name="token" value="${escape(token)}">
<label>New password<input type="password" name="password" minlength="8" maxlength="128" required autocomplete="new-password"></label>
<button type="submit">Change password</button></form>
<p><small>At least 8 characters, with a letter and a digit.</small></p>`,
  );
}
