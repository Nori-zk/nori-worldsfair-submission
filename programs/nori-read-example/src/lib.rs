//! The smallest consumer of nori-read: verifies one NoriSnapshot result
//! against a proof queue batch committed by the Nori light client, and emits
//! it.
//!
//! A real consumer pins the NoriSnapshot address and the query ids it acts on
//! in its own configuration, and checks the result's age; this example takes
//! both from the caller so one deployment can read any snapshot.

use anchor_lang::prelude::*;
use nori_read::{load_proof_queue_batch, verify_snapshot_result, SnapshotResultWitness};

declare_id!("5tA2aWbrP7JaKtcP2sJTp676TbFc6MEF7hcWCo9KqhS7");

#[program]
pub mod nori_read_example {
    use super::*;

    /// Verify `witness` proves `query_id`'s result in a snapshot taken by
    /// `nori_snapshot`, against `proof_queue_batch`, and emit the result.
    pub fn read_snapshot_result(
        ctx: Context<ReadSnapshotResult>,
        nori_snapshot: [u8; 20],
        query_id: [u8; 32],
        witness: SnapshotResultWitness,
    ) -> Result<()> {
        let batch =
            load_proof_queue_batch(&ctx.accounts.proof_queue_batch, &nori_read::NORI_PROGRAM_ID)
                .map_err(|error| {
                    msg!("{}", error);
                    error!(NoriReadExampleError::InvalidProofQueueBatch)
                })?;
        let proven = verify_snapshot_result(&batch, &nori_snapshot, &query_id, &witness).map_err(
            |error| {
                msg!("{}", error);
                error!(NoriReadExampleError::InvalidSnapshotResult)
            },
        )?;

        emit!(SnapshotResultRead {
            query_id: proven.query_id,
            result: proven.result,
            snapshot_index: proven.snapshot_index,
            request_id: proven.request_id,
            eth_block_number: proven.eth_block_number,
            eth_timestamp: proven.eth_timestamp,
            proven_block_number: proven.proven_block_number,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ReadSnapshotResult<'info> {
    /// CHECK: owner (the Nori program) and type are checked by
    /// `nori_read::load_proof_queue_batch`.
    pub proof_queue_batch: UncheckedAccount<'info>,
}

/// A result proven against Ethereum state; see `nori_read::ProvenResult`.
#[event]
pub struct SnapshotResultRead {
    pub query_id: [u8; 32],
    pub result: [u8; 32],
    pub snapshot_index: u64,
    pub request_id: u64,
    pub eth_block_number: u64,
    pub eth_timestamp: u64,
    pub proven_block_number: u64,
}

#[error_code]
pub enum NoriReadExampleError {
    #[msg("Not a proof queue batch of the trusted Nori program")]
    InvalidProofQueueBatch,
    #[msg("The snapshot result does not verify")]
    InvalidSnapshotResult,
}
