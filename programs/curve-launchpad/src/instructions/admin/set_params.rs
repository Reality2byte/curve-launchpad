use crate::{instructions::calculate_fee, state::Global, CurveLaunchpadError, SetParamsEvent};
use anchor_lang::prelude::*;

#[event_cpi]
#[derive(Accounts)]
pub struct SetParams<'info> {
    #[account(
        mut,
        seeds = [Global::SEED_PREFIX],
        bump,
    )]
    global: Box<Account<'info, Global>>,

    authority: Signer<'info>,

    system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct Reserves {
    pub virtual_token_reserves: u64,
    pub virtual_sol_reserves: u64,
    pub real_token_reserves: u64,
}

pub fn set_params(
    ctx: Context<SetParams>,
    fee_recipient: Pubkey,
    withdraw_authority: Pubkey,
    initial: Reserves,
    initial_token_supply: u64,
    fee_basis_points: u64,
) -> Result<()> {
    let global = &mut ctx.accounts.global;

    //confirm program is initialized
    require!(global.initialized, CurveLaunchpadError::NotInitialized);

    //confirm user is the authority
    require!(
        global.authority == *ctx.accounts.authority.key,
        CurveLaunchpadError::InvalidAuthority
    );

    //confirm new fee value is less than 10%
    require!(
        calculate_fee(100, fee_basis_points) <= 10,
        CurveLaunchpadError::MaxFeeExceeded
    );

    global.fee_recipient = fee_recipient;
    global.initial_virtual_token_reserves = initial.virtual_token_reserves;
    global.initial_virtual_sol_reserves = initial.virtual_sol_reserves;
    global.initial_real_token_reserves = initial.real_token_reserves;
    global.initial_token_supply = initial_token_supply;
    global.fee_basis_points = fee_basis_points;
    global.withdraw_authority = withdraw_authority;

    emit!(SetParamsEvent {
        fee_recipient,
        withdraw_authority,
        initial_virtual_token_reserves: initial.virtual_token_reserves,
        initial_virtual_sol_reserves: initial.virtual_sol_reserves,
        initial_real_token_reserves: initial.real_token_reserves,
        initial_token_supply,
        fee_basis_points,
    });

    Ok(())
}
