# NoriSnapshot read vectors

Generated from the contracts by `npm run vectors -w ethereum`; read by `nori-read` and its programs' tests.

- `snapshot-read-vectors.json`: reproducible local batch. It holds a non-snapshot request, two snapshots, and a forgery attempt that must fail. `npm test` checks the file is current.
- `snapshot-read-mainnet-vectors.json`: real mainnet contracts on a local fork (`npm run vectors:mainnet`). It is not a real deployment or proof.
- `kelp-replay-vectors.json`: the Kelp drain with its real lockbox numbers, dated from 2030 so validator tests can time-travel to it. `npm test` checks the file is current.
