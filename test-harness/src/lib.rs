//! This repo's surfpool test context: one validator, client and funded payer,
//! with one program deployed at its `declare_id!`. The surfpool and RPC work
//! is the sdk's `test-utils`; this adds the context and Anchor event decoding.

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, Discriminator};
use solana_rpc_client::nonblocking::rpc_client::RpcClient;

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
        test_utils::deploy_program_at(&surfpool, &payer, program_so, program_keypair);
        Self {
            _surfpool: surfpool,
            client,
            payer,
        }
    }

    pub async fn set_account(&self, address: Pubkey, owner: Pubkey, data: &[u8]) {
        test_utils::set_account(&self.client, &address, &owner, data).await;
    }

    pub async fn time_travel(&self, unix_time: i64) {
        test_utils::time_travel(&self.client, unix_time).await;
    }

    /// Sends `instruction` (paid by the payer, also signed by `signers`).
    pub async fn send(
        &self,
        instruction: Instruction,
        signers: &[&Keypair],
    ) -> Result<Sent, String> {
        test_utils::send(&self.client, &self.payer, instruction, signers)
            .await
            .map(Sent)
    }

    /// The custom program error code a failing `instruction` returns.
    pub async fn error_code(&self, instruction: Instruction, signers: &[&Keypair]) -> u32 {
        test_utils::error_code(&self.client, &self.payer, instruction, signers).await
    }

    pub async fn account_data(&self, address: &Pubkey) -> Vec<u8> {
        self.client.get_account_data(address).await.unwrap()
    }
}

/// [`test_utils::Sent`], plus Anchor event decoding.
pub struct Sent(pub test_utils::Sent);

impl std::ops::Deref for Sent {
    type Target = test_utils::Sent;
    fn deref(&self) -> &test_utils::Sent {
        &self.0
    }
}

impl Sent {
    /// The first Anchor event of type `E` in the logs.
    pub fn event<E: Discriminator + anchor_lang::AnchorDeserialize>(&self) -> E {
        self.program_data()
            .into_iter()
            .find(|data| data.starts_with(E::DISCRIMINATOR))
            .map(|data| E::deserialize(&mut &data[8..]).unwrap())
            .expect("event in logs")
    }
}
