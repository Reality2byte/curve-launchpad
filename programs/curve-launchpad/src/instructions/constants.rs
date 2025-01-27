pub const DEFAULT_DECIMALS: u32 = 6;
pub const DEFAULT_TOKEN_LAMPORTS: u64 = 10_u64.pow(DEFAULT_DECIMALS);
pub const DEFAULT_TOKEN_SUPPLY: u64 = 1_000_000_000 * DEFAULT_TOKEN_LAMPORTS;

pub const MINT_AUTHORITY_SEED: &[u8] = b"mint-authority";
pub const METADATA_SEED: &[u8] = b"metadata";