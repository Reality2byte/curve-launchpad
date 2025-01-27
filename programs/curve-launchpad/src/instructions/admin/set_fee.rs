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

    user: Signer<'info>,

    system_program: Program<'info, System>,
}

pub fn set_fee(ctx: Context<SetFee>, fee_amount: u64) -> Result<()> {
    let global = &mut ctx.accounts.global;

    //confirm program is initialized
    require!(global.initialized, CurveLaunchpadError::NotInitialized);

    //confirm user is the authority
    require!(
        global.authority == *ctx.accounts.user.to_account_info().key,
        CurveLaunchpadError::InvalidAuthority
    );

    global.fee_basis_points = fee_amount;

    Ok(())
}
