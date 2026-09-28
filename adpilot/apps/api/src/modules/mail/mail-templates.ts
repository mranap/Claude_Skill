/** Minimal, dependency-free transactional e-mail templates. All interpolated values are HTML-escaped. */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface LayoutInput {
  platformName: string;
  title: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  footnote?: string;
}

export function renderLayout(input: LayoutInput): { html: string; text: string } {
  const p = input.paragraphs.map((t) => `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(t)}</p>`).join('');
  const button = input.action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(input.action.url)}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapeHtml(input.action.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;color:#6b7280;word-break:break-all">${escapeHtml(input.action.url)}</p>`
    : '';
  const foot = input.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;color:#6b7280">${escapeHtml(input.footnote)}</p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e5e7eb">
<tr><td style="padding:22px 28px;border-bottom:1px solid #eef0f3;font-weight:700;font-size:16px">${escapeHtml(input.platformName)}</td></tr>
<tr><td style="padding:26px 28px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(input.title)}</h1>${p}${button}${foot}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    input.title,
    '',
    ...input.paragraphs,
    ...(input.action ? ['', `${input.action.label}: ${input.action.url}`] : []),
    ...(input.footnote ? ['', input.footnote] : []),
    '',
    `— ${input.platformName}`,
  ].join('\n');
  return { html, text };
}

export const MailTemplates = {
  invitation(platformName: string, url: string, hours: number): RenderedEmail {
    const { html, text } = renderLayout({
      platformName,
      title: 'You have been invited',
      paragraphs: [
        `An administrator created an account for you on ${platformName}.`,
        'Use the button below to choose your password and sign in.',
      ],
      action: { label: 'Set your password', url },
      footnote: `This link can be used once and expires in ${hours} hours.`,
    });
    return { subject: `Your ${platformName} account`, html, text };
  },

  passwordReset(platformName: string, url: string, minutes: number): RenderedEmail {
    const { html, text } = renderLayout({
      platformName,
      title: 'Reset your password',
      paragraphs: [
        'We received a request to reset the password of your account.',
        'If it was you, use the button below. Otherwise you can safely ignore this e-mail.',
      ],
      action: { label: 'Reset password', url },
      footnote: `This link can be used once and expires in ${minutes} minutes.`,
    });
    return { subject: `${platformName}: password reset`, html, text };
  },

  emailChangeConfirm(platformName: string, url: string): RenderedEmail {
    const { html, text } = renderLayout({
      platformName,
      title: 'Confirm your new e-mail address',
      paragraphs: ['Please confirm that this address should become the login of your account.'],
      action: { label: 'Confirm e-mail', url },
      footnote: 'The link expires in 24 hours. If you did not request this change, ignore this message.',
    });
    return { subject: `${platformName}: confirm your new e-mail`, html, text };
  },

  securityNotice(platformName: string, title: string, message: string): RenderedEmail {
    const { html, text } = renderLayout({
      platformName,
      title,
      paragraphs: [message, 'If this was not you, reset your password immediately and contact your administrator.'],
    });
    return { subject: `${platformName}: ${title}`, html, text };
  },

  notification(platformName: string, title: string, body: string, url?: string): RenderedEmail {
    const { html, text } = renderLayout({
      platformName,
      title,
      paragraphs: body.split('\n').filter(Boolean),
      action: url ? { label: 'Open', url } : undefined,
      footnote: 'You can change which notifications you receive in Settings → Notifications.',
    });
    return { subject: `${platformName}: ${title}`, html, text };
  },

  test(platformName: string): RenderedEmail {
    const { html, text } = renderLayout({
      platformName,
      title: 'SMTP test successful',
      paragraphs: ['This is a test e-mail sent from the Super Admin panel. Your SMTP settings work.'],
    });
    return { subject: `${platformName}: SMTP test`, html, text };
  },
};
