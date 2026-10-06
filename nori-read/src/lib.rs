//! Verify a `NoriSnapshot` result on Solana.
//!
//! A snapshot is one leaf in a proof queue batch that the Nori program
//! committed: `target` = NoriSnapshot, keys = `[index, block << 64 | time]`,
//! value = `results_root | 1 << 255`. [`verify_snapshot_result`] checks the
//! leaf against the batch root, then `sha256(0x00 ++ query_id ++ result)`
//! against the results root.
//!
//! The consumer pins the Nori program ([`load_proof_queue_batch`], and
//! [`load_nori_proof_queue`] must equal `NoriSnapshot.proofQueue()`), the
//! NoriSnapshot address and its query ids. It also checks freshness, and keeps
//! the newest `eth_block_number` per query, because old snapshots stay valid.

use alloy_primitives::{keccak256, Address, U256};
use anchor_lang::prelude::*;
use solana_sha256_hasher::hashv;
use std::fmt;

#[cfg(feature = "test-vectors")]
pub mod test_vectors;

pub use token::deposit_witness::{VerifiedRequest, VerifiedRequestWitnessInput};
pub use token::idl_types::{Bytes32, EthAddress, U256Le};
pub use token::state::{NoriSolTokenBridge, ProofRequestRootEntry};
/// The Nori light-client program the `token` crate declares; pass another id
/// to [`load_proof_queue_batch`] to trust a different deployment.
pub use token::ID as NORI_PROGRAM_ID;

/// Most queries in one snapshot (`NoriSnapshot.MAX_QUERIES`).
pub const MAX_QUERIES: usize = 256;
/// Longest results path: a tree over `MAX_QUERIES` leaves.
pub const MAX_RESULT_PATH: usize = 8;
/// Collection keys of every snapshot leaf: the index and the time key.
pub const SNAPSHOT_COLLECTION_KEYS: u8 = 2;
/// Prefixed to every results leaf (`NoriSnapshot.RESULT_LEAF_PREFIX`).
pub const RESULT_LEAF_PREFIX: u8 = 0x00;
/// The top bit of a committed word, in its first big-endian byte.
const SENTINEL_BYTE: u8 = 0x80;

/// Everything needed to check one snapshot result, besides the query id the
/// consumer pins.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SnapshotResultWitness {
    /// The snapshot's proof request leaf, its index in the proof queue batch
    /// and its path to the batch root.
    pub request: VerifiedRequestWitnessInput,
    /// The query's 32-byte result, as the view call returned it.
    pub result: Bytes32,
    /// The result's index among the snapshot's queries.
    pub result_index: u16,
    /// Sibling hashes from the result leaf up to the results root, bottom-up.
    pub result_path: Vec<Bytes32>,
}

/// A result proven against Ethereum state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProvenResult {
    /// `keccak256(abi.encode(target, data))` of the query.
    pub query_id: [u8; 32],
    /// The 32-byte result.
    pub result: [u8; 32],
    /// `NoriSnapshot`'s index for the snapshot, from 1.
    pub snapshot_index: u64,
    /// The proof request queue id of the snapshot's commitment; unique, as it
    /// comes from the batch's cursors.
    pub request_id: u64,
    /// The Ethereum block the view call ran in.
    pub eth_block_number: u64,
    /// That block's timestamp, in seconds.
    pub eth_timestamp: u64,
    /// The finalized block whose state the batch proved (at or after
    /// `eth_block_number`; the commitment is write-once, so it is unchanged).
    pub proven_block_number: u64,
}

impl ProvenResult {
    /// The result as a `uint256`.
    pub fn result_u256(&self) -> U256 {
        U256::from_be_bytes(self.result)
    }

    /// The result as a `u64`, if it fits.
    pub fn result_u64(&self) -> Option<u64> {
        u64::try_from(self.result_u256()).ok()
    }

    /// The result as a `bool`, if it is an ABI-encoded `bool` (0 or 1).
    pub fn result_bool(&self) -> Option<bool> {
        match self.result_u256() {
            value if value == U256::ZERO => Some(false),
            value if value == U256::from(1) => Some(true),
            _ => None,
        }
    }
}

/// Why a snapshot result did not verify.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadError {
    /// The batch account is not owned by the Nori program the consumer trusts.
    BatchAccountOwner,
    /// The batch account is not a `ProofRequestRootEntry`.
    BatchAccountData,
    /// The state account is not owned by the Nori program the consumer trusts.
    StateAccountOwner,
    /// The state account is not the Nori program's bridge state.
    StateAccountData,
    /// The request witness is malformed (path too long, index or collection
    /// key count out of range).
    RequestWitness,
    /// The request leaf's path does not reach the batch root.
    BatchRootMismatch,
    /// The request index is outside the batch's cursor range.
    RequestIndexOutsideBatch { index: u64, batch_size: u64 },
    /// The leaf's target is not the `NoriSnapshot` the consumer trusts.
    NotNoriSnapshot { target: [u8; 20] },
    /// The leaf does not carry the two snapshot collection keys.
    CollectionKeysCount { count: u8 },
    /// The proven word lacks the top bit, so it is not a snapshot commitment
    /// (for example a false zero from an exclusion proof).
    MissingSentinel,
    /// The result index does not fit the results path.
    ResultIndex { index: u16, path_len: usize },
    /// The results path is longer than `MAX_RESULT_PATH`.
    ResultPathTooLong { len: usize },
    /// The result's path does not reach the committed results root.
    ResultRootMismatch,
    /// The snapshot index is zero or does not fit a `u64`. NoriSnapshot
    /// numbers snapshots from 1, so a zero index is a key the proving side
    /// read as zero, not a snapshot.
    SnapshotIndex,
    /// The time key is zero or wider than 128 bits, which NoriSnapshot never
    /// writes.
    TimeKey,
}

impl fmt::Display for ReadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BatchAccountOwner => write!(f, "proof queue batch account has the wrong owner"),
            Self::BatchAccountData => write!(f, "account is not a proof queue batch"),
            Self::StateAccountOwner => write!(f, "Nori state account has the wrong owner"),
            Self::StateAccountData => write!(f, "account is not the Nori bridge state"),
            Self::RequestWitness => write!(f, "malformed proof request witness"),
            Self::BatchRootMismatch => write!(f, "request witness does not reach the batch root"),
            Self::RequestIndexOutsideBatch { index, batch_size } => {
                write!(f, "request index {index} outside a batch of {batch_size}")
            }
            Self::NotNoriSnapshot { target } => {
                write!(
                    f,
                    "leaf target {} is not the trusted NoriSnapshot",
                    Address::from(*target)
                )
            }
            Self::CollectionKeysCount { count } => {
                write!(f, "leaf has {count} collection keys, a snapshot has 2")
            }
            Self::MissingSentinel => write!(f, "proven word lacks the snapshot sentinel"),
            Self::ResultIndex { index, path_len } => {
                write!(f, "result index {index} does not fit a path of {path_len}")
            }
            Self::ResultPathTooLong { len } => {
                write!(f, "results path of {len} exceeds {MAX_RESULT_PATH}")
            }
            Self::ResultRootMismatch => {
                write!(f, "result does not reach the committed results root")
            }
            Self::SnapshotIndex => write!(f, "snapshot index is zero or does not fit a u64"),
            Self::TimeKey => write!(f, "time key is zero or wider than 128 bits"),
        }
    }
}

impl std::error::Error for ReadError {}

/// Reads a proof queue batch account, checking that `nori_program` (the Nori
/// light-client program the consumer trusts) owns it. Only that program's
/// `update` creates such accounts, each holding one committed batch root.
pub fn load_proof_queue_batch(
    account: &AccountInfo,
    nori_program: &Pubkey,
) -> std::result::Result<ProofRequestRootEntry, ReadError> {
    if account.owner != nori_program {
        return Err(ReadError::BatchAccountOwner);
    }
    let data = account
        .try_borrow_data()
        .map_err(|_| ReadError::BatchAccountData)?;
    ProofRequestRootEntry::try_deserialize(&mut &data[..]).map_err(|_| ReadError::BatchAccountData)
}

/// Reads the Ethereum proof request queue the Nori program proves, from its
/// bridge state account, checking that `nori_program` owns it. A consumer
/// checks it equals `NoriSnapshot.proofQueue()` once, when it pins the two.
pub fn load_nori_proof_queue(
    account: &AccountInfo,
    nori_program: &Pubkey,
) -> std::result::Result<[u8; 20], ReadError> {
    if account.owner != nori_program {
        return Err(ReadError::StateAccountOwner);
    }
    let data = account
        .try_borrow_data()
        .map_err(|_| ReadError::StateAccountData)?;
    let size = std::mem::size_of::<NoriSolTokenBridge>();
    if data.len() < 8 + size || data[..8] != *NoriSolTokenBridge::DISCRIMINATOR {
        return Err(ReadError::StateAccountData);
    }
    let state: NoriSolTokenBridge = bytemuck::pod_read_unaligned(&data[8..8 + size]);
    Ok(state.eth_proof_queue_address)
}

/// Verifies one `NoriSnapshot` result against a committed proof queue batch.
///
/// * `batch` - the batch, from an account the consumer has checked is owned
///   by the Nori program it trusts ([`load_proof_queue_batch`], or Anchor's
///   `Account<ProofRequestRootEntry>` for the program the `token` crate
///   declares).
/// * `nori_snapshot` - the `NoriSnapshot` address the consumer trusts.
/// * `query_id` - the query the consumer wants. The result leaf is hashed
///   from it, so only a result committed for this query verifies.
/// * `witness` - the request leaf with its batch path, and the result with
///   its results path.
///
/// Returns the result with the snapshot's index, block and time; the caller
/// decides whether that time is fresh enough (see the crate docs for what
/// else a consumer pins and checks).
pub fn verify_snapshot_result(
    batch: &ProofRequestRootEntry,
    nori_snapshot: &[u8; 20],
    query_id: &[u8; 32],
    witness: &SnapshotResultWitness,
) -> std::result::Result<ProvenResult, ReadError> {
    let request = &witness.request;

    // 1. The request leaf is in the committed batch
    request.validate().map_err(|_| ReadError::RequestWitness)?;
    if request.root().0 != batch.root {
        return Err(ReadError::BatchRootMismatch);
    }
    let batch_size = batch
        .output_queue_cursor
        .saturating_sub(batch.input_queue_cursor);
    if request.index >= batch_size {
        return Err(ReadError::RequestIndexOutsideBatch {
            index: request.index,
            batch_size,
        });
    }

    // 2. The leaf is a NoriSnapshot commitment
    let leaf = &request.value;
    if leaf.target.0 != *nori_snapshot {
        return Err(ReadError::NotNoriSnapshot {
            target: leaf.target.0,
        });
    }
    if leaf.collection_keys_count != SNAPSHOT_COLLECTION_KEYS {
        return Err(ReadError::CollectionKeysCount {
            count: leaf.collection_keys_count,
        });
    }
    let committed = U256::from_le_bytes(leaf.value.0).to_be_bytes::<32>();
    if committed[0] & SENTINEL_BYTE == 0 {
        return Err(ReadError::MissingSentinel);
    }

    // 3. The result is in the snapshot's results tree
    let path_len = witness.result_path.len();
    if path_len > MAX_RESULT_PATH {
        return Err(ReadError::ResultPathTooLong { len: path_len });
    }
    let result_index = witness.result_index as usize;
    if result_index >= MAX_QUERIES || result_index >> path_len != 0 {
        return Err(ReadError::ResultIndex {
            index: witness.result_index,
            path_len,
        });
    }
    let mut node = hashv(&[
        &[RESULT_LEAF_PREFIX],
        query_id.as_slice(),
        witness.result.0.as_slice(),
    ])
    .to_bytes();
    for (level, sibling) in witness.result_path.iter().enumerate() {
        node = if (result_index >> level) & 1 == 1 {
            hashv(&[sibling.0.as_slice(), node.as_slice()])
        } else {
            hashv(&[node.as_slice(), sibling.0.as_slice()])
        }
        .to_bytes();
    }
    node[0] |= SENTINEL_BYTE;
    if node != committed {
        return Err(ReadError::ResultRootMismatch);
    }

    // 4. The snapshot's index and time, from its collection keys. Neither is
    //    ever zero, so a key the proving side read as zero (a false zero, as
    //    for the sentinel) is rejected rather than misreported.
    let index_key = leaf.collection_keys[0].0;
    let snapshot_index = u64_at(&index_key, 24);
    if index_key[..24].iter().any(|&byte| byte != 0) || snapshot_index == 0 {
        return Err(ReadError::SnapshotIndex);
    }
    let time_key = leaf.collection_keys[1].0;
    if time_key[..16].iter().any(|&byte| byte != 0) || time_key == [0u8; 32] {
        return Err(ReadError::TimeKey);
    }

    Ok(ProvenResult {
        query_id: *query_id,
        result: witness.result.0,
        snapshot_index,
        request_id: batch.input_queue_cursor + request.index,
        eth_block_number: u64_at(&time_key, 16),
        eth_timestamp: u64_at(&time_key, 24),
        proven_block_number: batch.output_block_number,
    })
}

/// `NoriSnapshot.queryIdOf`: `keccak256(abi.encode(target, data))`.
///
/// For configuring which query a consumer pins; it hashes in software, so
/// compute it off-chain or once.
pub fn query_id(target: &[u8; 20], data: &[u8]) -> [u8; 32] {
    let padded_len = data.len().div_ceil(32) * 32;
    let mut encoded = vec![0u8; 96 + padded_len];
    encoded[12..32].copy_from_slice(target);
    encoded[63] = 0x40; // offset of `data`, after the two head words
    encoded[64..96].copy_from_slice(&U256::from(data.len()).to_be_bytes::<32>());
    encoded[96..96 + data.len()].copy_from_slice(data);
    keccak256(&encoded).0
}

fn u64_at(word: &[u8; 32], offset: usize) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&word[offset..offset + 8]);
    u64::from_be_bytes(bytes)
}
