//! The NoriSnapshot read vectors in test-vectors/nori-snapshot, generated
//! from the NoriSnapshot and NoriProofRequestQueue contracts with the sdk's
//! hashing wasm (`npm run vectors -w ethereum`), as nori-read types.
//! Enabled by the `test-vectors` feature, for tests only.

use crate::{
    Bytes32, EthAddress, ProofRequestRootEntry, SnapshotResultWitness, VerifiedRequest,
    VerifiedRequestWitnessInput,
};
use alloy_primitives::{hex, Address, B256, U256};
use serde::Deserialize;

/// Reproducible vectors: batch `[1, 5)` on a local network, holding a request
/// that is not a snapshot and three snapshots (two and five queries, and the
/// identity-precompile forgery).
pub const LOCAL_JSON: &str =
    include_str!("../../test-vectors/nori-snapshot/snapshot-read-vectors.json");
/// One snapshot of every mainnet query, taken on a mainnet fork.
pub const MAINNET_JSON: &str =
    include_str!("../../test-vectors/nori-snapshot/snapshot-read-mainnet-vectors.json");
/// The Kelp drain replayed: four snapshots of a lockbox's balance and pause
/// flag, at fixed times from 2030-01-01.
pub const KELP_REPLAY_JSON: &str =
    include_str!("../../test-vectors/nori-snapshot/kelp-replay-vectors.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vectors {
    pub description: String,
    pub nori_snapshot: String,
    pub proof_queue: String,
    pub batch: Batch,
    pub requests: Vec<Request>,
    pub snapshots: Vec<Snapshot>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub root: String,
    pub input_queue_cursor: u64,
    pub output_queue_cursor: u64,
    pub output_block_number: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub request_id: u64,
    pub index: u64,
    pub target: String,
    pub collection_keys_count: u8,
    pub collection_keys: [String; 2],
    pub value: String,
    pub leaf: String,
    pub path: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub snapshot_index: u64,
    pub request_id: u64,
    pub block_number: u64,
    pub timestamp: u64,
    pub results: Vec<SnapshotResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub name: String,
    pub target: String,
    pub data: String,
    pub query_id: String,
    pub result: String,
    pub index: u16,
    pub path: Vec<String>,
}

/// One snapshot result with everything a consumer passes to
/// [`crate::verify_snapshot_result`], and what it should return.
pub struct VectorResult<'a> {
    pub snapshot: &'a Snapshot,
    pub result: &'a SnapshotResult,
    pub query_id: [u8; 32],
    pub witness: SnapshotResultWitness,
}

pub fn local() -> Vectors {
    serde_json::from_str(LOCAL_JSON).expect("local vectors parse")
}

pub fn mainnet() -> Vectors {
    serde_json::from_str(MAINNET_JSON).expect("mainnet vectors parse")
}

pub fn kelp_replay() -> Vectors {
    serde_json::from_str(KELP_REPLAY_JSON).expect("Kelp replay vectors parse")
}

/// A 0x-prefixed 32-byte hex word.
pub fn word(hex: &str) -> [u8; 32] {
    hex.parse::<B256>().expect("32-byte hex").0
}

/// A 0x-prefixed Ethereum address.
pub fn address(hex: &str) -> [u8; 20] {
    hex.parse::<Address>().expect("address hex").into_array()
}

/// 0x-prefixed hex bytes of any length.
pub fn bytes(hex: &str) -> Vec<u8> {
    hex::decode(hex).expect("hex bytes")
}

fn bytes32s(hexes: &[String]) -> Vec<Bytes32> {
    hexes.iter().map(|hex| Bytes32(word(hex))).collect()
}

impl Vectors {
    /// The batch as `update` commits it.
    pub fn batch(&self) -> ProofRequestRootEntry {
        ProofRequestRootEntry {
            root: word(&self.batch.root),
            output_block_number: self.batch.output_block_number,
            input_queue_cursor: self.batch.input_queue_cursor,
            output_queue_cursor: self.batch.output_queue_cursor,
        }
    }

    pub fn nori_snapshot(&self) -> [u8; 20] {
        address(&self.nori_snapshot)
    }

    pub fn request(&self, request_id: u64) -> &Request {
        self.requests
            .iter()
            .find(|request| request.request_id == request_id)
            .expect("request in batch")
    }

    pub fn request_witness(&self, request_id: u64) -> VerifiedRequestWitnessInput {
        let request = self.request(request_id);
        VerifiedRequestWitnessInput {
            path: bytes32s(&request.path),
            index: request.index,
            value: VerifiedRequest {
                target: EthAddress(address(&request.target)),
                collection_keys_count: request.collection_keys_count,
                collection_keys: [
                    Bytes32(word(&request.collection_keys[0])),
                    Bytes32(word(&request.collection_keys[1])),
                ],
                value: U256::from_be_bytes(word(&request.value)).into(),
            },
        }
    }

    /// Every snapshot result in the batch, in order.
    pub fn results(&self) -> Vec<VectorResult<'_>> {
        self.snapshots
            .iter()
            .flat_map(|snapshot| {
                snapshot.results.iter().map(move |result| VectorResult {
                    snapshot,
                    result,
                    query_id: word(&result.query_id),
                    witness: SnapshotResultWitness {
                        request: self.request_witness(snapshot.request_id),
                        result: Bytes32(word(&result.result)),
                        result_index: result.index,
                        result_path: bytes32s(&result.path),
                    },
                })
            })
            .collect()
    }

    /// The first result of the query called `name`.
    pub fn result(&self, name: &str) -> VectorResult<'_> {
        self.results()
            .into_iter()
            .find(|vector| vector.result.name == name)
            .unwrap_or_else(|| panic!("no query {name} in the vectors"))
    }

    /// The result of the query called `name` in the snapshot with `snapshot_index`.
    pub fn result_in(&self, snapshot_index: u64, name: &str) -> VectorResult<'_> {
        self.results()
            .into_iter()
            .find(|vector| {
                vector.snapshot.snapshot_index == snapshot_index && vector.result.name == name
            })
            .unwrap_or_else(|| panic!("no query {name} in snapshot {snapshot_index}"))
    }
}
