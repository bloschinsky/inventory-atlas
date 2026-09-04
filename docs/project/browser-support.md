# Browser support baseline

Inventory Atlas uses a rolling evergreen-browser policy. “Current” means the
latest stable release available when a project release candidate is cut;
“previous” means the immediately preceding stable major. The release record
must capture the concrete versions actually tested.

## Supported targets

| Platform | Supported production target | Required verification |
| --- | --- | --- |
| Windows, macOS, Linux | Current and previous Chrome | Playwright Chromium plus release smoke test |
| Windows, macOS | Current and previous Microsoft Edge | Release smoke test for Chromium integration differences |
| Windows, macOS, Linux | Current Firefox and current Firefox ESR | Playwright Firefox plus release smoke test |
| macOS | Current and previous Safari major | Playwright WebKit plus Safari release smoke test |
| iPhone/iPad | Safari on the current and previous supported iOS/iPadOS major | Physical scan, camera, touch, upload, and label tests |
| Android | Current and previous Chrome for Android major | Physical scan, camera, touch, upload, and label tests |

The public and authenticated applications share this matrix. Responsive support
covers viewport widths from 320 CSS pixels upward, keyboard operation, visible
focus, reduced motion, touch targets, and browser zoom to 200 percent. These are
product requirements, not reasons to expose private data or weaken server-side
authorization for older clients.

Internet Explorer, legacy EdgeHTML, obsolete browser majors, embedded social
media browsers, and vendor WebViews are not supported. A functional manual code
entry path remains required when camera APIs are missing or permission is
denied.

## Stage 0 reference snapshot

The following public release data was checked on 2026-09-04:

- Chrome stable: `152.0.7977.82`.
- Firefox stable: `155.0.1`.
- Firefox ESR: `140.15.0esr`.
- Playwright test package: `1.62.1`; its downloaded Chromium, Firefox, and
  WebKit revisions are pinned by the package/lockfile during FND-01.

Edge, Safari, iOS Safari, and Android Chrome remain policy-based here because
their final physical versions and devices are recorded by HND-03 and again for
each release candidate. A browser version becoming current does not silently
change CI: the dependency/browser update change records the new snapshot and
test evidence together.

Sources:

- [Chrome for Testing stable channel](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json)
- [Mozilla product details](https://product-details.mozilla.org/1.0/firefox_versions.json)
- [Playwright browser support](https://playwright.dev/docs/browsers)
- [Apple security releases](https://support.apple.com/en-us/100100)
- [Microsoft Edge release schedule](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-release-schedule)
