use crate::calculate_fee;
use crate::instructions::CurveLaunchpadError;
use crate::state::Global;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetFee<'info> {
    #[account(
        mut,
        seeds = [Global::SEED_PREFIX],
        bump,
    )]
    global: Box<Account<'info, Global>>,

    authority: Signer<'info>,

    system_program: Program<'info, System>,
}

pub fn set_fee(ctx: Context<SetFee>, fee_amount: u64) -> Result<()> {
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
        calculate_fee(100, fee_amount) <= 10,
        CurveLaunchpadError::MaxFeeExceeded
    );

    global.fee_basis_points = fee_amount;

    Ok(())
}
