# StabiFlow Production QA

This is an isolated Playwright test app for checking the live StabiFlow production site without adding browser-test dependencies to the customer app bundle.

## Run locally

```bash
cd qa
npm install
npx playwright install chromium
STABIFLOW_BASE_URL=https://app.stabiflow.com npm test
```

Authenticated checks require a dedicated QA workspace account:

```bash
STABIFLOW_QA_EMAIL=... STABIFLOW_QA_PASSWORD=... npm test
```

Never commit QA credentials. Store them as GitHub Actions secrets.

The suite checks public availability, auth protection, core workspace routes, JavaScript errors, horizontal overflow, Billing purchase collapse behaviour, mobile layout, and the desktop sidebar remaining stationary while the dashboard scrolls.
