# api/

Screening and scoring service, and the indexer behind the public metric.

**Not started.** Covered by phase 0.3 (verifiable "prevented $X" metric) and phase 1.1 (Snap
transaction insight).

Two constraints already fixed by the contracts, recorded here so they are not rediscovered:

- **The metric aggregates `RiskEngine.RiskBlocked` events, not failed executions.** `enforceIntent`
  is a view that reverts, so anything it emitted would be rolled back and never indexable. See
  ADR-0003.
- **`RiskBlocked` records that a block was placed and what value was at risk.** That is not the
  same as proving an attack was attempted and stopped. Any public figure must be labelled with its
  methodology and category — mainnet verified / testnet / simulation — per invariant I-P5.

The service will hold `ATTESTER_ROLE` on the RiskEngine. It submits per-vector severities; the
**contract** derives the verdict. It cannot declare a drainer "clear".
