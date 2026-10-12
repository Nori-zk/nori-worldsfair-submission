# Backstop

A circuit breaker for one bridged asset: a guard compares its Ethereum backing, proven through Nori, with its Solana supply.

![Guard](../../docs/backstop-guard.drawio.png)

| Instruction                  | Who                       | Does                                                                                       |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ |
| `create_guard(config)`       | anyone (becomes admin)    | Pins the mint, Nori program, NoriSnapshot, and backing and pause queries                   |
| `checkpoint`                 | anyone, once per interval | Records the mint's supply (the last 64 are kept)                                           |
| `submit_read(kind, witness)` | anyone                    | Applies a proven backing or pause flag (newer blocks only)                                 |
| `status` / `assert_healthy`  | lenders, via CPI          | Return the status, or fail unless it is HEALTHY                                            |
| `unlatch`                    | admin                     | Clears a trip. Testing and demos only (one key; production needs a timelock or governance) |

`submit_read` costs ~17.6k compute units on surfpool (541-byte transaction) and 18.2k (backing) / 14.1k (pause) on devnet with real proofs (12 Oct); `checkpoint` ~11.6k; `assert_healthy` 3,956 when allowed and 5,378 when it refuses (the Kelp replay test keeps it under 30k). Live results: [docs/README.md](../../docs/README.md).

A guard lives at `[b"guard", mint, admin]` and its config is fixed at creation, so one admin
has one guard per mint; a new config needs another admin key. Lenders should check the
guard's config (the account), not just its address. A pause query must return a bool:
any other word is rejected, so a misconfigured query can't latch PAUSED_AT_SOURCE.

```sh
cargo test -p backstop --lib   # the rules: drain, refill, in-flight, burn-unlock, forged mint, stale
cargo test -p backstop         # Kelp replay on surfpool (cargo build-sbf first)
```
