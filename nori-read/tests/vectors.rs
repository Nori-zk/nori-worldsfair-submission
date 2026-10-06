//! nori-read against test-vectors/nori-snapshot, generated from the
//! NoriSnapshot and NoriProofRequestQueue contracts with nori-hash-utils
//! (`npm run vectors -w ethereum`), and against witnesses forged from them.

use alloy_primitives::U256;
use anchor_lang::prelude::*;
use anchor_lang::{AccountSerialize, Discriminator};
use nori_read::test_vectors::{self, address, bytes, word, Vectors};
use nori_read::{
    load_nori_proof_queue, load_proof_queue_batch, query_id, verify_snapshot_result, Bytes32,
    EthAddress, NoriSolTokenBridge, ProofRequestRootEntry, ReadError, SnapshotResultWitness,
    VerifiedRequest, VerifiedRequestWitnessInput, MAX_RESULT_PATH, NORI_PROGRAM_ID,
    RESULT_LEAF_PREFIX,
};
use solana_sha256_hasher::hashv;

fn both() -> [Vectors; 3] {
    [
        test_vectors::local(),
        test_vectors::mainnet(),
        test_vectors::kelp_replay(),
    ]
}

/// A batch of one snapshot leaf whose results tree holds one result, built
/// here rather than by the contracts, for leaves the contracts never write.
fn single_leaf_batch(
    nori_snapshot: [u8; 20],
    keys: [[u8; 32]; 2],
    committed: [u8; 32],
) -> (ProofRequestRootEntry, VerifiedRequestWitnessInput) {
    let request = VerifiedRequestWitnessInput {
        path: vec![],
        index: 0,
        value: VerifiedRequest {
            target: EthAddress(nori_snapshot),
            collection_keys_count: 2,
            collection_keys: [Bytes32(keys[0]), Bytes32(keys[1])],
            value: U256::from_be_bytes(committed).into(),
        },
    };
    let batch = ProofRequestRootEntry {
        root: request.value.leaf_hash().0,
        output_block_number: 100,
        input_queue_cursor: 5,
        output_queue_cursor: 6,
    };
    (batch, request)
}

fn commitment_of_one(query_id: &[u8; 32], result: &[u8; 32]) -> [u8; 32] {
    let mut root = hashv(&[
        &[RESULT_LEAF_PREFIX],
        query_id.as_slice(),
        result.as_slice(),
    ])
    .to_bytes();
    root[0] |= 0x80;
    root
}

/// Snapshot index 1
const INDEX_KEY_1: [u8; 32] = {
    let mut key = [0u8; 32];
    key[31] = 1;
    key
};

/// block 10 << 64 | timestamp 1_784_621_632
const TIME_KEY: &str = "0x00000000000000000000000000000000000000000000000a000000006a5f2a40";

// -----------------------------------------------------------------
// The vectors themselves
// -----------------------------------------------------------------

#[test]
fn request_leaves_hash_like_the_token_program_and_reach_the_batch_root() {
    for vectors in both() {
        for request in &vectors.requests {
            let witness = vectors.request_witness(request.request_id);
            witness.validate().expect("valid witness");
            assert_eq!(witness.value.leaf_hash().0, word(&request.leaf));
            assert_eq!(witness.root().0, vectors.batch().root);
        }
    }
}

#[test]
fn every_snapshot_result_verifies_with_its_index_block_and_time() {
    for vectors in both() {
        let batch = vectors.batch();
        let results = vectors.results();
        assert!(!results.is_empty());
        for vector in results {
            let proven = verify_snapshot_result(
                &batch,
                &vectors.nori_snapshot(),
                &vector.query_id,
                &vector.witness,
            )
            .unwrap_or_else(|error| panic!("{}: {error}", vector.result.name));

            assert_eq!(proven.query_id, vector.query_id);
            assert_eq!(proven.result, word(&vector.result.result));
            assert_eq!(proven.snapshot_index, vector.snapshot.snapshot_index);
            assert_eq!(proven.request_id, vector.snapshot.request_id);
            assert_eq!(proven.eth_block_number, vector.snapshot.block_number);
            assert_eq!(proven.eth_timestamp, vector.snapshot.timestamp);
            assert_eq!(
                proven.proven_block_number,
                vectors.batch.output_block_number
            );
        }
    }
}

#[test]
fn query_id_matches_the_contract() {
    for vectors in both() {
        for vector in vectors.results() {
            assert_eq!(
                query_id(&address(&vector.result.target), &bytes(&vector.result.data)),
                vector.query_id,
                "{}",
                vector.result.name
            );
        }
    }
}

#[test]
fn reads_real_mainnet_backing_and_pause_flags() {
    let vectors = test_vectors::mainnet();
    let batch = vectors.batch();
    let read = |name: &str| {
        let vector = vectors.result(name);
        verify_snapshot_result(
            &batch,
            &vectors.nori_snapshot(),
            &vector.query_id,
            &vector.witness,
        )
        .unwrap()
    };

    assert!(read("usds-lockbox").result_u256() > U256::ZERO);
    assert_eq!(read("usds-lockbox-paused").result_bool(), Some(false));
    assert_eq!(read("aave-ntt-hub-paused").result_bool(), Some(false));
    // Wormhole custody (18 decimals) covers what it bridged out (8 decimals)
    let outstanding = read("wormhole-weth-outstanding").result_u256();
    let custody = read("wormhole-weth-custody").result_u256();
    assert!(custody >= outstanding * U256::from(10u64.pow(10)));
    assert!(read("wormhole-wbtc-outstanding").result_u64().is_some());
}

// -----------------------------------------------------------------
// Forged and malformed witnesses
// -----------------------------------------------------------------

/// Result 1 (`isPaused`) of the five-query snapshot: a three-level path.
fn five_query_result(vectors: &Vectors) -> (SnapshotResultWitness, [u8; 32]) {
    let vector = vectors
        .results()
        .into_iter()
        .find(|vector| vector.snapshot.results.len() == 5 && vector.result.index == 1)
        .expect("result 1 of the five-query snapshot");
    (vector.witness, vector.query_id)
}

#[test]
fn rejects_a_result_for_another_query() {
    let vectors = test_vectors::local();
    let (witness, _) = five_query_result(&vectors);
    let other_query = word(&vectors.snapshots[1].results[0].query_id);

    assert_eq!(
        verify_snapshot_result(
            &vectors.batch(),
            &vectors.nori_snapshot(),
            &other_query,
            &witness
        ),
        Err(ReadError::ResultRootMismatch)
    );
}

#[test]
fn rejects_a_tampered_result_index_or_path() {
    let vectors = test_vectors::local();
    let (witness, pinned) = five_query_result(&vectors);
    let verify = |witness: &SnapshotResultWitness| {
        verify_snapshot_result(&vectors.batch(), &vectors.nori_snapshot(), &pinned, witness)
    };
    assert!(verify(&witness).is_ok());

    let mut tampered = witness.clone();
    tampered.result.0[31] ^= 1;
    assert_eq!(verify(&tampered), Err(ReadError::ResultRootMismatch));

    let mut moved = witness.clone();
    moved.result_index = 0;
    assert_eq!(verify(&moved), Err(ReadError::ResultRootMismatch));

    let mut wrong_sibling = witness.clone();
    wrong_sibling.result_path[2].0[0] ^= 1;
    assert_eq!(verify(&wrong_sibling), Err(ReadError::ResultRootMismatch));

    let mut short = witness.clone();
    short.result_path.pop();
    assert_eq!(verify(&short), Err(ReadError::ResultRootMismatch));

    let mut beyond = witness.clone();
    beyond.result_index = 8; // a three-level path holds indices 0..8
    assert_eq!(
        verify(&beyond),
        Err(ReadError::ResultIndex {
            index: 8,
            path_len: 3
        })
    );

    let mut long = witness.clone();
    long.result_path = vec![Bytes32([7; 32]); MAX_RESULT_PATH + 1];
    assert_eq!(
        verify(&long),
        Err(ReadError::ResultPathTooLong {
            len: MAX_RESULT_PATH + 1
        })
    );
}

#[test]
fn rejects_another_nori_snapshot_and_leaves_that_are_not_snapshots() {
    let vectors = test_vectors::local();
    let batch = vectors.batch();
    let (witness, pinned) = five_query_result(&vectors);

    let impostor = [0x11; 20];
    assert_eq!(
        verify_snapshot_result(&batch, &impostor, &pinned, &witness),
        Err(ReadError::NotNoriSnapshot {
            target: vectors.nori_snapshot()
        })
    );

    // Request 1 is an account proving its own empty storage
    let foreign = SnapshotResultWitness {
        request: vectors.request_witness(1),
        ..witness.clone()
    };
    let foreign_target = address(&vectors.request(1).target);
    assert_eq!(
        verify_snapshot_result(&batch, &vectors.nori_snapshot(), &pinned, &foreign),
        Err(ReadError::NotNoriSnapshot {
            target: foreign_target
        })
    );
    // Even a consumer misconfigured to trust that account learns nothing
    assert_eq!(
        verify_snapshot_result(&batch, &foreign_target, &pinned, &foreign),
        Err(ReadError::CollectionKeysCount { count: 0 })
    );
}

#[test]
fn rejects_a_request_not_in_the_batch() {
    let local = test_vectors::local();
    let mainnet = test_vectors::mainnet();
    let (witness, pinned) = five_query_result(&local);

    // The same witness against another batch's root
    assert_eq!(
        verify_snapshot_result(&mainnet.batch(), &local.nori_snapshot(), &pinned, &witness),
        Err(ReadError::BatchRootMismatch)
    );

    // A batch whose cursor range ends before the request's index (2)
    let mut short_batch = local.batch();
    short_batch.output_queue_cursor = short_batch.input_queue_cursor + 2;
    assert_eq!(
        verify_snapshot_result(&short_batch, &local.nori_snapshot(), &pinned, &witness),
        Err(ReadError::RequestIndexOutsideBatch {
            index: 2,
            batch_size: 2
        })
    );

    let mut malformed = witness.clone();
    malformed.request.path = vec![Bytes32([0; 32]); 17];
    assert_eq!(
        verify_snapshot_result(&local.batch(), &local.nori_snapshot(), &pinned, &malformed),
        Err(ReadError::RequestWitness)
    );
}

#[test]
fn rejects_proven_words_without_the_sentinel() {
    let nori_snapshot = [0x22; 20];
    let pinned = [0x33; 32];
    let result = [0x44; 32];
    let mut uncommitted = commitment_of_one(&pinned, &result);
    uncommitted[0] &= 0x7f;

    // A false zero (an exclusion proof for an unwritten slot) and a word
    // whose root matches but lacks the top bit
    for proven in [[0u8; 32], uncommitted] {
        let (batch, request) =
            single_leaf_batch(nori_snapshot, [INDEX_KEY_1, word(TIME_KEY)], proven);
        let witness = SnapshotResultWitness {
            request,
            result: Bytes32(result),
            result_index: 0,
            result_path: vec![],
        };
        assert_eq!(
            verify_snapshot_result(&batch, &nori_snapshot, &pinned, &witness),
            Err(ReadError::MissingSentinel)
        );
    }
}

#[test]
fn reads_index_and_time_keys_and_rejects_an_index_beyond_u64() {
    let nori_snapshot = [0x22; 20];
    let pinned = [0x33; 32];
    let result = [0x44; 32];
    let committed = commitment_of_one(&pinned, &result);
    let witness_for = |request| SnapshotResultWitness {
        request,
        result: Bytes32(result),
        result_index: 0,
        result_path: vec![],
    };

    let mut index_key = [0u8; 32];
    index_key[31] = 9;
    let (batch, request) = single_leaf_batch(nori_snapshot, [index_key, word(TIME_KEY)], committed);
    let proven = verify_snapshot_result(&batch, &nori_snapshot, &pinned, &witness_for(request))
        .expect("single-result snapshot verifies");
    assert_eq!(proven.snapshot_index, 9);
    assert_eq!(proven.request_id, 5);
    assert_eq!(proven.eth_block_number, 10);
    assert_eq!(proven.eth_timestamp, 0x6a5f_2a40);
    assert_eq!(proven.proven_block_number, 100);

    // Keys NoriSnapshot never writes, as a false zero from the proving side
    // would make them: index 0, an index beyond u64, a zero or wide time key
    let mut wide_index = index_key;
    wide_index[23] = 1;
    let mut wide_time = word(TIME_KEY);
    wide_time[15] = 1;
    for (keys, error) in [
        ([[0u8; 32], word(TIME_KEY)], ReadError::SnapshotIndex),
        ([wide_index, word(TIME_KEY)], ReadError::SnapshotIndex),
        ([index_key, [0u8; 32]], ReadError::TimeKey),
        ([index_key, wide_time], ReadError::TimeKey),
    ] {
        let (batch, request) = single_leaf_batch(nori_snapshot, keys, committed);
        assert_eq!(
            verify_snapshot_result(&batch, &nori_snapshot, &pinned, &witness_for(request)),
            Err(error)
        );
    }
}

#[test]
fn rejects_an_attacker_result_presented_as_a_node_one_level_up() {
    // Request 4 snapshots the identity precompile, whose result the attacker
    // chose: sha256(queryId(value()) ++ 2^200), an unprefixed node over a
    // forged value() result
    let vectors = test_vectors::local();
    let batch = vectors.batch();
    let identity = vectors.result("identity-forgery");
    let pinned = vectors.results()[0].query_id; // value()
    assert_eq!(vectors.results()[0].result.name, "value");
    let mut forged_result = [0u8; 32];
    forged_result[6] = 1; // 2^200

    // The genuine result verifies
    assert!(verify_snapshot_result(
        &batch,
        &vectors.nori_snapshot(),
        &identity.query_id,
        &identity.witness
    )
    .is_ok());

    // value() = 2^200 at index 1 under sibling queryId(identity): the
    // unprefixed tree would accept it, the prefixed one does not
    let forged = SnapshotResultWitness {
        result: Bytes32(forged_result),
        result_index: 1,
        result_path: vec![Bytes32(identity.query_id)],
        ..identity.witness.clone()
    };
    assert_eq!(
        hashv(&[pinned.as_slice(), forged_result.as_slice()]).to_bytes(),
        word(&identity.result.result),
        "the vector holds the unprefixed node"
    );
    assert_eq!(
        verify_snapshot_result(&batch, &vectors.nori_snapshot(), &pinned, &forged),
        Err(ReadError::ResultRootMismatch)
    );
}

// -----------------------------------------------------------------
// Loading the batch account
// -----------------------------------------------------------------

#[test]
fn loads_only_batch_accounts_owned_by_the_trusted_nori_program() {
    let entry = test_vectors::local().batch();
    let mut data = Vec::new();
    entry.try_serialize(&mut data).expect("serialize");
    assert_eq!(&data[..8], ProofRequestRootEntry::DISCRIMINATOR);

    let key = Pubkey::new_unique();
    let other_program = Pubkey::new_unique();
    let load_as = |owner: &Pubkey, bytes: &mut [u8]| {
        let mut lamports = 1_000_000u64;
        let info = AccountInfo::new(&key, false, false, &mut lamports, bytes, owner, false);
        load_proof_queue_batch(&info, &NORI_PROGRAM_ID)
    };

    let loaded = load_as(&NORI_PROGRAM_ID, &mut data.clone()).expect("owned batch loads");
    assert_eq!(loaded.root, entry.root);
    assert_eq!(loaded.input_queue_cursor, entry.input_queue_cursor);
    assert_eq!(loaded.output_queue_cursor, entry.output_queue_cursor);
    assert_eq!(loaded.output_block_number, entry.output_block_number);

    assert_eq!(
        load_as(&other_program, &mut data.clone()).map(|_| ()),
        Err(ReadError::BatchAccountOwner)
    );
    let mut wrong_discriminator = data.clone();
    wrong_discriminator[0] ^= 1;
    assert_eq!(
        load_as(&NORI_PROGRAM_ID, &mut wrong_discriminator).map(|_| ()),
        Err(ReadError::BatchAccountData)
    );
}

#[test]
fn reads_the_proof_queue_the_trusted_nori_program_proves() {
    let mut state: NoriSolTokenBridge = bytemuck::Zeroable::zeroed();
    state.eth_proof_queue_address = [0x5f; 20];
    state.queue_cursor = 7;
    let mut data = NoriSolTokenBridge::DISCRIMINATOR.to_vec();
    data.extend_from_slice(bytemuck::bytes_of(&state));

    let key = Pubkey::new_unique();
    let load_as = |owner: &Pubkey, bytes: &mut [u8]| {
        let mut lamports = 1_000_000u64;
        let info = AccountInfo::new(&key, false, false, &mut lamports, bytes, owner, false);
        load_nori_proof_queue(&info, &NORI_PROGRAM_ID)
    };

    assert_eq!(load_as(&NORI_PROGRAM_ID, &mut data.clone()), Ok([0x5f; 20]));
    assert_eq!(
        load_as(&Pubkey::new_unique(), &mut data.clone()),
        Err(ReadError::StateAccountOwner)
    );
    // A proof queue batch is not the state
    let mut batch = Vec::new();
    test_vectors::local()
        .batch()
        .try_serialize(&mut batch)
        .unwrap();
    assert_eq!(
        load_as(&NORI_PROGRAM_ID, &mut batch),
        Err(ReadError::StateAccountData)
    );
    assert_eq!(
        load_as(&NORI_PROGRAM_ID, &mut data[..40].to_vec()),
        Err(ReadError::StateAccountData)
    );
}
