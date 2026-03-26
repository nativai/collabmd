# Google OIDC Setup Guide

Use this guide when you want CollabMD users to sign in with Google and have their verified Google `name` and `email` become the app identity and default git commit author.

## What you need

- A stable public URL for CollabMD, such as `https://notes.example.com`
- A Google Cloud project you can manage
- A deployment path where `PUBLIC_BASE_URL` always matches the browser-visible app origin

Google OIDC is not compatible with ephemeral Cloudflare Quick Tunnel URLs because Google OAuth clients require fixed redirect URIs.

## 1. Decide the public URL first

Pick the exact URL where users will open CollabMD.

Examples:

- Root path: `https://notes.example.com`
- Subpath deployment: `https://docs.example.com/collabmd`

If you deploy under a subpath, CollabMD also needs:

```bash
BASE_PATH=/collabmd
```

## 2. Open Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing one.
3. Make sure you are working in the correct project before creating OAuth credentials.

## 3. Configure the OAuth consent screen

1. Open `APIs & Services` -> `OAuth consent screen`.
2. Choose `Internal` if your Google Workspace policy allows it and the app is only for your org.
3. Otherwise choose `External`.
4. Fill in the required app details.
5. Add your contact email.
6. Save the consent screen settings.

For early testing with an `External` app, add your own Google account under `Test users`.

## 4. Create the OAuth client

1. Open `APIs & Services` -> `Credentials`.
2. Click `Create Credentials` -> `OAuth client ID`.
3. Choose `Web application`.
4. Give it a clear name such as `CollabMD Production`.

## 5. Register the redirect URI

The redirect URI must exactly match what CollabMD will use.

Root deployment:

```text
https://notes.example.com/api/auth/oidc/callback
```

Subpath deployment with `BASE_PATH=/collabmd`:

```text
https://docs.example.com/collabmd/api/auth/oidc/callback
```

For local development, Google also allows `localhost` redirect URIs such as:

```text
http://localhost:1234/api/auth/oidc/callback
```

## 6. Copy the client ID and client secret

After creating the OAuth client, Google shows:

- `Client ID`
- `Client secret`

Use those values for:

```bash
AUTH_OIDC_CLIENT_ID=your-google-client-id
AUTH_OIDC_CLIENT_SECRET=your-google-client-secret
```

## 7. Configure CollabMD

Set these environment variables:

```bash
AUTH_STRATEGY=oidc
PUBLIC_BASE_URL=https://notes.example.com
AUTH_OIDC_CLIENT_ID=your-google-client-id
AUTH_OIDC_CLIENT_SECRET=your-google-client-secret
AUTH_SESSION_MAX_AGE_MS=2592000000
```

If the app is mounted under a subpath:

```bash
BASE_PATH=/collabmd
PUBLIC_BASE_URL=https://docs.example.com
```

Example CLI start:

```bash
PUBLIC_BASE_URL=https://notes.example.com \
AUTH_OIDC_CLIENT_ID=your-google-client-id \
AUTH_OIDC_CLIENT_SECRET=your-google-client-secret \
collabmd /path/to/vault --auth oidc --no-tunnel
```

## 8. Optional access restrictions

CollabMD can restrict which Google accounts may sign in.

Allow exact email addresses:

```bash
AUTH_OIDC_ALLOWED_EMAILS=ceo@example.com,cto@example.com
```

Allow whole email domains:

```bash
AUTH_OIDC_ALLOWED_DOMAINS=example.com,subsidiary.com
```

Behavior:

- If neither is set, any Google account with a verified email can sign in
- If `AUTH_OIDC_ALLOWED_EMAILS` is set, those exact addresses are allowed
- If `AUTH_OIDC_ALLOWED_DOMAINS` is set, any verified email in those domains is allowed
- If both are set, an exact allowed email or an allowed domain is enough to grant access

## 9. Verify startup output

When CollabMD starts successfully with OIDC, startup should show the public URL and callback URL.

Example:

```text
Auth:   oidc (google)
Public: https://notes.example.com
Callback: https://notes.example.com/api/auth/oidc/callback
Tunnel: disabled (OIDC requires a stable PUBLIC_BASE_URL)
```

## 10. Test the sign-in flow

1. Open the CollabMD URL in a browser.
2. Click `Continue with Google`.
3. Complete the Google sign-in flow.
4. Confirm the app opens normally.
5. Confirm the toolbar shows your Google name.
6. If using git from the UI, make a commit and verify the author:

```bash
git -C /path/to/vault log -1 --pretty='%an <%ae>'
```

## Troubleshooting

- `OIDC auth requires PUBLIC_BASE_URL`: set `PUBLIC_BASE_URL` to the browser-visible origin
- Redirect URI mismatch in Google: confirm the registered Google redirect URI exactly matches `/api/auth/oidc/callback`, including any `BASE_PATH`
- Login keeps returning to the auth screen: verify the reverse proxy preserves HTTPS headers and the browser URL matches `PUBLIC_BASE_URL`
- Session expires too quickly: set `AUTH_SESSION_MAX_AGE_MS` to a longer value such as `2592000000` for 30 days
- Expected company accounts cannot sign in: check `AUTH_OIDC_ALLOWED_EMAILS` and `AUTH_OIDC_ALLOWED_DOMAINS` for typos, whitespace, or missing domains
- Tunnel is disabled unexpectedly: this is intentional for OIDC; use a stable public host instead of Quick Tunnel
