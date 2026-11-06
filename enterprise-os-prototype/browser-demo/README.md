# Browser edition (investor demo)

A single self-contained HTML page that runs the full prototype in the viewer's browser, with no server.

- `backend.js` — JavaScript port of the sandbox API (`gebrid/app.py`, `core.py`, `db.py`): same routes, roles,
  policy engine, approvals, policy change control, snapshots, migrations, workflows and HMAC-chained audit.
  State is kept per viewer in `localStorage`; nothing leaves the browser.
- `build.cjs` — bundles `frontend/` (unchanged UI) with `backend.js` into one page.
- `i18n.js` — Russian interface: translates rendered text after the UI draws it, so logic stays untouched. The language follows
  the browser and can be switched with the Русский / English button; system identifiers stay in Latin.
- `i18n_check.cjs` — checks that every backend message translates, alone and inside composite messages.
- `parity.cjs` — runs one 122-step scenario against the Python server and the JS backend and compares every
  response (status plus behaviour-bearing fields). Keep it green whenever `gebrid/` changes.

```bash
node browser-demo/build.cjs /tmp/gebrid-enterprise-os.html
# parity: start the Python server on a fresh database first
GEBRID_DB_PATH=/tmp/p.db GEBRID_KEY_PATH=/tmp/p.key python -m uvicorn gebrid.app:app --port 8010 &
node browser-demo/parity.cjs http://127.0.0.1:8010
```

Differences from the Python server, by design: demo passwords are compared directly (no PBKDF2), the HMAC key
is generated per browser, and 422 validation messages are worded differently from pydantic's.
The same limits apply as for the server: synthetic data, demo identities, not a production system.
