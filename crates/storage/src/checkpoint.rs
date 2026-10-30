//! E9-T05: bounded software checkpoint context. The event engine supplies its exact cursor;
//! checkpoints-only sessions keep a zero log cursor until event recording is installed.
use crate::session::{
    ClockMode, ClockPolicy, ContentHash, ExactU64, Position, SessionError, Version,
};
use alloc::{format, string::String, vec::Vec};
use serde::{Deserialize, Serialize};

pub const MAX_CONTEXT_BYTES: usize = 16 * 1024;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeldInput {
    pub keyboard: Vec<u16>,
    pub tablet: Vec<u16>,
    pub mouse: Vec<u16>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckpointContext {
    pub version: Version,
    pub runtime: ContentHash,
    pub kernel: ContentHash,
    pub ram_bytes: ExactU64,
    pub clock: ClockPolicy,
    pub position: Position,
    pub held: HeldInput,
}
impl CheckpointContext {
    pub fn validate(&self) -> Result<(), SessionError> {
        if self.version != Version::V1 {
            return Err(SessionError::Version {
                section: "software checkpoint",
                major: self.version.major,
                minor: self.version.minor,
            });
        }
        if !(16 << 20..=1 << 30).contains(&self.ram_bytes.0)
            || !self.ram_bytes.0.is_multiple_of(4096)
        {
            return Err(SessionError::Invalid("checkpoint RAM"));
        }
        if self.clock.mode != ClockMode::Icount
            || self.clock.interactive.is_some()
            || !(1..=1024).contains(&self.clock.divider)
            || self.clock.timebase_hz.0 != 10_000_000
        {
            return Err(SessionError::Invalid("software checkpoint clock"));
        }
        if !self.position.follows(Position::ZERO) || self.position.sequence.0 == u64::MAX {
            return Err(SessionError::Invalid("checkpoint cursor"));
        }
        for keys in [&self.held.keyboard, &self.held.tablet, &self.held.mouse] {
            if keys.len() > 1024 || keys.windows(2).any(|w| w[0] >= w[1]) {
                return Err(SessionError::Invalid("checkpoint held inputs"));
            }
        }
        Ok(())
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, SessionError> {
        if bytes.len() > MAX_CONTEXT_BYTES {
            return Err(SessionError::TooLarge("checkpoint context"));
        }
        let context: Self =
            serde_json::from_slice(bytes).map_err(|e| SessionError::Malformed(format!("{e}")))?;
        context.validate()?;
        Ok(context)
    }
    pub fn to_bytes(&self) -> Result<Vec<u8>, SessionError> {
        self.validate()?;
        let bytes =
            serde_json::to_vec(self).map_err(|e| SessionError::Malformed(format!("{e}")))?;
        if bytes.len() > MAX_CONTEXT_BYTES {
            return Err(SessionError::TooLarge("checkpoint context"));
        }
        Ok(bytes)
    }
    pub fn canonical_json(bytes: &[u8]) -> Result<String, SessionError> {
        let canonical = Self::from_bytes(bytes)?.to_bytes()?;
        String::from_utf8(canonical).map_err(|e| SessionError::Malformed(format!("{e}")))
    }
}
