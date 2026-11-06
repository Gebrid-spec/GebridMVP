# GEBRID Enterprise OS — release v0.1.0

Дата: 2026-11-05

- Runnable single-tenant FastAPI + SQLite local control-plane prototype.
- Browser UI: 11 screens / navigation destinations.
- Runtime request enforcement: agent identity, scope, policy, recipient, monetary cap, tool admission, deterministic Guardian, independent approval.
- 5 synthetic invoices: authorized, approval, bank mismatch, over limit, prompt injection.
- Role-separated admin / operator / approver / auditor access.
- Agent stop, global emergency stop, tool quarantine.
- Signed local memory snapshot + metadata-only model migration with scope-subset and budget-preservation checks.
- HMAC-linked audit trail with local verifier; external anchoring not included.
- 2 deterministic, sequential multi-agent workflow templates.
- 22 automated backend tests; 11 non-browser UI rendering smoke checks.
- Browser end-to-end execution was unavailable due environment Chromium URLBlocklist policy; not claimed passed.

No production claims. Demo credentials and data are synthetic. No real model, ERP, MCP, payment, token, or blockchain interactions.
