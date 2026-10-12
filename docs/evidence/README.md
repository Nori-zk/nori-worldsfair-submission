# Evidence (Sepolia → Solana devnet, real proofs)

The reports behind the numbers in the README, as `scripts/soak.sh` and the campaign runner wrote
them. Logs stay out of the repo; configs name `${ENV}` variables only; no RPC hosts or keys.

| File                                               | Run                                                                                        | Headline                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`soak-2026-10-07.md`](soak-2026-10-07.md)         | 7–8 Oct, 598 min, one guard plus an untouched shadow                                       | 39 of 39 snapshots proven and applied; block → read min 14.8 · median 17.9 · p90 21.0 · max 22.0 min; shadow HEALTHY all night                                                                                                                  |
| [`campaign-2026-10-08.md`](campaign-2026-10-08.md) | 8–9 Oct, 272 min, scripted scenarios on three guards                                       | 21 of 21 steps, 17 of 17 claims; 264 of 264 old or forged reads refused; 66 of 66 non-admin unlatches refused; `assert_healthy` refused unless HEALTHY; latency median 17.7 min (n=26); `submit_read` 17.7–18.5k CU, `assert_healthy` 4–5.5k CU |
| [`soak-2026-10-11.md`](soak-2026-10-11.md)         | 11–12 Oct, 1,066 min, the four guards of `keeper.soak-all.json` on the keeper's own server | 69 sent, 68 applied by the stop (the last in flight); min 15.0 · median 18.3 · p90 21.1 · max 25.3 min; one failure line (a transition without an error edge; the snapshot was retried)                                                         |

The 11–12 Oct run was stopped on purpose at 17:05 UTC to restart the keeper with the memo on its
read transactions; it continues from its state file as a second log. From 12 Oct ~17:20 UTC the
test B and test A guards are tripped and paused by `scripts/demo-states.sh`, so later status
changes on those two are deliberate.

The campaign ran on a branch whose runner is not in `develop`; its report names the keeper's old
directory, `client/`.
