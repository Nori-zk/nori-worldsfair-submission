//! Pins `submit_read`'s instruction bytes for the TS client: the backing read
//! of the Kelp replay's drained snapshot. `UPDATE_FIXTURES=1` rewrites it.

use anchor_lang::InstructionData;
use backstop::ReadKind;
use nori_read::test_vectors;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../test-vectors/backstop/submit-read-kelp-drained.hex"
);

#[test]
fn submit_read_bytes_match_the_fixture() {
    let witness = test_vectors::kelp_replay()
        .result_in(2, "lockbox-balance")
        .witness;
    let data = backstop::instruction::SubmitRead {
        kind: ReadKind::Backing,
        witness,
    }
    .data();
    let hex = alloy_primitives::hex::encode(&data);

    if std::env::var("UPDATE_FIXTURES").is_ok() {
        std::fs::write(FIXTURE, format!("{hex}\n")).unwrap();
    }
    assert_eq!(std::fs::read_to_string(FIXTURE).unwrap().trim(), hex);
}
