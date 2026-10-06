//! Surfpool helpers for this repo's program tests, on top of the sdk's
//! `test-utils` (validator, funded keypairs, error codes).

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, Discriminator};
use base64::Engine;
use solana_rpc_client::{api::request::RpcRequest, nonblocking::rpc_client::RpcClient};
use solana_transaction::versioned::VersionedTransaction;
use std::process::Command;

pub use solana_keypair::Keypair;
pub use solana_signer::Signer;
pub use test_utils::{custom_error_code, funded_keypair, Surfpool};

/// A validator with a funded payer and one deployed program.
pub struct Harness {
    // Field exists only for its Drop; must outlive the test.
    _surfpool: Surfpool,
    pub client: RpcClient,
    pub payer: Keypair,
}

impl Harness {
    /// Starts surfpool and deploys `program_so` at the id of `program_keypair`.
    pub async fn start(program_so: &str, program_keypair: &str) -> Self {
        let surfpool = Surfpool::start().await;
        let client = surfpool.client();
        let payer = funded_keypair(&client, 10_000_000_000).await;
        deploy_program(&surfpool, &payer, program_so, program_keypair);
        Self {
            _surfpool: surfpool,
            client,
            payer,
        }
    }

    /// Writes an account with surfpool's `surfnet_setAccount` cheatcode.
    pub async fn set_account(&self, address: Pubkey, owner: Pubkey, data: &[u8]) {
        let lamports = self
            .client
            .get_minimum_balance_for_rent_exemption(data.len())
            .await
            .unwrap();
        self.cheat(
            "surfnet_setAccount",
            serde_json::json!([
                address.to_string(),
                {
                    "lamports": lamports,
                    "data": alloy_primitives::hex::encode(data),
                    "owner": owner.to_string(),
                    "executable": false,
                }
            ]),
        )
        .await;
    }

    /// Moves the validator clock forward to `unix_time` (seconds).
    pub async fn time_travel(&self, unix_time: i64) {
        self.cheat(
            "surfnet_timeTravel",
            serde_json::json!([{ "absoluteTimestamp": unix_time * 1000 }]),
        )
        .await;
    }

    async fn cheat(&self, method: &'static str, params: serde_json::Value) {
        self.client
            .send::<serde_json::Value>(RpcRequest::Custom { method }, params)
            .await
            .unwrap_or_else(|e| panic!("{method}: {e}"));
    }

    async fn transaction(
        &self,
        instruction: Instruction,
        signers: &[&Keypair],
    ) -> VersionedTransaction {
        let blockhash = self.client.get_latest_blockhash().await.unwrap();
        let mut all: Vec<&Keypair> = vec![&self.payer];
        all.extend(signers.iter().filter(|s| s.pubkey() != self.payer.pubkey()));
        let message = solana_message::Message::new_with_blockhash(
            &[instruction],
            Some(&self.payer.pubkey()),
            &blockhash,
        );
        VersionedTransaction::try_new(solana_message::VersionedMessage::Legacy(message), &all)
            .unwrap()
    }

    /// Sends `instruction` (paid by the payer, also signed by `signers`).
    /// On failure, returns the error text with the custom error code in it.
    pub async fn send(
        &self,
        instruction: Instruction,
        signers: &[&Keypair],
    ) -> Result<Sent, String> {
        let tx = self.transaction(instruction, signers).await;
        let simulation = self.client.simulate_transaction(&tx).await.unwrap().value;
        let logs = simulation.logs.unwrap_or_default();
        if simulation.err.is_some() {
            return Err(logs.join("\n"));
        }
        self.client
            .send_and_confirm_transaction(&tx)
            .await
            .map_err(|e| format!("{e:?}"))?;
        Ok(Sent {
            compute_units: simulation.units_consumed.unwrap_or_default(),
            transaction_bytes: 1 + 64 * tx.signatures.len() + tx.message.serialize().len(),
            return_data: simulation
                .return_data
                .map(|data| {
                    base64::engine::general_purpose::STANDARD
                        .decode(data.data.0)
                        .unwrap()
                })
                .unwrap_or_default(),
            logs,
        })
    }

    /// The custom program error code a failing `instruction` returns.
    pub async fn error_code(&self, instruction: Instruction, signers: &[&Keypair]) -> u32 {
        let error = self
            .send(instruction, signers)
            .await
            .err()
            .expect("the instruction must fail");
        custom_error_code(&error)
    }

    pub async fn account_data(&self, address: &Pubkey) -> Vec<u8> {
        self.client.get_account_data(address).await.unwrap()
    }
}

/// What a confirmed instruction cost and produced.
pub struct Sent {
    pub compute_units: u64,
    pub transaction_bytes: usize,
    pub return_data: Vec<u8>,
    pub logs: Vec<String>,
}

impl Sent {
    /// The first Anchor event of type `E` in the logs.
    pub fn event<E: Discriminator + anchor_lang::AnchorDeserialize>(&self) -> E {
        self.logs
            .iter()
            .filter_map(|log| log.strip_prefix("Program data: "))
            .map(|data| {
                base64::engine::general_purpose::STANDARD
                    .decode(data)
                    .unwrap()
            })
            .find(|data| data.starts_with(E::DISCRIMINATOR))
            .map(|data| E::deserialize(&mut &data[8..]).unwrap())
            .expect("event in logs")
    }
}

/// `solana program deploy` with an explicit program keypair, so the program
/// id matches `declare_id!` on every machine.
fn deploy_program(surfpool: &Surfpool, payer: &Keypair, program_so: &str, program_keypair: &str) {
    let payer_path = std::env::temp_dir().join(format!(
        "nori-test-payer-{}-{}.json",
        std::process::id(),
        payer.pubkey()
    ));
    std::fs::write(
        &payer_path,
        serde_json::to_string(&payer.to_bytes().to_vec()).unwrap(),
    )
    .unwrap();
    let deploy = Command::new("solana")
        .args([
            "program",
            "deploy",
            program_so,
            "--program-id",
            program_keypair,
        ])
        .args(["-k", payer_path.to_str().unwrap()])
        .args(["--url", surfpool.rpc_url(), "--ws", surfpool.ws_url()])
        .output()
        .expect("failed to run solana CLI");
    std::fs::remove_file(&payer_path).ok();
    assert!(
        deploy.status.success(),
        "program deploy failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&deploy.stdout),
        String::from_utf8_lossy(&deploy.stderr)
    );
}
