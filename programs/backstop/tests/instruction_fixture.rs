//! Pins Backstop instruction bytes for the TS client (`client/src/backstop.ts`).
//! `UPDATE_FIXTURES=1` rewrites them.

use anchor_lang::{prelude::Pubkey, pubkey, InstructionData};
use backstop::{BackstopError, GuardConfig, ReadKind};
use nori_read::test_vectors;

/// Any program id works; a fixed one keeps the fixtures stable when the sdk's
/// program id changes. `client/src/backstop.test.ts` uses the same.
const NORI_PROGRAM: Pubkey = pubkey!("5xS32i7XNRk7JCjYR7RgfHVxdLepVSnnJ1gdHkmfD8W1");

fn check(name: &str, data: Vec<u8>) {
    let path = format!(
        "{}/../../test-vectors/backstop/{name}.hex",
        env!("CARGO_MANIFEST_DIR")
    );
    let hex = alloy_primitives::hex::encode(&data);
    if std::env::var("UPDATE_FIXTURES").is_ok() {
        std::fs::write(&path, format!("{hex}\n")).unwrap();
    }
    assert_eq!(
        std::fs::read_to_string(&path).unwrap().trim(),
        hex,
        "{name}"
    );
}

#[test]
fn submit_read_bytes_match_the_fixture() {
    let witness = test_vectors::kelp_replay()
        .result_in(2, "lockbox-balance")
        .witness;
    check(
        "submit-read-kelp-drained",
        backstop::instruction::SubmitRead {
            kind: ReadKind::Backing,
            witness,
        }
        .data(),
    );
}

/// The sample config `client/src/backstop.test.ts` encodes.
#[test]
fn create_guard_bytes_match_the_fixture() {
    let config = GuardConfig {
        nori_program: NORI_PROGRAM,
        nori_snapshot: [0x11; 20],
        backing_query: [0x22; 32],
        pause_query: [0x33; 32],
        backing_decimals: 18,
        tolerance: 1_000_000_000,
        window_secs: 600,
        skew_secs: 60,
        checkpoint_interval_secs: 60,
        max_staleness_secs: 7_200,
    };
    check(
        "create-guard-sample",
        backstop::instruction::CreateGuard { config }.data(),
    );
}

#[test]
fn checkpoint_bytes_match_the_fixture() {
    check("checkpoint", backstop::instruction::Checkpoint {}.data());
}

/// A Guard account the TS decoder (`decodeGuard`) reads back.
#[test]
fn guard_account_bytes_match_the_fixture() {
    use anchor_lang::AccountSerialize;
    use backstop::{Checkpoint, Guard, CHECKPOINTS};

    let mut checkpoints = [Checkpoint::default(); CHECKPOINTS];
    checkpoints[0] = Checkpoint {
        time: 1_893_455_700,
        supply: 116_700_000_000_000,
    };
    let guard = Guard {
        admin: anchor_lang::prelude::Pubkey::new_from_array([1; 32]),
        mint: anchor_lang::prelude::Pubkey::new_from_array([2; 32]),
        config: GuardConfig {
            nori_program: NORI_PROGRAM,
            nori_snapshot: [0x11; 20],
            backing_query: [0x22; 32],
            pause_query: [0x33; 32],
            backing_decimals: 18,
            tolerance: 1_000_000_000,
            window_secs: 600,
            skew_secs: 60,
            checkpoint_interval_secs: 60,
            max_staleness_secs: 7_200,
        },
        eth_proof_queue: [0x44; 20],
        backing: 223_520_000_000,
        backing_eth_block: 12_345,
        backing_eth_time: 1_893_456_600,
        paused: true,
        pause_eth_block: 12_346,
        tripped: true,
        trip_eth_block: 12_345,
        trip_deficit: 116_475_480_000_000,
        checkpoints,
        checkpoint_count: 1,
        bump: 254,
    };
    let mut data = Vec::new();
    guard.try_serialize(&mut data).unwrap();
    check("guard-account-sample", data);
}

/// `client/src/keeper/keeper.ts` treats these as "nothing to do". New errors
/// go at the end of `BackstopError` so the codes never shift.
#[test]
fn error_codes_the_keeper_relies_on() {
    assert_eq!(u32::from(BackstopError::ReadNotNewer), 6005);
    assert_eq!(u32::from(BackstopError::CheckpointTooSoon), 6006);
}
