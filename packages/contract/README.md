# @outbreak/contract

**Owners:** P1, P2 and P3 together.

`src/index.ts` re-exports P1's `detection/src/types.ts` unchanged (contract v1) and adds the
contract-v2 shapes (`AlertRecord`, `AlertEvent`, `RainRow`) from
`detection/handoff/contract-v2.md`. `LiveSignalRow` and `WardRisk` are P1's own types,
re-exported. Nothing is copied by hand. Plain-English version: `docs/contract.md`.
