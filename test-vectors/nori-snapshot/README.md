# NoriSnapshot read vectors

Generated from the contracts by `npm run vectors -w ethereum`; read by `nori-read` and its programs' tests.

- `snapshot-read-vectors.json`: reproducible local batch. It holds a non-snapshot request, two snapshots, and a forgery attempt that must fail. `npm test` checks the file is current.
- `snapshot-read-mainnet-vectors.json`: real mainnet contracts on a local fork (`npm run vectors:mainnet`). It is not a real deployment or proof.
- `kelp-replay-vectors.json`: the Kelp drain with its real lockbox numbers. The dates are not real: they start in 2030 because surfpool only time-travels forward and guards check staleness against the validator clock. The live demo drains the Sepolia DemoLockbox instead. `npm test` checks the file is current.
