# Password reset redirect configuration

Production URL: `https://sns-automation-one.vercel.app`

In Supabase Authentication → URL Configuration, use the stable production
domain for **Site URL**. Do not use a deployment-specific Vercel URL: deleting
that deployment breaks authentication redirects with `DEPLOYMENT_NOT_FOUND`.

The password reset form requests `${window.location.origin}/reset-password`.
Register each supported origin's exact `/reset-password` URL in **Redirect URLs**.
An unapproved redirect falls back to Site URL.

## Hosted configuration applied on 2026-09-09

- Site URL: `https://sns-automation-one.vercel.app`
- Redirect URLs:
  - `https://sns-automation-one.vercel.app/reset-password`
  - `https://sns-automation-git-feat-password-reset-ken-768s-projects.vercel.app/reset-password`

The Preview entry supports PR #52 testing and can be removed when no longer needed.
Preview deployments remain subject to Vercel authentication.

The previous Site URL and redirect allowlist referenced the unavailable deployment
`https://sns-automation-g61kdgs7c-ken-768s-projects.vercel.app`.
Both hosted settings were updated through the Supabase Management API; this
document records that change and does not apply settings automatically.

## Verification

- Read back both settings after the update.
- Probed Supabase's recovery verification endpoint using a deliberately invalid
  token without sending email or changing an account. Its HTTP 303 responses
  preserved the production and Preview reset URLs.
- Requests without a redirect, or with the obsolete deployment URL, fell back
  to the stable production URL.
- Production `/reset-password` returned HTTP 200 and the password reset form.

These probes verify URL selection and page availability, not successful token
exchange or password changes. Complete the end-to-end check by requesting a fresh
reset email from production and using it to set a new password.
