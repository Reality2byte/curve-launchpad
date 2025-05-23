use crate::instructions::CurveLaunchpadError;
use crate::state::Global;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Resume<'info> {
    #[account(
        mut,
        seeds = [Global::SEED_PREFIX],
        bump,
    )]
    global: Box<Account<'info, Global>>,

    authority: Signer<'info>,

    system_program: Program<'info, System>,
}

pub fn resume(ctx: Context<Resume>) -> Result<()> {
    let global = &mut ctx.accounts.global;

    //confirm program is initialized
    require!(global.initialized, CurveLaunchpadError::NotInitialized);

    //confirm user is the authority
    require!(
        global.authority == *ctx.accounts.authority.key,
        CurveLaunchpadError::InvalidAuthority
    );

    global.paused = false;

    Ok(())
}
