//! Pins `read_snapshot_result` instruction bytes and the `SnapshotResultRead`
//! event for the TS client (`client/src/noriRead.ts`).
//! `UPDATE_FIXTURES=1` rewrites them.

use anchor_lang::{Event, InstructionData};
use nori_read::test_vectors;
use nori_read_example::SnapshotResultRead;

fn check(name: &str, data: Vec<u8>) {
    let path = format!(
        "{}/../../test-vectors/nori-read-example/{name}.hex",
        env!("CARGO_MANIFEST_DIR")
    );
    let hex: String = data.iter().map(|byte| format!("{byte:02x}")).collect();
    if std::env::var("UPDATE_FIXTURES").is_ok() {
        std::fs::write(&path, format!("{hex}\n")).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path).unwrap().trim(),
        hex,
        "{name}"
    );
}

/// The Kelp replay's drained lockbox balance, as `client/src/snapshotWitness.test.ts` encodes it.
#[test]
fn read_snapshot_result_bytes_match_the_fixture() {
    let vectors = test_vectors::kelp_replay();
    let vector = vectors.result_in(2, "lockbox-balance");
    check(
        "read-snapshot-result-kelp-drained",
        nori_read_example::instruction::ReadSnapshotResult {
            nori_snapshot: vectors.nori_snapshot(),
            query_id: vector.query_id,
            witness: vector.witness,
        }
        .data(),
    );
}

/// The event the program emits, as `client/src/noriRead.test.ts` decodes it
/// from a `Program data:` log.
#[test]
fn snapshot_result_read_event_bytes_match_the_fixture() {
    check(
        "snapshot-result-read-event",
        SnapshotResultRead {
            query_id: [0x11; 32],
            result: [0x22; 32],
            snapshot_index: 7,
            request_id: 1_234,
            eth_block_number: 9_385_000,
            eth_timestamp: 1_791_449_064,
            proven_block_number: 9_385_064,
        }
        .data(),
    );
}
