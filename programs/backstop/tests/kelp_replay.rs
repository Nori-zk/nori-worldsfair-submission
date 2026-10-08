//! The Kelp drain replayed on surfpool. A guard over a 9-decimal rsETH mint
//! (116,700 supply) reads the replay vectors' lockbox balance and pause flag
//! while the validator clock time-travels through their 2030 timeline:
//! healthy, drained (trips), refilled (stays tripped), paused at source.

use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::instruction::Instruction;
use anchor_lang::{AccountDeserialize, AccountSerialize, AnchorDeserialize};
use anchor_lang::{Discriminator, InstructionData, ToAccountMetas};
use backstop::{BackingRead, Guard, GuardConfig, ReadKind, Status, GUARD_SEED};
use nori_read::test_vectors::{self, address, Vectors};
use nori_read::{Bytes32, NoriSolTokenBridge, NORI_PROGRAM_ID};
use test_harness::{Harness, Keypair, Signer};

const PROGRAM_SO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../target/deploy/backstop.so"
);
// Test-only program keypair matching declare_id!
const PROGRAM_KEYPAIR: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/backstop-keypair.json");

/// 2030-01-01T00:00:00Z, the replay vectors' start.
const T0: i64 = 1_893_456_000;
const RS_ETH: u64 = 1_000_000_000;
const SUPPLY: u64 = 116_700 * RS_ETH;

const ERR_SNAPSHOT_RESULT: u32 = 6003;
const ERR_READ_NOT_NEWER: u32 = 6005;
const ERR_PAUSED_AT_SOURCE: u32 = 6009;
const ERR_TRIPPED: u32 = 6010;
const ERR_PAUSE_RESULT_NOT_BOOL: u32 = 6011;
const ERR_CONSTRAINT_HAS_ONE: u32 = 2001;

struct Replay {
    h: Harness,
    vectors: Vectors,
    mint: Pubkey,
    guard: Pubkey,
    batch: Pubkey,
}

/// A raw SPL Token mint: authority none, `supply`, 9 decimals.
fn mint_data(supply: u64) -> Vec<u8> {
    let mut data = vec![0u8; 82];
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = 9; // decimals
    data[45] = 1; // initialized
    data
}

async fn setup() -> Replay {
    setup_with(|_| {}).await
}

/// `setup` with an edited guard config.
async fn setup_with(edit: impl FnOnce(&mut GuardConfig)) -> Replay {
    let h = Harness::start(PROGRAM_SO, PROGRAM_KEYPAIR).await;
    let vectors = test_vectors::kelp_replay();

    // The rsETH mint, the Nori program's state (proving the replay queue)
    // and the committed batch, as `initialize` and `update` would write them
    let mint = Pubkey::new_unique();
    h.set_account(mint, anchor_spl::token::ID, &mint_data(SUPPLY))
        .await;

    let mut state: NoriSolTokenBridge = bytemuck::Zeroable::zeroed();
    state.eth_proof_queue_address = address(&vectors.proof_queue);
    let mut state_data = NoriSolTokenBridge::DISCRIMINATOR.to_vec();
    state_data.extend_from_slice(bytemuck::bytes_of(&state));
    let nori_state = Pubkey::find_program_address(&[b"STATE"], &NORI_PROGRAM_ID).0;
    h.set_account(nori_state, NORI_PROGRAM_ID, &state_data)
        .await;

    let batch = Pubkey::find_program_address(
        &[b"PROOF_QUEUE_BATCH", &0u64.to_le_bytes()],
        &NORI_PROGRAM_ID,
    )
    .0;
    let mut batch_data = Vec::new();
    vectors.batch().try_serialize(&mut batch_data).unwrap();
    h.set_account(batch, NORI_PROGRAM_ID, &batch_data).await;

    let guard = Pubkey::find_program_address(
        &[GUARD_SEED, mint.as_ref(), h.payer.pubkey().as_ref()],
        &backstop::ID,
    )
    .0;
    let mut config = GuardConfig {
        nori_program: NORI_PROGRAM_ID,
        nori_snapshot: vectors.nori_snapshot(),
        backing_query: vectors.result("lockbox-balance").query_id,
        pause_query: vectors.result("lockbox-paused").query_id,
        backing_decimals: 18,
        tolerance: RS_ETH,
        window_secs: 600,
        skew_secs: 60,
        checkpoint_interval_secs: 60,
        max_staleness_secs: 7_200,
    };
    edit(&mut config);

    h.time_travel(T0 - 600).await;
    h.send(
        Instruction {
            program_id: backstop::ID,
            accounts: backstop::accounts::CreateGuard {
                admin: h.payer.pubkey(),
                mint,
                nori_state,
                guard,
                system_program: anchor_lang::system_program::ID,
            }
            .to_account_metas(None),
            data: backstop::instruction::CreateGuard { config }.data(),
        },
        &[],
    )
    .await
    .unwrap();

    Replay {
        h,
        vectors,
        mint,
        guard,
        batch,
    }
}

impl Replay {
    fn checkpoint(&self) -> Instruction {
        Instruction {
            program_id: backstop::ID,
            accounts: backstop::accounts::RecordCheckpoint {
                guard: self.guard,
                mint: self.mint,
            }
            .to_account_metas(None),
            data: backstop::instruction::Checkpoint {}.data(),
        }
    }

    fn submit(&self, snapshot: u64, kind: ReadKind) -> Instruction {
        let name = match kind {
            ReadKind::Backing => "lockbox-balance",
            ReadKind::Pause => "lockbox-paused",
        };
        self.submit_witness(kind, self.vectors.result_in(snapshot, name).witness)
    }

    fn submit_witness(
        &self,
        kind: ReadKind,
        witness: nori_read::SnapshotResultWitness,
    ) -> Instruction {
        Instruction {
            program_id: backstop::ID,
            accounts: backstop::accounts::SubmitRead {
                guard: self.guard,
                mint: self.mint,
                proof_queue_batch: self.batch,
            }
            .to_account_metas(None),
            data: backstop::instruction::SubmitRead { kind, witness }.data(),
        }
    }

    fn read_guard(&self, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: backstop::ID,
            accounts: backstop::accounts::ReadGuard {
                guard: self.guard,
                mint: self.mint,
            }
            .to_account_metas(None),
            data,
        }
    }

    async fn status(&self) -> Status {
        let sent = self
            .h
            .send(
                self.read_guard(backstop::instruction::Status {}.data()),
                &[],
            )
            .await
            .unwrap();
        Status::deserialize(&mut &sent.return_data[..]).unwrap()
    }

    async fn assert_healthy(&self) -> Result<(), u32> {
        let ix = self.read_guard(backstop::instruction::AssertHealthy {}.data());
        match self.h.send(ix, &[]).await {
            Ok(_) => Ok(()),
            Err(error) => Err(test_harness::custom_error_code(&error)),
        }
    }

    fn unlatch(&self, admin: &Keypair) -> Instruction {
        Instruction {
            program_id: backstop::ID,
            accounts: backstop::accounts::Unlatch {
                admin: admin.pubkey(),
                guard: self.guard,
            }
            .to_account_metas(None),
            data: backstop::instruction::Unlatch {}.data(),
        }
    }

    async fn guard_account(&self) -> Guard {
        Guard::try_deserialize(&mut &self.h.account_data(&self.guard).await[..]).unwrap()
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn kelp_drain_trips_the_guard_and_a_refill_does_not_reset_it() {
    let r = setup().await;

    // Supply checkpoints inside each snapshot's window
    for at in [T0 - 300, T0 + 300, T0 + 1_500] {
        r.h.time_travel(at).await;
        r.h.send(r.checkpoint(), &[]).await.unwrap();
    }
    // 10 minutes after the last snapshot, the proofs have landed
    r.h.time_travel(T0 + 3_600).await;

    // Snapshot 1: 116,723.52 rsETH backs 116,700
    let sent = r.h.send(r.submit(1, ReadKind::Backing), &[]).await.unwrap();
    println!(
        "submit_read: {} CU, {} bytes",
        sent.compute_units, sent.transaction_bytes
    );
    r.h.send(r.submit(1, ReadKind::Pause), &[]).await.unwrap();
    assert_eq!(r.status().await, Status::Healthy);
    let sent =
        r.h.send(
            r.read_guard(backstop::instruction::AssertHealthy {}.data()),
            &[],
        )
        .await
        .unwrap();
    println!("assert_healthy: {} CU", sent.compute_units);
    assert!(
        sent.compute_units < 30_000,
        "assert_healthy is under 30k CU"
    );

    // Snapshot 2: drained to 223.52, trips
    let sent = r.h.send(r.submit(2, ReadKind::Backing), &[]).await.unwrap();
    let read: BackingRead = sent.event();
    assert!(read.tripped);
    assert_eq!(read.deficit, SUPPLY - 223_520_000_000 - RS_ETH);
    assert_eq!(r.assert_healthy().await, Err(ERR_TRIPPED));

    // An old or forged read is refused
    assert_eq!(
        r.h.error_code(r.submit(1, ReadKind::Backing), &[]).await,
        ERR_READ_NOT_NEWER
    );
    let mut forged = r.vectors.result_in(3, "lockbox-balance").witness;
    forged.result = Bytes32([0x0f; 32]);
    assert_eq!(
        r.h.error_code(r.submit_witness(ReadKind::Backing, forged), &[])
            .await,
        ERR_SNAPSHOT_RESULT
    );

    // Snapshot 3: refilled to 40,300, still tripped
    r.h.send(r.submit(3, ReadKind::Backing), &[]).await.unwrap();
    let guard = r.guard_account().await;
    assert!(guard.tripped);
    assert_eq!(
        guard.trip_eth_block,
        r.vectors
            .result_in(2, "lockbox-balance")
            .snapshot
            .block_number
    );
    assert_eq!(guard.backing, 40_300 * RS_ETH);

    // Snapshot 4: paused on Ethereum
    r.h.send(r.submit(4, ReadKind::Pause), &[]).await.unwrap();

    // Only the admin unlatches; the source pause remains
    let stranger = Keypair::new();
    assert_eq!(
        r.h.error_code(r.unlatch(&stranger), &[&stranger]).await,
        ERR_CONSTRAINT_HAS_ONE
    );
    r.h.send(r.unlatch(&r.h.payer), &[]).await.unwrap();
    assert_eq!(r.status().await, Status::PausedAtSource);
    assert_eq!(r.assert_healthy().await, Err(ERR_PAUSED_AT_SOURCE));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_pause_query_that_is_not_a_bool_is_rejected() {
    // Misconfigured: the pause query is the lockbox's balance getter
    let r = setup_with(|config| config.pause_query = config.backing_query).await;
    let balance = r.vectors.result_in(1, "lockbox-balance").witness;

    assert_eq!(
        r.h.error_code(r.submit_witness(ReadKind::Pause, balance), &[])
            .await,
        ERR_PAUSE_RESULT_NOT_BOOL
    );
    assert!(!r.guard_account().await.paused);
}
