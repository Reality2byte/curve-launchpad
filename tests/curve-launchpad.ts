import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { CurveLaunchpad } from "../target/types/curve_launchpad";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  ammFromBondingCurve,
  fundAccountSOL,
  getAnchorError,
  getSPLBalance,
  sendTransaction,
  toEvent,
} from "./util";
import {
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { BN } from "bn.js";
import { assert } from "chai";
import { Metaplex, token } from "@metaplex-foundation/js";
import { AMM, calculateFee } from "../client";

const GLOBAL_SEED = "global";
const BONDING_CURVE_SEED = "bonding-curve";

//TODO: Unit test order is essential, need to refactor to make it so its not.
const a = [112,150,75,3,64,208,247,216,228,120,150,50,85,48,230,0,191,7,41,62,173,204,221,111,12,119,139,74,181,38,46,126,201,12,90,146,240,189,178,136,141,123,132,252,94,163,48,184,243,178,140,186,201,51,185,205,252,71,225,144,20,147,37,206];
const b = [111,55,173,215,173,69,53,205,52,69,171,224,185,154,158,142,206,116,57,72,48,178,164,196,74,15,203,77,234,29,254,183,0,24,106,100,94,229,254,104,25,92,89,3,225,90,225,240,149,69,226,44,144,100,155,19,15,146,141,161,254,158,74,9];
const c = [248,27,179,244,227,232,104,143,190,189,147,112,207,134,50,245,150,54,58,90,107,23,83,167,184,238,142,54,27,150,15,113,14,246,144,98,110,97,75,111,167,155,237,117,19,72,175,31,251,204,78,138,97,100,174,149,249,231,238,104,168,215,2,103];
const e = [59,148,28,16,60,210,57,58,248,94,249,191,164,79,155,26,39,232,218,119,42,13,204,116,139,58,198,230,241,102,188,205,49,87,16,187,106,47,61,112,49,139,157,11,107,145,205,33,190,173,166,138,217,128,46,60,78,222,207,1,127,46,237,205];
const d = [217,12,122,124,188,48,231,113,79,186,10,168,211,109,122,127,150,19,182,201,62,49,81,83,132,85,84,254,236,2,218,222,45,40,182,230,171,58,104,219,150,114,87,4,101,110,248,90,134,136,114,68,21,152,141,18,27,248,111,158,221,210,180,145];
describe("curve-launchpad", () => {
  const DEFAULT_DECIMALS = 6n;
  const DEFAULT_TOKEN_BALANCE =
    1_000_000_000n * BigInt(10 ** Number(DEFAULT_DECIMALS));
  const DEFAULT_INITIAL_TOKEN_RESERVES = 793_100_000_000_000n;
  const DEFAULT_INITIAL_VIRTUAL_SOL_RESERVE = 30_000_000_000n;
  const DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE = 1_073_000_000_000_000n;
  const DEFAULT_FEE_BASIS_POINTS = 50n;
  const DEFAULT_FEE_BASIS_POINTS_1 = 100n;

  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CurveLaunchpad as Program<CurveLaunchpad>;

  const connection = provider.connection;
  const authority = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(a));
  const tokenCreator = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(b));
  const feeRecipient = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(c));
  const withdrawAuthority = anchor.web3.Keypair.fromSecretKey(Uint8Array.from(e));

  const mint = anchor.web3.Keypair.generate();

  console.log('a', authority.publicKey);
  console.log('b', tokenCreator.publicKey);
  console.log('c', feeRecipient.publicKey);
  console.log('e', withdrawAuthority.publicKey);
  console.log('d', mint.publicKey);

  const [globalPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(GLOBAL_SEED)],
    program.programId
  );

  const [bondingCurvePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from(BONDING_CURVE_SEED), mint.publicKey.toBuffer()],
    program.programId
  );

  const getAmmFromBondingCurve = async () => {
    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );
    return ammFromBondingCurve(
      bondingCurveAccount,
      DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE
    );
  };

  const assertBondingCurve = (
    amm: any,
    bondingCurveAccount: any,
    complete: boolean = false
  ) => {
    assert.equal(
      bondingCurveAccount.virtualTokenReserves.toString(),
      amm.virtualTokenReserves.toString()
    );
    assert.equal(
      bondingCurveAccount.virtualSolReserves.toString(),
      amm.virtualSolReserves.toString()
    );
    assert.equal(
      bondingCurveAccount.realTokenReserves.toString(),
      amm.realTokenReserves.toString()
    );
    assert.equal(
      bondingCurveAccount.realSolReserves.toString(),
      amm.realSolReserves.toString()
    );
    assert.equal(
      bondingCurveAccount.tokenTotalSupply.toString(),
      DEFAULT_TOKEN_BALANCE.toString()
    );
    assert.equal(bondingCurveAccount.complete, complete);
  };

  const simpleBuy = async (
    user: anchor.web3.Keypair,
    tokenAmount: bigint,
    maxSolAmount: bigint,
    innerFeeRecipient: anchor.web3.Keypair = feeRecipient
  ) => {
    const bondingCurveTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      user,
      mint.publicKey,
      user.publicKey
    );

    let tx = await program.methods
      .buy(new BN(tokenAmount.toString()), new BN(maxSolAmount.toString()))
      .accounts({
        user: user.publicKey,
        mint: mint.publicKey,
        feeRecipient: innerFeeRecipient.publicKey,
        program: program.programId,
      })
      .transaction();

    let txResults = await sendTransaction(program, tx, [user], user.publicKey);

    return {
      tx: txResults,
      userTokenAccount,
      bondingCurveTokenAccount,
      bondingCurvePDA,
    };
  };

  const simpleSell = async (
    user: anchor.web3.Keypair,
    tokenAmount: bigint,
    minSolAmount: bigint,
    innerFeeRecipient: anchor.web3.Keypair = feeRecipient
  ) => {
    const bondingCurveTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      user,
      mint.publicKey,
      user.publicKey
    );

    let tx = await program.methods
      .sell(new BN(tokenAmount.toString()), new BN(minSolAmount.toString()))
      .accounts({
        user: user.publicKey,
        mint: mint.publicKey,
        feeRecipient: innerFeeRecipient.publicKey,
        program: program.programId,
      })
      .transaction();

    let txResults = await sendTransaction(program, tx, [user], user.publicKey);

    return {
      tx: txResults,
      userTokenAccount,
      bondingCurveTokenAccount,
      bondingCurvePDA,
    };
  };

  before(async () => {
    await fundAccountSOL(connection, authority.publicKey, 5 * LAMPORTS_PER_SOL);
    
    await fundAccountSOL(
      connection,
      tokenCreator.publicKey,
      200 * LAMPORTS_PER_SOL
    );
    
    await fundAccountSOL(
      connection,
      withdrawAuthority.publicKey,
      5 * LAMPORTS_PER_SOL
    );
  });

  it("Is initialized!", async () => {

    // const r = await program.methods
    //     .setFee(
    //         new BN((100n).toString())
    //     )
    //     .accounts({
    //       user: authority.publicKey,
    //     })
    //     .signers([authority])
    //     .rpc();
    // console.log({r})

    console.log({authority: authority.publicKey})
    await program.methods
      .initialize()
      .accounts({
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    let global = await program.account.global.fetch(globalPDA);
    console.log(global)
    assert.equal(global.authority.toBase58(), authority.publicKey.toBase58());
    assert.equal(global.initialized, true);

    await program.methods
      .setParams(
        feeRecipient.publicKey,
        withdrawAuthority.publicKey,
        {
          virtualTokenReserves: new BN(DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE.toString()), 
          virtualSolReserves: new BN(DEFAULT_INITIAL_VIRTUAL_SOL_RESERVE.toString()),
          realTokenReserves: new BN(DEFAULT_INITIAL_TOKEN_RESERVES.toString()),
        },
        new BN(DEFAULT_TOKEN_BALANCE.toString()),
        new BN(DEFAULT_FEE_BASIS_POINTS.toString())
      )
      .accounts({
        authority: authority.publicKey,
        program: program.programId,
      })
      .signers([authority])
      .rpc();

      await program.methods
      .resume()
      .accounts({
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();
  });

  it("can mint a token", async () => {
    const bondingCurveTokenAccount = await getAssociatedTokenAddress(
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    console.log(bondingCurveTokenAccount.toString())

    let name = "test";
    let symbol = "tst";
    let uri = "https://www.test.com";

    const tx = await program.methods
      .create(name, symbol, uri)
      .accounts({
        mint: mint.publicKey,
        creator: tokenCreator.publicKey,
        program: program.programId,
      })
      .transaction();

    let txResult = await sendTransaction(
      program,
      tx,
      [mint, tokenCreator],
      tokenCreator.publicKey
    );

    let createEvents = txResult.events.filter((event) => {
      return event.name === "createEvent";
    });

    assert.equal(createEvents.length, 1);

    let createEvent = toEvent("createEvent", createEvents[0]);
    assert.notEqual(createEvent, null);
    if (createEvent != null) {
      assert.equal(createEvent.name, name);
      assert.equal(createEvent.symbol, symbol);
      assert.equal(createEvent.uri, uri);
      assert.equal(createEvent.mint.toBase58(), mint.publicKey.toBase58());
      assert.equal(
        createEvent.bondingCurve.toBase58(),
        bondingCurvePDA.toBase58()
      );
      assert.equal(
        createEvent.creator.toBase58(),
        tokenCreator.publicKey.toBase58()
      );
    }

    const tokenAmount = await connection.getTokenAccountBalance(
      bondingCurveTokenAccount
    );
    assert.equal(tokenAmount.value.amount, DEFAULT_TOKEN_BALANCE.toString());

    const createdMint = await getMint(connection, mint.publicKey);
    assert.equal(createdMint.isInitialized, true);
    assert.equal(createdMint.decimals, Number(DEFAULT_DECIMALS));
    assert.equal(createdMint.supply, DEFAULT_TOKEN_BALANCE);
    assert.equal(createdMint.mintAuthority, null);

    const metaplex = Metaplex.make(connection);
    const token = await metaplex
      .nfts()
      .findByMint({ mintAddress: mint.publicKey });
    assert.equal(token.name, name);
    assert.equal(token.symbol, symbol);
    assert.equal(token.uri, uri);

    let bondingCurveTokenAccountInfo = await connection.getTokenAccountBalance(
      bondingCurveTokenAccount
    );

    assert.equal(
      bondingCurveTokenAccountInfo.value.amount,
      DEFAULT_TOKEN_BALANCE.toString()
    );

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );

    assert.equal(
      bondingCurveAccount.virtualTokenReserves.toString(),
      DEFUALT_INITIAL_VIRTUAL_TOKEN_RESERVE.toString()
    );
    assert.equal(
      bondingCurveAccount.virtualSolReserves.toString(),
      DEFAULT_INITIAL_VIRTUAL_SOL_RESERVE.toString()
    );
    assert.equal(
      bondingCurveAccount.realTokenReserves.toString(),
      DEFAULT_INITIAL_TOKEN_RESERVES.toString()
    );
    assert.equal(bondingCurveAccount.realSolReserves.toString(), "0");
    assert.equal(
      bondingCurveAccount.tokenTotalSupply.toString(),
      DEFAULT_TOKEN_BALANCE.toString()
    );
    assert.equal(bondingCurveAccount.complete, false);
  });

  it("can buy a token", async () => {
    let currentAMM = await getAmmFromBondingCurve();

    let buyTokenAmount = DEFAULT_TOKEN_BALANCE / 100n;
    let buyMaxSOLAmount = currentAMM.getBuyPrice(buyTokenAmount);
    let fee = calculateFee(buyMaxSOLAmount, Number(DEFAULT_FEE_BASIS_POINTS));
    buyMaxSOLAmount = buyMaxSOLAmount + fee;

    let buyResult = currentAMM.applyBuy(buyTokenAmount);

    let feeRecipientPreBuySOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );

    let txResult = await simpleBuy(
      tokenCreator,
      buyTokenAmount,
      buyMaxSOLAmount
    );

    console.log(txResult.tx.response)

    let feeRecipientPostBuySOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );
    assert.equal(
      feeRecipientPostBuySOLBalance - feeRecipientPreBuySOLBalance,
      Number(fee)
    );

    let targetCurrentSupply = (
      DEFAULT_TOKEN_BALANCE - buyTokenAmount
    ).toString();

    let tradeEvents = txResult.tx.events.filter((event) => {
      return event.name === "tradeEvent";
    });
    assert.equal(tradeEvents.length, 1);

    let tradeEvent = toEvent("tradeEvent", tradeEvents[0]);
    assert.notEqual(tradeEvent, null);
    if (tradeEvent != null) {
      assert.equal(
        tradeEvent.tokenAmount.toString(),
        buyTokenAmount.toString()
      );

      assert.equal(tradeEvent.isBuy, true);
      assert.equal(
        tradeEvent.solAmount.toString(),
        buyResult.sol_amount.toString()
      );

      assert.equal(
        tradeEvent.solAmount.toString(),
        (buyMaxSOLAmount - fee).toString()
      );
    }

    const tokenAmount = await connection.getTokenAccountBalance(
      txResult.userTokenAccount.address
    );
    assert.equal(tokenAmount.value.amount, buyTokenAmount.toString());

    let bondingCurveTokenAccountInfo = await connection.getTokenAccountBalance(
      txResult.bondingCurveTokenAccount
    );

    assert.equal(
      bondingCurveTokenAccountInfo.value.amount,
      targetCurrentSupply
    );

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );

    assertBondingCurve(currentAMM, bondingCurveAccount);
  });

  it("can sell a token", async () => {
    let currentAMM = await getAmmFromBondingCurve();

    let tokenAmount = 10000000n;
    let minSolAmount = currentAMM.getSellPrice(tokenAmount);
    let fee = calculateFee(minSolAmount, Number(DEFAULT_FEE_BASIS_POINTS));
    minSolAmount = minSolAmount - fee;

    let sellResults = currentAMM.applySell(tokenAmount);

    let userPreSaleBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      tokenCreator.publicKey
    );

    let curvePreSaleBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    let feeRecipientPreBuySOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );

    let txResult = await simpleSell(tokenCreator, tokenAmount, minSolAmount);

    let feeRecipientPostBuySOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );
    assert.equal(
      feeRecipientPostBuySOLBalance - feeRecipientPreBuySOLBalance,
      Number(fee)
    );

    let tradeEvents = txResult.tx.events.filter((event) => {
      return event.name === "tradeEvent";
    });

    let userPostSaleBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      tokenCreator.publicKey
    );

    assert.equal(
      userPostSaleBalance,
      (BigInt(userPreSaleBalance) - tokenAmount).toString()
    );
    assert.equal(tradeEvents.length, 1);

    let tradeEvent = toEvent("tradeEvent", tradeEvents[0]);
    assert.notEqual(tradeEvent, null);
    if (tradeEvent != null) {
      assert.equal(tradeEvent.tokenAmount.toString(), tokenAmount.toString());
      assert.equal(tradeEvent.isBuy, false);
      assert.equal(
        tradeEvent.solAmount.toString(),
        sellResults.sol_amount.toString()
      );
    }

    let curvePostSaleBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    assert.equal(
      curvePostSaleBalance,
      (BigInt(curvePreSaleBalance) + tokenAmount).toString()
    );

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );
    assertBondingCurve(currentAMM, bondingCurveAccount);
  });

  //excpetion unit tests
  it("can't withdraw as curve is incomplete", async () => {
    let errorCode = "";
    try {
      let tx = await program.methods
        .withdraw()
        .accounts({
          user: withdrawAuthority.publicKey,
          mint: mint.publicKey,
        })
        .transaction();

      await sendTransaction(
        program,
        tx,
        [withdrawAuthority],
        withdrawAuthority.publicKey
      );
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "BondingCurveNotComplete");
  });

  it("can't buy a token, exceed max sol", async () => {
    let errorCode = "";
    try {
      await simpleBuy(tokenCreator, DEFAULT_TOKEN_BALANCE / 100n, 1n);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "MaxSOLCostExceeded");
  });

  it("can't buy 0 tokens", async () => {
    let errorCode = "";
    try {
      await simpleBuy(tokenCreator, 0n, 1n);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "MinBuy");
  });

  it("can't sell a token, not enough tokens", async () => {
    let errorCode = "";
    try {
      await simpleSell(tokenCreator, DEFAULT_TOKEN_BALANCE, 0n);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "InsufficientTokens");
  });

  it("can't sell 0 tokens", async () => {
    let errorCode = "";
    try {
      await simpleSell(tokenCreator, 0n, 0n);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "MinSell");
  });

  it("can't sell a token, exceed mint sol sell", async () => {
    let errorCode = "";
    try {
      await simpleSell(tokenCreator, 1n, DEFAULT_TOKEN_BALANCE);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "MinSOLOutputNotReached");
  });

  //curve complete unit tests
  it("can complete the curve", async () => {
    let currentAMM = await getAmmFromBondingCurve();
    let buyTokenAmount = currentAMM.realTokenReserves;
    let maxSolAmount = currentAMM.getBuyPrice(buyTokenAmount);

    maxSolAmount =
      maxSolAmount +
      calculateFee(maxSolAmount, Number(DEFAULT_FEE_BASIS_POINTS));
    let buyResult = currentAMM.applyBuy(buyTokenAmount);
    console.log({buyResult})

    let userPrePurchaseBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      tokenCreator.publicKey
    );

    let txResult = await simpleBuy(tokenCreator, buyTokenAmount, maxSolAmount);

    let tradeEvents = txResult.tx.events.filter((event) => {
      return event.name === "tradeEvent";
    });
    assert.equal(tradeEvents.length, 1);

    let tradeEvent = toEvent("tradeEvent", tradeEvents[0]);
    assert.notEqual(tradeEvent, null);
    if (tradeEvent != null) {
      assert.equal(tradeEvent.isBuy, true);
      assert.equal(
        tradeEvent.solAmount.toString(),
        buyResult.sol_amount.toString()
      );
    }

    let userPostPurchaseBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      tokenCreator.publicKey
    );

    assert.equal(
      userPostPurchaseBalance,
      (BigInt(userPrePurchaseBalance) + buyTokenAmount).toString()
    );

    let bondingCurveTokenAccountInfo = await connection.getTokenAccountBalance(
      txResult.bondingCurveTokenAccount
    );

    assert.equal(
      (
        BigInt(bondingCurveTokenAccountInfo.value.amount) +
        DEFAULT_INITIAL_TOKEN_RESERVES
      ).toString(),
      DEFAULT_TOKEN_BALANCE.toString()
    );

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );

    assertBondingCurve(currentAMM, bondingCurveAccount, true);
  });

  it("can't buy a token, curve complete", async () => {
    let currentAMM = await getAmmFromBondingCurve();

    let buyTokenAmount = 100n;
    let maxSolAmount = currentAMM.getBuyPrice(buyTokenAmount);

    let errorCode = "";
    try {
      await simpleBuy(tokenCreator, buyTokenAmount, maxSolAmount);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "BondingCurveComplete");
  });

  it("can't sell a token, curve complete", async () => {
    let tokenAmount = 100n;
    let minSolAmount = 0n;

    let errorCode = "";
    try {
      await simpleSell(tokenCreator, tokenAmount, minSolAmount);
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "BondingCurveComplete");
  });

  it("can't withdraw as incorrect authority", async () => {
    let errorCode = "";
    try {
      let tx = await program.methods
        .withdraw()
        .accounts({
          user: tokenCreator.publicKey,
          mint: mint.publicKey,
        })
        .transaction();

      await sendTransaction(
        program,
        tx,
        [tokenCreator],
        tokenCreator.publicKey
      );
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "InvalidWithdrawAuthority");
  });

  //it can withdraw
  it("can withdraw", async () => {
    let withdrawAuthorityPreSOLBalance = await connection.getBalance(
      feeRecipient.publicKey
    );
    let bondingCurvePreSOLBalance = await connection.getBalance(
      bondingCurvePDA
    );

    let bondingCurvePreSPLBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    let tx = await program.methods
      .withdraw()
      .accounts({
        user: withdrawAuthority.publicKey,
        mint: mint.publicKey,
      })
      .transaction();

    await sendTransaction(
      program,
      tx,
      [withdrawAuthority],
      withdrawAuthority.publicKey
    );

    let minBalanceRentExempt =
      await connection.getMinimumBalanceForRentExemption(8 + 41);
    let bondingCurvePostSOLBalance = await connection.getBalance(
      bondingCurvePDA
    );

    //confirm PDA only remaining balance is rent exempt
    assert.equal(bondingCurvePostSOLBalance, minBalanceRentExempt);


    //check if there is more SOL in withdraw authority then the bonding curve pre transfer
    //TODO: Calculate the correct amount of SOL that should be in the withdraw authority
    let withdrawAuthorityPostSOLBalance = await connection.getBalance(
      withdrawAuthority.publicKey
    );
    let withdrawAuthorityBalanceDiff =
      withdrawAuthorityPostSOLBalance - withdrawAuthorityPreSOLBalance;

    let hasBalanceRisenMoreThenCurve =
      withdrawAuthorityBalanceDiff - minBalanceRentExempt >
      bondingCurvePreSOLBalance - minBalanceRentExempt;

    assert.isTrue(hasBalanceRisenMoreThenCurve);

    let withdrawAuthorityPostSPLBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      withdrawAuthority.publicKey
    );

    let bondingCurvePostSPLBalance = await getSPLBalance(
      connection,
      mint.publicKey,
      bondingCurvePDA,
      true
    );

    assert.equal(withdrawAuthorityPostSPLBalance, bondingCurvePreSPLBalance);
    assert.equal(bondingCurvePostSPLBalance, "0");

    let bondingCurveAccount = await program.account.bondingCurve.fetch(
      bondingCurvePDA
    );

    //confirm PDA has enough rent
    assert.notEqual(bondingCurveAccount, null);
  });

  //param unit tests
  it("can set params", async () => {
    const randomFeeRecipient = anchor.web3.Keypair.generate();
    const randomWithdrawAuthority = anchor.web3.Keypair.generate();
  
    let tx = await program.methods
      .setParams(
        randomFeeRecipient.publicKey,
        randomWithdrawAuthority.publicKey,
        {
          virtualTokenReserves: new BN(1000),
          virtualSolReserves: new BN(2000),
          realTokenReserves: new BN(3000),
        },
        new BN(4000),
        new BN(100)
      )
      .accounts({
        authority: authority.publicKey,
        program: program.programId,
      })
      .transaction();
  
    let txResult = await sendTransaction(
      program,
      tx,
      [authority],
      authority.publicKey
    );
  
    let global = await program.account.global.fetch(globalPDA);
  
    let setParamsEvents = txResult.events.filter((event) => {
      return event.name === "setParamsEvent";
    });
  
    assert.equal(setParamsEvents.length, 1);
  
    let setParamsEvent = toEvent("setParamsEvent", setParamsEvents[0]);
    assert.notEqual(setParamsEvent, null);
    if (setParamsEvent != null) {
      assert.equal(
        setParamsEvent.feeRecipient.toBase58(),
        randomFeeRecipient.publicKey.toBase58()
      );
      assert.equal(
        setParamsEvent.withdrawAuthority.toBase58(),
        randomWithdrawAuthority.publicKey.toBase58()
      );
      assert.equal(
        setParamsEvent.initialVirtualTokenReserves.toString(),
        new BN(1000).toString()
      );
      assert.equal(
        setParamsEvent.initialVirtualSolReserves.toString(),
        new BN(2000).toString()
      );
      assert.equal(
        setParamsEvent.initialRealTokenReserves.toString(),
        new BN(3000).toString()
      );
      assert.equal(
        setParamsEvent.initialTokenSupply.toString(),
        new BN(4000).toString()
      );
      assert.equal(
        setParamsEvent.feeBasisPoints.toString(),
        new BN(100).toString()
      );
    }
  
    assert.equal(
      global.feeRecipient.toBase58(),
      randomFeeRecipient.publicKey.toBase58()
    );
    assert.equal(
      global.withdrawAuthority.toBase58(),
      randomWithdrawAuthority.publicKey.toBase58()
    );
    assert.equal(
      global.initialVirtualTokenReserves.toString(),
      new BN(1000).toString()
    );
    assert.equal(
      global.initialVirtualSolReserves.toString(),
      new BN(2000).toString()
    );
    assert.equal(
      global.initialRealTokenReserves.toString(),
      new BN(3000).toString()
    );
    assert.equal(global.initialTokenSupply.toString(), new BN(4000).toString());
    assert.equal(global.feeBasisPoints.toString(), new BN(100).toString());
  });
  
  it("can't set params as non-authority", async () => {
    let errorCode = "";
    try {
      const randomFeeRecipient = anchor.web3.Keypair.generate();
      const randomWithdrawAuthority = anchor.web3.Keypair.generate();
  
      await program.methods
        .setParams(
          randomFeeRecipient.publicKey,
          randomWithdrawAuthority.publicKey,
          {
            virtualTokenReserves: new BN(1000),
            virtualSolReserves: new BN(2000),
            realTokenReserves: new BN(3000),
          },
          new BN(4000),
          new BN(100)
        )
        .accounts({
          authority: tokenCreator.publicKey,
          program: program.programId,
        })
        .signers([tokenCreator])
        .rpc();
    } catch (err) {
      let anchorError = getAnchorError(err);
      if (anchorError) {
        errorCode = anchorError.error.errorCode.code;
      }
    }
    assert.equal(errorCode, "InvalidAuthority");
  });
});

//TODO: test sell whole curve

//TODO: test authority change
