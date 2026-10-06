//! `read_snapshot_result` on surfpool: every mainnet query in the mainnet
//! fork vectors, verified on-chain. The batch account is planted with
//! `surfnet_setAccount`, as `update` would write it.

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction};
use anchor_lang::{AccountSerialize, InstructionData, ToAccountMetas};
use nori_read::test_vectors::{self, VectorResult};
use nori_read::{Bytes32, NORI_PROGRAM_ID};
use nori_read_example::SnapshotResultRead;
use test_harness::Harness;

const PROGRAM_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/nori_read_example.so"
);
// Test-only program keypair matching declare_id!
const PROGRAM_KEYPAIR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/nori_read_example-keypair.json"
);

const ERR_INVALID_PROOF_QUEUE_BATCH: u32 = 6000;
const ERR_INVALID_SNAPSHOT_RESULT: u32 = 6001;

fn batch_address() -> Pubkey {
    Pubkey::find_program_address(
        &[b"PROOF_QUEUE_BATCH", &0u64.to_le_bytes()],
        &NORI_PROGRAM_ID,
    )
    .0
}

async fn setup() -> (Harness, test_vectors::Vectors) {
    let h = Harness::start(PROGRAM_SO, PROGRAM_KEYPAIR).await;
    let vectors = test_vectors::mainnet();
    let mut data = Vec::new();
    vectors.batch().try_serialize(&mut data).unwrap();
    h.set_account(batch_address(), NORI_PROGRAM_ID, &data).await;
    (h, vectors)
}

fn read(batch: Pubkey, nori_snapshot: [u8; 20], vector: &VectorResult<'_>) -> Instruction {
    Instruction {
        program_id: nori_read_example::ID,
        accounts: nori_read_example::accounts::ReadSnapshotResult {
            proof_queue_batch: batch,
        }
        .to_account_metas(None),
        data: nori_read_example::instruction::ReadSnapshotResult {
            nori_snapshot,
            query_id: vector.query_id,
            witness: vector.witness.clone(),
        }
        .data(),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn reads_every_mainnet_query_on_chain() {
    let (h, vectors) = setup().await;
    let mut max = (0, 0);
    for vector in vectors.results() {
        let sent = h
            .send(read(batch_address(), vectors.nori_snapshot(), &vector), &[])
            .await
            .unwrap();
        let event: SnapshotResultRead = sent.event();
        assert_eq!(event.result, test_vectors::word(&vector.result.result));
        assert_eq!(event.eth_timestamp, vector.snapshot.timestamp);
        println!(
            "{:>28}: {} CU, {} bytes",
            vector.result.name, sent.compute_units, sent.transaction_bytes
        );
        max = (
            max.0.max(sent.compute_units),
            max.1.max(sent.transaction_bytes),
        );
    }
    assert!(
        max.0 < 100_000 && max.1 <= 1232,
        "max {} CU, {} bytes",
        max.0,
        max.1
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn rejects_forged_results_and_untrusted_batch_accounts() {
    let (h, vectors) = setup().await;
    let vector = vectors.result("usds-lockbox");

    let mut forged = vector.witness.clone();
    forged.result = Bytes32([0xff; 32]);
    let forged = VectorResult {
        witness: forged,
        ..vectors.result("usds-lockbox")
    };
    let code = h
        .error_code(read(batch_address(), vectors.nori_snapshot(), &forged), &[])
        .await;
    assert_eq!(code, ERR_INVALID_SNAPSHOT_RESULT);

    let impostor = Pubkey::new_unique();
    let mut data = Vec::new();
    vectors.batch().try_serialize(&mut data).unwrap();
    h.set_account(impostor, Pubkey::new_unique(), &data).await;
    let code = h
        .error_code(read(impostor, vectors.nori_snapshot(), &vector), &[])
        .await;
    assert_eq!(code, ERR_INVALID_PROOF_QUEUE_BATCH);
}
