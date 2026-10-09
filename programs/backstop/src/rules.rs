//! Guard rules, free of accounts so they test without a validator.

use crate::state::{Checkpoint, Guard, Status, CHECKPOINTS};
use alloy_primitives::U256;

/// Converts a result with `from` decimals to mint units with `to` decimals,
/// rounding down and saturating at `u64::MAX`.
pub fn to_mint_units(value: U256, from: u8, to: u8) -> u64 {
    let scaled = if from >= to {
        value / U256::from(10).pow(U256::from(from - to))
    } else {
        value.saturating_mul(U256::from(10).pow(U256::from(to - from)))
    };
    u64::try_from(scaled).unwrap_or(u64::MAX)
}

impl Guard {
    pub fn checkpoint_due(&self, now: i64) -> bool {
        self.last_checkpoint()
            .is_none_or(|last| now - last.time >= self.config.checkpoint_interval_secs as i64)
    }

    pub fn push_checkpoint(&mut self, time: i64, supply: u64) {
        self.checkpoints[(self.checkpoint_count % CHECKPOINTS as u64) as usize] =
            Checkpoint { time, supply };
        self.checkpoint_count += 1;
    }

    fn last_checkpoint(&self) -> Option<&Checkpoint> {
        let last = self.checkpoint_count.checked_sub(1)?;
        Some(&self.checkpoints[(last % CHECKPOINTS as u64) as usize])
    }

    /// The lowest supply checkpointed in `[eth_time - window, eth_time + window]`,
    /// if one falls in `[eth_time - window, eth_time - skew]`.
    ///
    /// A Solana mint needs an Ethereum lock before it, so supply up to the
    /// backing's own time can only count tokens that backing covers. The
    /// minimum absorbs burns whose unlock lands before `eth_time`, including a
    /// burn just before it, which only a later checkpoint sees. Later
    /// checkpoints can only lower the minimum; the one before `eth_time - skew`
    /// keeps a verdict from resting on supply minted after the backing.
    pub fn window_min_supply(&self, eth_time: u64) -> Option<u64> {
        let eth_time = eth_time as i64;
        let window = self.config.window_secs as i64;
        let written = self.checkpoint_count.min(CHECKPOINTS as u64) as usize;
        let in_window = self.checkpoints[..written]
            .iter()
            .filter(|c| c.time >= eth_time - window && c.time <= eth_time + window);
        let before = eth_time - self.config.skew_secs as i64;
        in_window.clone().any(|c| c.time <= before).then_some(())?;
        in_window.map(|c| c.supply).min()
    }

    /// Records a newer proven backing and trips (latched) when windowed
    /// supply exceeds it. Returns the deficit, if any; no checkpoint in the
    /// window means no verdict.
    pub fn apply_backing(&mut self, backing: u64, eth_block: u64, eth_time: u64) -> Option<u64> {
        self.backing = backing;
        self.backing_eth_block = eth_block;
        self.backing_eth_time = eth_time;

        let supply = self.window_min_supply(eth_time)?;
        let deficit = supply.checked_sub(backing.saturating_add(self.config.tolerance))?;
        if deficit == 0 {
            return None;
        }
        if !self.tripped {
            self.tripped = true;
            self.trip_eth_block = eth_block;
            self.trip_deficit = deficit;
        }
        Some(deficit)
    }

    pub fn status(&self, live_supply: u64, now: i64) -> Status {
        if self.tripped {
            Status::Tripped
        } else if self.paused {
            Status::PausedAtSource
        } else if self.backing_eth_time == 0
            || now - self.backing_eth_time as i64 > self.config.max_staleness_secs as i64
        {
            Status::Stale
        } else if live_supply > self.backing.saturating_add(self.config.tolerance) {
            Status::Warn
        } else {
            Status::Healthy
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::GuardConfig;
    use anchor_lang::prelude::Pubkey;

    const UNIT: u64 = 1_000_000_000; // 9-decimal mint
    const T0: i64 = 1_900_000_000;

    fn guard() -> Guard {
        Guard {
            admin: Pubkey::default(),
            mint: Pubkey::default(),
            config: GuardConfig {
                nori_program: Pubkey::default(),
                nori_snapshot: [0; 20],
                backing_query: [1; 32],
                pause_query: [2; 32],
                backing_decimals: 18,
                tolerance: UNIT,
                window_secs: 600,
                skew_secs: 60,
                checkpoint_interval_secs: 60,
                max_staleness_secs: 7_200,
            },
            eth_proof_queue: [0; 20],
            backing: 0,
            backing_eth_block: 0,
            backing_eth_time: 0,
            paused: false,
            pause_eth_block: 0,
            tripped: false,
            trip_eth_block: 0,
            trip_deficit: 0,
            checkpoints: [Checkpoint::default(); CHECKPOINTS],
            checkpoint_count: 0,
            bump: 0,
        }
    }

    /// A checkpoint a minute over `[from, to)`, each with `supply(time)`.
    fn checkpoints(g: &mut Guard, from: i64, to: i64, supply: impl Fn(i64) -> u64) {
        for time in (from..to).step_by(60) {
            g.push_checkpoint(time, supply(time));
        }
    }

    fn rs_eth(units: f64) -> u64 {
        (units * UNIT as f64) as u64
    }

    #[test]
    fn scales_backing_to_mint_units() {
        let one_eth = U256::from(10).pow(U256::from(18));
        assert_eq!(to_mint_units(one_eth, 18, 9), UNIT);
        assert_eq!(to_mint_units(U256::from(123), 8, 8), 123);
        assert_eq!(to_mint_units(U256::from(5), 6, 9), 5_000);
        assert_eq!(to_mint_units(U256::MAX, 18, 9), u64::MAX);
    }

    #[test]
    fn kelp_drain_trips_and_a_refill_stays_tripped() {
        let mut g = guard();
        checkpoints(&mut g, T0 - 1_800, T0 + 1_800, |_| rs_eth(116_700.0));

        assert_eq!(
            g.apply_backing(rs_eth(116_723.52), 1, (T0 + 60) as u64),
            None
        );
        assert_eq!(g.status(rs_eth(116_700.0), T0 + 600), Status::Healthy);

        let deficit = g.apply_backing(rs_eth(223.52), 2, (T0 + 600) as u64);
        assert_eq!(deficit, Some(rs_eth(116_700.0) - rs_eth(223.52) - UNIT));
        assert_eq!(g.status(rs_eth(116_700.0), T0 + 700), Status::Tripped);

        g.apply_backing(rs_eth(200_000.0), 3, (T0 + 1_200) as u64);
        assert_eq!(g.status(rs_eth(116_700.0), T0 + 1_300), Status::Tripped);
        assert_eq!(g.trip_eth_block, 2);
    }

    #[test]
    fn an_inbound_transfer_in_flight_warns_but_never_trips() {
        // Lock on Ethereum at T0 + 100 (after the proven block), mint on Solana at T0 + 160
        let mut g = guard();
        checkpoints(&mut g, T0 - 600, T0 + 600, |t| {
            if t >= T0 + 160 {
                rs_eth(1_100.0)
            } else {
                rs_eth(1_000.0)
            }
        });

        assert_eq!(g.apply_backing(rs_eth(1_000.0), 1, (T0 + 60) as u64), None);
        assert_eq!(g.status(rs_eth(1_100.0), T0 + 600), Status::Warn);
    }

    #[test]
    fn a_burn_then_unlock_does_not_trip() {
        // Burn on Solana at T0, unlock on Ethereum at T0 + 300, proven at T0 + 400
        let mut g = guard();
        checkpoints(&mut g, T0 - 600, T0 + 600, |t| {
            if t >= T0 {
                rs_eth(900.0)
            } else {
                rs_eth(1_000.0)
            }
        });

        assert_eq!(g.apply_backing(rs_eth(900.0), 1, (T0 + 400) as u64), None);
        assert_eq!(g.status(rs_eth(900.0), T0 + 500), Status::Healthy);
    }

    #[test]
    fn a_fast_burn_then_unlock_does_not_trip() {
        // Burn on Solana at T0 + 10, unlock on Ethereum at T0 + 30, snapshot at
        // T0 + 40; the first checkpoint after the burn is at T0 + 60
        let mut g = guard();
        checkpoints(&mut g, T0 - 600, T0 + 1_200, |t| {
            if t > T0 {
                rs_eth(900.0)
            } else {
                rs_eth(1_000.0)
            }
        });

        assert_eq!(g.apply_backing(rs_eth(900.0), 1, (T0 + 40) as u64), None);
        assert_eq!(g.status(rs_eth(900.0), T0 + 1_200), Status::Healthy);
    }

    #[test]
    fn a_forged_solana_mint_warns_then_trips() {
        // 120k forged at T0, backing unchanged at 1,000
        let mut g = guard();
        checkpoints(&mut g, T0 - 600, T0 + 1_200, |t| {
            if t >= T0 {
                rs_eth(121_000.0)
            } else {
                rs_eth(1_000.0)
            }
        });

        assert_eq!(g.apply_backing(rs_eth(1_000.0), 1, (T0 + 60) as u64), None);
        assert_eq!(g.status(rs_eth(121_000.0), T0 + 120), Status::Warn);
        // Once the whole window is after the forgery
        assert!(g
            .apply_backing(rs_eth(1_000.0), 2, (T0 + 660) as u64)
            .is_some());
        assert_eq!(g.status(rs_eth(121_000.0), T0 + 700), Status::Tripped);
    }

    #[test]
    fn no_checkpoint_in_the_window_gives_no_verdict() {
        let mut g = guard();
        g.push_checkpoint(T0 - 5_000, rs_eth(1_000_000.0));
        // Only after the backing's time, e.g. a guard created after the snapshot
        g.push_checkpoint(T0 + 100, rs_eth(1_000_000.0));

        assert_eq!(g.apply_backing(0, 1, T0 as u64), None);
        assert!(!g.tripped);
        assert_eq!(g.backing_eth_block, 1);
    }

    #[test]
    fn paused_and_stale_states() {
        let mut g = guard();
        assert_eq!(g.status(0, T0), Status::Stale, "nothing proven yet");

        g.apply_backing(rs_eth(10.0), 1, T0 as u64);
        assert_eq!(g.status(0, T0 + 7_200), Status::Healthy);
        assert_eq!(g.status(0, T0 + 7_201), Status::Stale);

        g.paused = true;
        assert_eq!(g.status(0, T0), Status::PausedAtSource);
        g.tripped = true;
        assert_eq!(g.status(0, T0), Status::Tripped);
    }

    #[test]
    fn checkpoints_keep_the_latest_hour() {
        let mut g = guard();
        assert!(g.checkpoint_due(T0));
        checkpoints(&mut g, T0, T0 + 100 * 60, |t| (t - T0) as u64);

        assert!(!g.checkpoint_due(T0 + 99 * 60 + 30));
        assert!(g.checkpoint_due(T0 + 100 * 60));
        // Only the last 64 (from minute 36) remain
        let oldest = g.checkpoints.iter().map(|c| c.time).min().unwrap();
        assert_eq!(oldest, T0 + 36 * 60);
    }
}
