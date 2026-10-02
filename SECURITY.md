# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.1.x   | ✅ |
| < 1.1   | ❌ |

## Reporting a vulnerability

We take the security of PersistMark seriously. If you believe you have found a
security vulnerability, please **do not open a public GitHub issue**.

Instead, report it privately using **GitHub's private vulnerability reporting**:

1. Go to the repository's **Security** tab → **Report a vulnerability**,

or email the maintainer directly via the email listed on the maintainer's
GitHub profile.

Please include:

- A description of the issue and its potential impact
- Steps or proof-of-concept to reproduce it
- Affected version(s) and browser(s)
- Any suggested mitigation

You should receive a response within 7 days. We will credit reporters who
request it when the fix is published (unless you prefer to remain anonymous).

## Scope notes

PersistMark runs entirely locally: it makes **no network requests** and stores
data only in `chrome.storage`. Security-relevant areas include the content
script's DOM manipulation (injection safety via closed shadow roots), the
`<all_urls>` host permission, and the JSON import path (backup files).

## Preferred languages

English or Bengali.
