use anchor_lang::prelude::*;

pub const GUARD_SEED: &[u8] = b"guard";
/// Supply checkpoints kept per guard: an hour at one a minute.
pub const CHECKPOINTS: usize = 64;

/// A guard's settings, fixed at creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace)]
pub struct GuardConfig {
    /// The Nori program that owns the proof queue batches.
    pub nori_program: Pubkey,
    /// The NoriSnapshot contract on Ethereum.
    pub nori_snapshot: [u8; 20],
    /// Query whose result is the backing, e.g. `balanceOf(lockbox)`.
    pub backing_query: [u8; 32],
    /// Query whose result is the source pause flag; zero for none.
    pub pause_query: [u8; 32],
    /// Decimals of the backing result.
    pub backing_decimals: u8,
    /// Supply allowed above backing, in mint units.
    pub tolerance: u64,
    /// A backing read at Ethereum time T is compared with the lowest supply
    /// checkpoint in [T - window, T + window], given one in [T - window, T - skew].
    pub window_secs: u32,
    pub skew_secs: u32,
    pub checkpoint_interval_secs: u32,
    /// Backing older than this is STALE.
    pub max_staleness_secs: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default, InitSpace)]
pub struct Checkpoint {
    pub time: i64,
    pub supply: u64,
}

#[account]
#[derive(Debug, InitSpace)]
pub struct Guard {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub config: GuardConfig,
    /// The Ethereum queue the Nori program proves, read at creation.
    pub eth_proof_queue: [u8; 20],
    /// Latest proven backing, in mint units.
    pub backing: u64,
    pub backing_eth_block: u64,
    pub backing_eth_time: u64,
    pub paused: bool,
    pub pause_eth_block: u64,
    /// Latched until the admin unlatches.
    pub tripped: bool,
    pub trip_eth_block: u64,
    pub trip_deficit: u64,
    pub checkpoints: [Checkpoint; CHECKPOINTS],
    /// Checkpoints written so far; the next goes at `count % CHECKPOINTS`.
    pub checkpoint_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Healthy,
    /// Live supply is above proven backing: normal for transfers in flight.
    Warn,
    /// No backing proven within `max_staleness_secs`.
    Stale,
    PausedAtSource,
    /// Supply exceeded proven backing in a finalized window. Latched.
    Tripped,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadKind {
    Backing,
    Pause,
}
