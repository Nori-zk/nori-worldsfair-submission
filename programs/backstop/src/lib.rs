//! Backstop: a circuit breaker for a bridged asset. A guard compares the
//! asset's Ethereum backing, proven through Nori, with its Solana supply.
//!
//! - `checkpoint` (anyone, about once a minute) records the mint's supply.
//! - `submit_read` (anyone) applies a proven backing or pause flag. If supply
//!   checkpointed before the backing's Ethereum time exceeds it, the guard
//!   trips and stays tripped until the admin calls `unlatch`.
//! - Consumers CPI `assert_healthy` (fails unless HEALTHY) or `status`.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use nori_read::{load_nori_proof_queue, load_proof_queue_batch, verify_snapshot_result};

pub mod rules;
pub mod state;

use rules::to_mint_units;
pub use state::*;

declare_id!("JAZNGzLyN1TKhjnDDKrSsaQveAhUZUjiG8usM9Du5UD9");

#[program]
pub mod backstop {
    use super::*;

    /// Creates a guard for `mint`, owned by `admin`. Reads the Ethereum queue
    /// the Nori program proves, so anyone can check it is NoriSnapshot's.
    pub fn create_guard(ctx: Context<CreateGuard>, config: GuardConfig) -> Result<()> {
        require!(
            config.window_secs > config.skew_secs
                && config.checkpoint_interval_secs > 0
                && config.max_staleness_secs > 0,
            BackstopError::InvalidConfig
        );
        let eth_proof_queue = load_nori_proof_queue(&ctx.accounts.nori_state, &config.nori_program)
            .map_err(|e| failed(e, BackstopError::InvalidNoriState))?;

        let guard = &mut ctx.accounts.guard;
        guard.admin = ctx.accounts.admin.key();
        guard.mint = ctx.accounts.mint.key();
        guard.config = config;
        guard.eth_proof_queue = eth_proof_queue;
        guard.bump = ctx.bumps.guard;
        guard.push_checkpoint(Clock::get()?.unix_timestamp, ctx.accounts.mint.supply);

        emit!(GuardCreated {
            guard: guard.key(),
            mint: guard.mint,
            eth_proof_queue,
        });
        Ok(())
    }

    /// Records the mint's supply, at most once per `checkpoint_interval_secs`.
    pub fn checkpoint(ctx: Context<Checkpoint>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let guard = &mut ctx.accounts.guard;
        require!(guard.checkpoint_due(now), BackstopError::CheckpointTooSoon);
        guard.push_checkpoint(now, ctx.accounts.mint.supply);
        Ok(())
    }

    /// Applies a proven NoriSnapshot result: the backing or the pause flag.
    /// Each must be from a newer Ethereum block than the last one applied.
    pub fn submit_read(
        ctx: Context<SubmitRead>,
        kind: ReadKind,
        witness: nori_read::SnapshotResultWitness,
    ) -> Result<()> {
        let guard = &mut ctx.accounts.guard;
        let config = guard.config;
        let batch = load_proof_queue_batch(&ctx.accounts.proof_queue_batch, &config.nori_program)
            .map_err(|e| failed(e, BackstopError::InvalidProofQueueBatch))?;
        let query = match kind {
            ReadKind::Backing => config.backing_query,
            ReadKind::Pause if config.pause_query != [0; 32] => config.pause_query,
            ReadKind::Pause => return err!(BackstopError::NoPauseQuery),
        };
        let proven = verify_snapshot_result(&batch, &config.nori_snapshot, &query, &witness)
            .map_err(|e| failed(e, BackstopError::InvalidSnapshotResult))?;

        match kind {
            ReadKind::Backing => {
                require!(
                    proven.eth_block_number > guard.backing_eth_block,
                    BackstopError::ReadNotNewer
                );
                let backing = to_mint_units(
                    proven.result_u256(),
                    config.backing_decimals,
                    ctx.accounts.mint.decimals,
                );
                let deficit =
                    guard.apply_backing(backing, proven.eth_block_number, proven.eth_timestamp);
                emit!(BackingRead {
                    guard: guard.key(),
                    backing,
                    eth_block: proven.eth_block_number,
                    eth_time: proven.eth_timestamp,
                    deficit: deficit.unwrap_or(0),
                    tripped: guard.tripped,
                });
            }
            ReadKind::Pause => {
                require!(
                    proven.eth_block_number > guard.pause_eth_block,
                    BackstopError::ReadNotNewer
                );
                guard.paused = !proven.result_u256().is_zero();
                guard.pause_eth_block = proven.eth_block_number;
                emit!(PauseRead {
                    guard: guard.key(),
                    paused: guard.paused,
                    eth_block: proven.eth_block_number,
                });
            }
        }
        Ok(())
    }

    /// The guard's status (also in return data).
    pub fn status(ctx: Context<ReadGuard>) -> Result<Status> {
        Ok(ctx
            .accounts
            .guard
            .status(ctx.accounts.mint.supply, Clock::get()?.unix_timestamp))
    }

    /// Fails unless the guard is HEALTHY. Read-only, so consumers CPI it on
    /// every deposit without write-locking the guard.
    pub fn assert_healthy(ctx: Context<ReadGuard>) -> Result<()> {
        match ctx
            .accounts
            .guard
            .status(ctx.accounts.mint.supply, Clock::get()?.unix_timestamp)
        {
            Status::Healthy => Ok(()),
            Status::Warn => err!(BackstopError::SupplyAboveBacking),
            Status::Stale => err!(BackstopError::Stale),
            Status::PausedAtSource => err!(BackstopError::PausedAtSource),
            Status::Tripped => err!(BackstopError::Tripped),
        }
    }

    /// Clears a trip. Admin only.
    pub fn unlatch(ctx: Context<Unlatch>) -> Result<()> {
        let guard = &mut ctx.accounts.guard;
        guard.tripped = false;
        guard.trip_eth_block = 0;
        guard.trip_deficit = 0;
        emit!(Unlatched { guard: guard.key() });
        Ok(())
    }
}

fn failed(error: nori_read::ReadError, code: BackstopError) -> anchor_lang::error::Error {
    msg!("{}", error);
    error!(code)
}

#[derive(Accounts)]
pub struct CreateGuard<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: the Nori program's state; owner and type checked by
    /// `nori_read::load_nori_proof_queue`.
    pub nori_state: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Guard::INIT_SPACE,
        seeds = [GUARD_SEED, mint.key().as_ref(), admin.key().as_ref()],
        bump
    )]
    pub guard: Box<Account<'info, Guard>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Checkpoint<'info> {
    #[account(mut, has_one = mint)]
    pub guard: Box<Account<'info, Guard>>,
    pub mint: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct SubmitRead<'info> {
    #[account(mut, has_one = mint)]
    pub guard: Box<Account<'info, Guard>>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: owner (the guard's Nori program) and type checked by
    /// `nori_read::load_proof_queue_batch`.
    pub proof_queue_batch: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ReadGuard<'info> {
    #[account(has_one = mint)]
    pub guard: Box<Account<'info, Guard>>,
    pub mint: InterfaceAccount<'info, Mint>,
}

#[derive(Accounts)]
pub struct Unlatch<'info> {
    pub admin: Signer<'info>,
    #[account(mut, has_one = admin)]
    pub guard: Box<Account<'info, Guard>>,
}

#[event]
pub struct GuardCreated {
    pub guard: Pubkey,
    pub mint: Pubkey,
    pub eth_proof_queue: [u8; 20],
}

#[event]
pub struct BackingRead {
    pub guard: Pubkey,
    pub backing: u64,
    pub eth_block: u64,
    pub eth_time: u64,
    pub deficit: u64,
    pub tripped: bool,
}

#[event]
pub struct PauseRead {
    pub guard: Pubkey,
    pub paused: bool,
    pub eth_block: u64,
}

#[event]
pub struct Unlatched {
    pub guard: Pubkey,
}

#[error_code]
pub enum BackstopError {
    #[msg("Invalid guard config")]
    InvalidConfig,
    #[msg("Not the state of the configured Nori program")]
    InvalidNoriState,
    #[msg("Not a proof queue batch of the configured Nori program")]
    InvalidProofQueueBatch,
    #[msg("The snapshot result does not verify")]
    InvalidSnapshotResult,
    #[msg("This guard has no pause query")]
    NoPauseQuery,
    #[msg("A newer result was already applied")]
    ReadNotNewer,
    #[msg("Too soon for another checkpoint")]
    CheckpointTooSoon,
    #[msg("Supply is above proven backing")]
    SupplyAboveBacking,
    #[msg("No recent proven backing")]
    Stale,
    #[msg("Paused on Ethereum")]
    PausedAtSource,
    #[msg("Tripped: supply exceeded proven backing")]
    Tripped,
}
